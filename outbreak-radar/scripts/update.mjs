// 자료 자동 갱신: node scripts/update.mjs
// 1) 질병청 감염병포털 '감염병 표본감시 주간소식지'  — 독감·코로나19·급성호흡기·RSV·마이코플라스마·장관(노로)·수족구
// 2) 질병청 인플루엔자 보도자료                       — 연령별 독감 의사환자 분율
// 3) 시도별 영유아 독감 요약(육아크루, 질병청 자료 정리) — 지도
// 받은 값은 data/sentinel.json의 시계열에 주차별로 덧붙인다(같은 주차는 최신 값으로 덮어씀).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { htmlToText, parseWeeklyBulletin, parseFluPress, parseRegionalFlu, findBulletinDocs, findFluPress } from './parse.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FILE = process.env.DATA_FILE || path.join(ROOT, 'data', 'sentinel.json');
const DP = 'https://dportal.kdca.go.kr';
const BULLETIN_SRC = '질병청 감염병 표본감시 주간소식지';
const UA = 'Mozilla/5.0 (compatible; outbreak-radar/1.0; +https://github.com/economistkyul/Nomal)';

// 새 시계열이 처음 생길 때 쓰는 설명
const T = {
  'flu-ili-all': { disease: 'flu', age: 'all', ageLabel: '전체', metric: '의사환자 분율', unit: '명/외래 1,000명', threshold: 12.9 },
  'flu-hosp': { disease: 'flu', age: 'senior', ageLabel: '병원급', metric: '독감 입원환자 수', unit: '명/주' },
  'flu-pos': { disease: 'flu', age: 'all', ageLabel: '의원급', metric: '독감 바이러스 검출률', unit: '%' },
  'covid-hosp': { disease: 'covid', age: 'all', ageLabel: '병원급', metric: '코로나19 입원환자 수', unit: '명/주' },
  'covid-pos': { disease: 'covid', age: 'all', ageLabel: '의원급', metric: '코로나19 바이러스 검출률', unit: '%' },
  'ari-hosp': { disease: 'ari', age: 'all', ageLabel: '병원급', metric: '급성호흡기감염증(바이러스) 입원환자 수', unit: '명/주' },
  'sari-hosp': { disease: 'ari', age: 'all', ageLabel: '상급종합', metric: '중증급성호흡기감염증 입원환자 수', unit: '명/주' },
  'rsv-hosp': { disease: 'rsv', age: 'all', ageLabel: '병원급', metric: 'RSV 입원환자 수(추정)', unit: '명/주', note: '급성호흡기감염증 입원 × RSV 비중(상위 3개 원인일 때만 공개)' },
  'rhino-hosp': { disease: 'ari', age: 'all', ageLabel: '병원급', metric: '리노바이러스 입원환자 수(추정)', unit: '명/주' },
  'hmpv-hosp': { disease: 'ari', age: 'all', ageLabel: '병원급', metric: '메타뉴모바이러스 입원환자 수(추정)', unit: '명/주' },
  'myco-hosp': { disease: 'myco', age: 'all', ageLabel: '병원급', metric: '마이코플라스마 입원환자 수(추정)', unit: '명/주' },
  'enteric': { disease: 'noro', age: 'all', ageLabel: '병원급', metric: '장관감염증 환자 수', unit: '명/주' },
  'noro-cases': { disease: 'noro', age: 'all', ageLabel: '병원급', metric: '노로바이러스 환자 수(추정)', unit: '명/주' },
  'hfmd-ili': { disease: 'hfmd', age: 'all', ageLabel: '전체', metric: '수족구병 의사환자 분율', unit: '명/외래 1,000명' },
  'hfmd-0-6': { disease: 'hfmd', age: 'infant', ageLabel: '0–6세', metric: '수족구병 의사환자 분율', unit: '명/외래 1,000명' },
};
const AGE_T = { 'flu-ili-0': ['infant', '0세'], 'flu-ili-1-6': ['infant', '1–6세'], 'flu-ili-7-12': ['child', '7–12세'], 'flu-ili-13-18': ['teen', '13–18세'], 'flu-ili-19-49': ['adult', '19–49세'], 'flu-ili-50-64': ['adult', '50–64세'], 'flu-ili-65': ['senior', '65세 이상'] };
for (const [id, [age, label]] of Object.entries(AGE_T)) T[id] = { disease: 'flu', age, ageLabel: label, metric: '의사환자 분율', unit: '명/외래 1,000명', threshold: 12.9 };

