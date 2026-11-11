/*
 * 확산 감지 엔진 (브라우저·Node 공용)
 * 주간 시계열 하나를 받아 "확산 초기 / 확산 중 / 정점·둔화 / 감소 / 보합 / 판정 보류"로 판정한다.
 *
 * 핵심 아이디어
 *  - 성장률: 최근 연속 주차(최대 4주)의 로그-선형 기울기 → 주간 증가율 r
 *  - 연속 상승: 바로 이전 주 대비 증가가 몇 주째 이어지는지
 *  - 수준: 기준 고점(지난 절기 정점 등) 대비 현재 위치 L = 현재값 / 기준값
 *  - "확산 초기" = 연속 2주 이상 증가 + 주간 증가율 8% 이상 + 아직 기준 고점의 50% 미만
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Detect = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CFG = {
    growthUp: 0.08,     // 주간 +8% 이상이면 "증가"
    growthDown: -0.05,  // 주간 -5% 이하이면 "감소"
    earlyLevel: 0.5,    // 기준 고점의 50% 미만이면 "초기" 구간
    earlyWeeks: 3,      // 기준 고점이 없으면: 상승 시작 3주 이내를 "초기"로 본다
    jump: 0.25,         // 한 주 +25% 이상 급증이면 "초기 신호"
    maxFitWeeks: 4,
  };

  // 질병청 주차(일~토). 1월 1일이 들어 있는 주가 1주차
  // (검증: 2026년 44주=10.25~10.31, 2026년 36주=8.30~9.5, 2024년 36주=9.1~, 2022년 37주=9.4~ — 질병청 발표와 일치)
  function weekStart(year, week) {
    var jan1 = new Date(Date.UTC(year, 0, 1));
    var dow = jan1.getUTCDay(); // 0=일
    var start = new Date(jan1.getTime() - dow * 864e5);
    return new Date(start.getTime() + (week - 1) * 7 * 864e5);
  }
  function parseWeek(key) { // "2026-44"
    var p = String(key).split('-');
    return { y: +p[0], w: +p[1] };
  }
  function weekIndex(key) {
    var p = parseWeek(key);
    return Math.round(weekStart(p.y, p.w).getTime() / (7 * 864e5));
  }
  function weekLabel(key) {
    var p = parseWeek(key);
    var s = weekStart(p.y, p.w), e = new Date(s.getTime() + 6 * 864e5);
    var f = function (d) { return (d.getUTCMonth() + 1) + '.' + d.getUTCDate(); };
    return p.w + '주(' + f(s) + '~' + f(e) + ')';
  }

  // 마지막 값에서 거슬러 올라가며 끊김 없는 연속 구간
  function tailRun(pts) {
    var run = [pts[pts.length - 1]];
    for (var i = pts.length - 2; i >= 0; i--) {
      if (run[0].i - pts[i].i === 1) run.unshift(pts[i]); else break;
    }
    return run;
  }

  function logSlope(run) {
    var xs = [], ys = [];
    run.forEach(function (p) { if (p.v > 0) { xs.push(p.i); ys.push(Math.log(p.v)); } });
    var n = xs.length;
    if (n < 2) return null;
    var mx = xs.reduce(function (a, b) { return a + b; }, 0) / n;
    var my = ys.reduce(function (a, b) { return a + b; }, 0) / n;
    var num = 0, den = 0;
    for (var k = 0; k < n; k++) { num += (xs[k] - mx) * (ys[k] - my); den += (xs[k] - mx) * (xs[k] - mx); }
    return Math.exp(num / den) - 1; // 주간 증가율
  }

  /**
   * @param {Array<[string, number]>} points  [["2026-43", 19.2], ...] (주차 오름차순 아니어도 됨)
   * @param {{ref?: number, threshold?: number}} opt
   */
  function analyze(points, opt) {
    opt = opt || {};
    var pts = (points || [])
      .filter(function (p) { return p && p[1] != null && !isNaN(p[1]); })
      .map(function (p) { return { k: p[0], i: weekIndex(p[0]), v: +p[1] }; })
      .sort(function (a, b) { return a.i - b.i; });

    var out = { n: pts.length, last: null, lastKey: null, prev: null, wow: null, growth: null,
      streak: 0, level: null, ref: null, stage: 'hold', score: 0, reasons: [] };
    if (!pts.length) { out.reasons.push('데이터 없음'); return out; }

    var last = pts[pts.length - 1];
    out.last = last.v; out.lastKey = last.k;

    var run = tailRun(pts);

    // 연속 상승 주수
    for (var j = run.length - 1; j > 0; j--) { if (run[j].v > run[j - 1].v) out.streak++; else break; }
    if (run.length >= 2) {
      out.prev = run[run.length - 2].v;
      out.wow = out.prev > 0 ? last.v / out.prev - 1 : null;
    }
    // 성장률: 상승이 2주 이상 이어지면 그 상승 구간의 기울기(재확산을 V자 평균으로 희석하지 않도록),
    // 아니면 최근 3주 기울기
    var fit = out.streak >= 2 ? run.slice(-Math.min(out.streak + 1, CFG.maxFitWeeks)) : run.slice(-3);
    out.growth = fit.length >= 2 ? logSlope(fit) : null;

    // 수준: 기준 고점(지난 절기 정점 등)이 있으면 그 대비 위치.
    // 없으면(검색량·신고 건수 등) 자기 최댓값과 비교하면 오를 때마다 100%가 되므로,
    // 대신 '상승이 시작된 지 몇 주째인가'로 초기 여부를 가린다.
    out.ref = opt.ref || null;
    out.level = out.ref ? last.v / out.ref : null;
    var young = out.ref ? out.level < CFG.earlyLevel : out.streak <= CFG.earlyWeeks;
    var aboveThreshold = opt.threshold != null ? last.v >= opt.threshold : null;

    if (run.length < 2) {
      out.stage = 'hold';
      out.reasons.push('연속된 주차 자료가 없어 추세 판정 보류');
      return finish(out);
    }

    var g = out.growth, L = out.level;
    var where = function () {
      return out.ref ? '기준 고점의 ' + pct(L) + ' 수준' + (young ? '(아직 낮음)' : '') : '상승 ' + out.streak + '주째';
    };
    var prevGrowth = run.length >= 4 ? logSlope(run.slice(-4, -1)) : null;

    if (g >= CFG.growthUp && out.streak >= 2 && young) {
      out.stage = 'early';
      out.reasons.push(out.streak + '주 연속 증가, 주간 +' + pct(g));
      out.reasons.push(where());
    } else if (g >= CFG.growthUp && out.streak >= 1) {
      out.stage = young ? 'signal' : 'rising';
      out.reasons.push('주간 +' + pct(g) + ', 연속 증가 ' + out.streak + '주');
      if (out.stage === 'signal') out.reasons.push('증가 확인 1주 더 필요');
      else out.reasons.push(out.ref ? '이미 기준 고점의 ' + pct(L) : '상승 ' + out.streak + '주째 지속');
    } else if (out.wow != null && out.wow >= CFG.jump && (out.ref ? L < CFG.earlyLevel : true)) {
      out.stage = 'signal';
      out.reasons.push('전주 대비 +' + pct(out.wow) + ' 급증(1주)');
    } else if (g <= CFG.growthDown && out.wow != null && out.wow > 0.02) {
      out.stage = 'flat';
      out.reasons.push('최근 3주 추세는 감소(' + pct(g) + ')지만 지난주 +' + pct(out.wow) + ' 반등');
    } else if (g <= CFG.growthDown) {
      out.stage = 'falling';
      out.reasons.push('주간 ' + pct(g) + ' 감소');
    } else if (prevGrowth != null && prevGrowth >= CFG.growthUp && (out.ref ? L >= CFG.earlyLevel : true)) {
      out.stage = 'peak';
      out.reasons.push('증가세 둔화(직전 +' + pct(prevGrowth) + ' → 최근 ' + pct(g) + ')');
    } else {
      out.stage = 'flat';
      out.reasons.push('뚜렷한 증감 없음(주간 ' + pct(g) + ')');
    }
    if (aboveThreshold === true) out.reasons.push('유행기준(' + opt.threshold + ') 초과');
    if (aboveThreshold === false) out.reasons.push('유행기준(' + opt.threshold + ') 미만');
    return finish(out);
  }

  function finish(o) {
    // 순위용 점수: "초기"일수록, 빠를수록 높게
    var g = Math.max(0, o.growth || 0), L = o.level != null ? Math.min(1, o.level) : Math.min(1, o.streak / 6);
    var base = { early: 70, signal: 45, rising: 35, peak: 15, flat: 5, falling: 0, hold: 0 }[o.stage];
    o.score = Math.round(Math.min(100, base + 60 * Math.min(g, 0.5) * (1 - L) + 5 * Math.min(o.streak, 3)));
    return o;
  }

  function pct(x) {
    if (x == null || isNaN(x)) return '–';
    var s = Math.round(x * 1000) / 10;
    return (s > 0 ? '' : '') + s + '%';
  }

  var STAGES = {
    early:   { label: '확산 초기', order: 6, tone: 'early' },
    signal:  { label: '초기 신호', order: 5, tone: 'signal' },
    rising:  { label: '확산 중',  order: 4, tone: 'rising' },
    peak:    { label: '정점·둔화', order: 3, tone: 'peak' },
    flat:    { label: '보합',     order: 2, tone: 'flat' },
    falling: { label: '감소',     order: 1, tone: 'falling' },
    hold:    { label: '판정 보류', order: 0, tone: 'hold' },
  };

  /**
   * 같은 칸(질병×연령×지역)에 들어온 공식·소프트 신호를 묶어 신뢰도를 매긴다.
   * 공식+소프트 모두 상승 → 높음 / 공식만 → 보통 / 소프트만 → 낮음(조기경보)
   */
  function combine(results) {
    var up = function (r) { return ['early', 'signal', 'rising'].indexOf(r.stage) >= 0; };
    var off = results.filter(function (r) { return r.kind === 'official'; });
    var soft = results.filter(function (r) { return r.kind === 'soft'; });
    var best = results.slice().sort(function (a, b) {
      return (b.kind === 'official') - (a.kind === 'official') || STAGES[b.stage].order - STAGES[a.stage].order || b.score - a.score;
    })[0];
    var offUp = off.some(up), softUp = soft.some(up);
    var conf = offUp && softUp ? 'high' : offUp ? 'mid' : softUp ? 'low' : (off.length ? 'mid' : 'low');
    // 공식 자료가 판정 보류일 때 소프트가 상승이면 소프트 판정을 대표로
    if (best && best.stage === 'hold' && softUp) best = soft.filter(up)[0];
    return { best: best, confidence: conf, officialUp: offUp, softUp: softUp };
  }

  return { analyze: analyze, combine: combine, STAGES: STAGES, CFG: CFG, weekLabel: weekLabel, weekIndex: weekIndex, pct: pct };
});