// 시도별 요약 페이지(시도 안의 한 시군구 페이지가 시도 값을 보여 줌)
const REGION_PAGES = {
  서울: 'seoul/dobong', 부산: 'busan/haeundae', 대구: 'daegu/dalseogu', 인천: 'incheon/seohae', 울산: 'ulsan/namgu',
  대전: 'daejeon/donggu', 세종: 'sejong/sejong', 경기: 'gyeonggi/seongnam', 강원: 'gangwon/sokcho', 충북: 'chungbuk/danyang',
  충남: 'chungnam/nonsan', 전북: 'jeonbuk/namwon', 전남광주: 'jeonnamgwangju/jindo', 경북: 'gyeongbuk/uiseong', 경남: 'gyeongnam/yangsan', 제주: 'jeju/jeju',
};

async function get(url, tries = 2) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9' }, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } catch (e) {
      if (i === tries - 1) throw new Error(`${e.message} (${url})`);
      await new Promise(res => setTimeout(res, 3000));
    }
  }
}

const idx = k => { const [y, w] = k.split('-').map(Number); return y * 54 + w; };
function upsert(data, id, pts, meta = {}) {
  let s = data.series.find(x => x.id === id);
  if (!s) {
    const t = T[id] || {};
    s = { id, region: '전국', kind: 'official', ...t, ...meta, points: [] };
    data.series.push(s);
  } else if (meta.source) { s.source = meta.source; s.sourceUrl = meta.sourceUrl; }
  let changed = 0;
  for (const [k, v] of pts) {
    if (v == null || Number.isNaN(v)) continue;
    const p = s.points.find(q => q[0] === k);
    if (!p) { s.points.push([k, v]); changed++; }
    else if (p[1] !== v) { p[1] = v; changed++; }
  }
  s.points.sort((a, b) => idx(a[0]) - idx(b[0]));
  return changed;
}

function kstNow() { return new Date(Date.now() + 9 * 3600e3); }

async function bulletin(data, status) {
  const sync = data.sync || {};
  const done = new Set(sync.processedDocs || []);
  let docs = [];
  if (process.env.KDCA_WEEKLY_URL) {
    const m = process.env.KDCA_WEEKLY_URL.match(/q_bbsDocNo=(\d{17})/);
    if (m) docs = [{ docNo: m[1], week: '?', forced: true }];
  }
  if (!docs.length) {
    const lists = [
      `${DP}/pot/bbs/BD_selectBbsList.do?q_bbsSn=1010&q_clsfNo=2`,
      `${DP}/pot/bbs/BD_selectBbsList.do?q_bbsSn=1010&q_clsfNo=2&q_currPage=1`,
      `${DP}/pot/bbs/BD_selectBbsList.do?q_bbsSn=1010`,
    ];
    for (const u of lists) {
      try { docs = findBulletinDocs(await get(u)); } catch (e) { status.detail = e.message; }
      if (docs.length) break;
    }
  }
  if (!docs.length) { status.status = 'error'; status.detail = '주간소식지 목록에서 글을 찾지 못함 — 수동 실행 때 글 주소를 넣어 주세요'; return 0; }
  // 아직 안 읽은 최신 글 최대 3개(오래된 것부터 반영)
  const todo = docs.filter(d => d.forced || !done.has(d.docNo)).slice(0, 3).reverse();
  if (!todo.length) { status.status = 'ok'; status.detail = `새 글 없음(최신 ${docs[0].year}년 ${docs[0].week}주차)`; return 0; }
  let changed = 0, last = null;
  for (const d of todo) {
    const url = `${DP}/pot/bbs/BD_selectBbs.do?q_bbsSn=1010&q_bbsDocNo=${d.docNo}&q_clsfNo=2`;
    try {
      const r = parseWeeklyBulletin(htmlToText(await get(url)));
      for (const [id, pts] of Object.entries(r.points)) changed += upsert(data, id, pts, { source: BULLETIN_SRC, sourceUrl: url });
      for (const [id, note] of Object.entries(r.notes)) { const s = data.series.find(x => x.id === id); if (s) s.note = note; }
      done.add(d.docNo); last = r;
    } catch (e) { status.detail = e.message; }
  }
  if (!last) { status.status = 'error'; return changed; }
  sync.processedDocs = [...done].slice(-30);
  data.sync = sync;
  status.status = 'ok'; status.week = last.dataWeek; status.detail = `${last.year}년 ${last.reportWeek}주차 소식지 반영(+${changed}값)`;
  return changed;
}

async function press(data, status) {
  let items = [];
  for (const b of [42, 41]) {
    try { items = items.concat(findFluPress(await get(`https://www.kdca.go.kr/bbs/kdca/${b}/artclList.do`))); } catch (e) { status.detail = e.message; }
  }
  const seen = new Set(); items = items.filter(x => !seen.has(x.id) && seen.add(x.id)).sort((a, b) => b.id - a.id).slice(0, 2);
  if (!items.length) { status.status = 'error'; status.detail = status.detail || '인플루엔자 보도자료를 찾지 못함'; return 0; }
  let changed = 0, week = null;
  const now = kstNow(), Y = now.getUTCFullYear();
  for (const it of items.reverse()) {
    try {
      const text = htmlToText(await get(it.url));
      let r = parseFluPress(text, Y);
      // 연초에 지난해 말 자료가 나오면 연도 보정
      if (r.week && +r.week.split('-')[1] > 40 && now.getUTCMonth() < 2) r = parseFluPress(text, Y - 1);
      for (const [id, pts] of Object.entries(r.points)) changed += upsert(data, id, pts, { source: '질병청 인플루엔자 보도자료', sourceUrl: it.url });
      if (r.week) week = r.week;
    } catch (e) { status.detail = e.message; }
  }
  status.status = week ? 'ok' : 'error'; status.week = week;
  if (week) status.detail = `연령별 독감 ${week.split('-')[1]}주 반영(+${changed}값)`;
  return changed;
}

async function regional(data, status) {
  if (process.env.SKIP_REGIONAL === '1') { status.status = 'skip'; status.detail = '끔(SKIP_REGIONAL=1)'; return 0; }
  const national = new Map((data.series.find(s => s.id === 'flu-ili-1-6')?.points || []).map(p => [p[0], p[1]]));
  const Y = kstNow().getUTCFullYear();
  let changed = 0, ok = [], miss = [], week = null;
  for (const [name, slug] of Object.entries(REGION_PAGES)) {
    try {
      const r = parseRegionalFlu(htmlToText(await get(`https://www.yugacrew.com/${slug}/infection-watch/influenza`, 1)), Y);
      if (!r || r.national || r.region !== name) { miss.push(name); continue; }
      // 전국 1–6세 값을 시도 값처럼 보여 주는 경우 거르기
      const same = r.points.filter(([k, v]) => national.get(k) === v).length;
      if (same >= 2) { miss.push(name); continue; }
      changed += upsert(data, 'flu-0-6-' + name, r.points, {
        disease: 'flu', age: 'infant', ageLabel: '0–6세', region: name, metric: '의사환자 분율', unit: '명/외래 1,000명',
        source: '질병청 시·도별 표본감시(육아크루 주간 정리 경유)', sourceUrl: `https://www.yugacrew.com/${slug}/infection-watch/influenza`,
      });
      ok.push(name); if (!week || idx(r.week) > idx(week)) week = r.week;
    } catch { miss.push(name); }
    await new Promise(res => setTimeout(res, 800));
  }
  status.status = ok.length ? 'ok' : 'error'; status.week = week;
  status.detail = `${ok.length}개 시도 반영` + (miss.length ? ` · 없음: ${miss.join(', ')}` : '');
  return changed;
}

async function main() {
  const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const runs = [
    ['bulletin', '질병청 주간소식지', bulletin],
    ['press', '질병청 독감 보도자료', press],
    ['regional', '시도별 영유아 독감', regional],
  ];
  const sources = [];
  let changed = 0;
  for (const [id, name, fn] of runs) {
    const st = { id, name, status: 'error', detail: '' };
    try { changed += await fn(data, st); } catch (e) { st.status = 'error'; st.detail = e.message; }
    sources.push(st); console.log(`[${st.status}] ${name}: ${st.detail}`);
  }
  // 기준 주차 = 전체 독감 의사환자 분율의 마지막 주차
  const all = data.series.find(s => s.id === 'flu-ili-all');
  if (all?.points.length) data.latestWeek = all.points.at(-1)[0];
  const now = kstNow();
  const sig = x => JSON.stringify((x || []).map(s => [s.id, s.status]));
  // 값도 수집 상태도 그대로면 파일을 건드리지 않는다(빈 커밋 방지)
  if (changed || sig(data.sync?.sources) !== sig(sources)) {
    data.sync = { ...(data.sync || {}), lastRun: now.toISOString().replace('Z', '+09:00').slice(0, 16).replace('T', ' '), sources };
    if (changed) data.updated = now.toISOString().slice(0, 10);
    fs.writeFileSync(FILE, JSON.stringify(data, null, 1) + '\n');
  }
  console.log(`바뀐 값 ${changed}개 · 기준 ${data.latestWeek}`);
  if (sources.every(s => s.status === 'error')) process.exit(1);
}
main();
