// 질병청·시도 페이지 글에서 숫자를 뽑는 함수들 (네트워크 없음, 테스트 가능)
// 각 함수는 { seriesId: [[연도-주차, 값], ...] } 형태의 points 묶음을 돌려준다.

export function htmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&rarr;/g, '→').replace(/&middot;/g, '·').replace(/&[a-z]+;/gi, ' ')
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/\n\s+/g, '\n');
}

const num = s => Number(String(s).replace(/,/g, ''));
// 보고서가 Y년 W주인데 추이에 (51주)처럼 W보다 큰 주가 있으면 전년도
const key = (Y, W, w) => `${w > W ? Y - 1 : Y}-${w}`;

// "(41주) 21.6명 → (42주) 17.7명 → ..." 를 [[주, 값]]으로
export function parseTrend(s) {
  const out = [];
  const re = /\((\d{1,2})주\)\s*([\d,]+(?:\.\d+)?)\s*(?:명|%)?/g;
  let m;
  while ((m = re.exec(s))) out.push([+m[1], num(m[2])]);
  return out;
}

function section(text, startRe, endRe) {
  const s = text.search(startRe);
  if (s < 0) return '';
  const rest = text.slice(s);
  const e = endRe ? rest.slice(1).search(endRe) : -1;
  return e < 0 ? rest : rest.slice(0, e + 1);
}

/**
 * 질병청 감염병포털 '감염병 표본감시 주간소식지' 본문
 * 반환: { year, week, points: {id: [[key,v]]}, notes: {id: text} }
 */
export function parseWeeklyBulletin(text) {
  const t = text.replace(/\s+/g, ' ');
  const title = t.match(/(\d{4})년\s*감염병\s*표본감시\s*주간소식지\s*(\d{1,2})\s*주차/);
  if (!title) throw new Error('주간소식지 제목(연도·주차)을 찾지 못함');
  const Y = +title[1], RW = +title[2];
  const P = {}, N = {};
  // 소식지 N주차는 대개 (N-1)주 자료다. 추이에서 가장 큰 주를 자료 주차로 본다.
  let W = 0;
  const put = (id, w, v) => {
    if (v == null || isNaN(v)) return;
    (P[id] = P[id] || []).push([key(Y, RW, w), v]);
    if (!(w > RW)) W = Math.max(W, w);
  };
  const putTrend = (id, s) => parseTrend(s).forEach(([w, v]) => put(id, w, v));

  // 1. 인플루엔자
  const flu = section(t, /1\.\s*인플루엔자\s*환자감시/, /2\.\s*코로나19/);
  let m;
  if ((m = flu.match(/의사환자분율\s*추이\s*:\s*((?:\(\d+주\)\s*[\d.,]+명[^(※\d]{0,12})+)/))) putTrend('flu-ili-all', m[1]);
  if ((m = flu.match(/병원급\s*의료기관의\s*입원환자\s*수는[^※]*※\s*최근\s*4주간\s*입원환자\s*추이\s*:\s*((?:\(\d+주\)\s*[\d.,]+명[^(※\d]{0,12})+)/))) putTrend('flu-hosp', m[1]);
  if ((m = flu.match(/인플루엔자\s*바이러스\s*검출률은[^※]*※\s*최근\s*4주간\s*검출률\s*추이\s*:\s*((?:\(\d+주\)\s*[\d.]+%[^(※\d]{0,12})+)/))) putTrend('flu-pos', m[1]);

  // 2. 코로나19
  const cov = section(t, /2\.\s*코로나19\s*환자감시/, /3\.\s*급성호흡기감염증/);
  if ((m = cov.match(/병원급\s*의료기관의\s*입원환자\s*수는[^※]*※\s*최근\s*4주간\s*입원환자\s*추이\s*:\s*((?:\(\d+주\)\s*[\d.,]+명[^(※\d]{0,12})+)/))) putTrend('covid-hosp', m[1]);
  if ((m = cov.match(/코로나19\s*바이러스\s*검출률은\s*([\d.]+)%[^※]*※\s*최근\s*4주간\s*검출률\s*추이\s*:\s*((?:\(\d+주\)\s*[\d.]+%[^(※\d]{0,12})+)/))) putTrend('covid-pos', m[2]);

  // 자료 주차를 먼저 확정(이하 '이번 주/전주' 값에 쓰임)
  if (!W) W = RW - 1 > 0 ? RW - 1 : RW;
  const prevW = W - 1 > 0 ? W - 1 : 52;

  // 3. 급성호흡기감염증(병원급 입원)
  const ari = section(t, /3\.\s*급성호흡기감염증/, /4\.\s*중증급성호흡기감염증/);
  if ((m = ari.match(/\(바이러스성\)\s*급성호흡기감염증\s*입원환자\s*수?\s*([\d,]+)명으로\s*전주\(([\d,]+)명\)[^순]*?((?:[가-힣A-Za-z\s]+?\s*[\d.]+%\s*,?\s*)+)순/))) {
    put('ari-hosp', W, num(m[1])); put('ari-hosp', prevW, num(m[2]));
    const total = num(m[1]);
    N['ari-hosp'] = `${W}주 원인: ${m[3].replace(/^.*?대비\s*(?:증가|감소|유사)\s*/, '').trim()}`;
    const shares = [...m[3].matchAll(/([가-힣A-Za-z\s]+?)\s*([\d.]+)%/g)].map(x => [x[1].trim(), +x[2]]);
    for (const [name, pct] of shares) {
      if (/호흡기세포융합/.test(name)) put('rsv-hosp', W, Math.round(total * pct / 100));
      if (/리노/.test(name)) put('rhino-hosp', W, Math.round(total * pct / 100));
      if (/메타뉴모/.test(name)) put('hmpv-hosp', W, Math.round(total * pct / 100));
    }
  }
  if ((m = ari.match(/\(세균성\)\s*급성호흡기감염증\s*입원환자\s*수?\s*([\d,]+)명으로\s*전주\(([\d,]+)명\)[\s\S]*?마이코플라스마\s*폐렴균(?:\s*감염증)?\s*([\d.]+)%/))) {
    put('myco-hosp', W, Math.round(num(m[1]) * +m[3] / 100));
    N['myco-hosp'] = `${W}주 세균성 입원 ${m[1]}명 중 마이코플라스마 ${m[3]}%`;
  }

  // 4. 중증급성호흡기감염증
  if ((m = t.match(/중증급성호흡기감염증\s*입원환자\s*수\s*([\d,]+)명으로\s*전주\(([\d,]+)명\)/))) {
    put('sari-hosp', W, num(m[1])); put('sari-hosp', prevW, num(m[2]));
  }

  // 5. 장관감염증
  const ent = section(t, /5\.\s*장관감염증/, /6\.\s*수족구병/);
  if ((m = ent.match(/장관감염증\s*환자는\s*([\d,]+)명으로\s*전주\(([\d,]+)명\)[^]*?바이러스\s*([\d.]+)%\s*차지/))) {
    put('enteric', W, num(m[1])); put('enteric', prevW, num(m[2]));
    const noro = ent.match(/\(바이러스성\)\s*노로바이러스\s*([\d.]+)%/);
    if (noro) {
      put('noro-cases', W, Math.round(num(m[1]) * +m[3] / 100 * +noro[1] / 100));
      N['noro-cases'] = `${W}주 장관감염증 ${m[1]}명 × 바이러스 ${m[3]}% × 노로 ${noro[1]}%`;
    }
  }

  // 6. 수족구병
  if ((m = t.match(/수족구병\s*의사환자분율은\s*([\d.]+)명\s*\(\/1,000명당\)\s*으로\s*전주\(([\d.]+)명\)/))) {
    put('hfmd-ili', W, +m[1]); put('hfmd-ili', prevW, +m[2]);
  }
  if ((m = t.match(/수족구병[\s\S]{0,200}?0-6세\s*([\d.]+)명/))) put('hfmd-0-6', W, +m[1]);

  return { year: Y, reportWeek: RW, dataWeek: `${W > RW ? Y - 1 : Y}-${W}`, points: P, notes: N };
}

/**
 * 질병청 인플루엔자 보도자료 본문 → 연령별 ILI(최신 주)와 전체 4주 추이
 */
export function parseFluPress(text, year) {
  const t = text.replace(/\s+/g, ' ');
  const P = {};
  const tr = t.match(/최근\s*4주\s*ILI\s*분율\)?\s*((?:\d{1,2}주\s*[\d.]+명[^\d]{0,12})+)/);
  if (!tr) return { points: P };
  const pairs = [...tr[1].matchAll(/(\d{1,2})주\s*([\d.]+)명/g)].map(x => [+x[1], +x[2]]);
  const W = Math.max(...pairs.map(p => p[0]));
  const Y = year || new Date().getFullYear();
  const k = w => `${w > W ? Y - 1 : Y}-${w}`;
  P['flu-ili-all'] = pairs.map(([w, v]) => [k(w), v]);
  const AGE = { '0세': 'flu-ili-0', '1-6세': 'flu-ili-1-6', '7-12세': 'flu-ili-7-12', '13-18세': 'flu-ili-13-18', '19-49세': 'flu-ili-19-49', '50-64세': 'flu-ili-50-64', '65세이상': 'flu-ili-65', '65세 이상': 'flu-ili-65' };
  const ages = t.match(/\*\s*((?:(?:0세|1-6세|7-12세|13-18세|19-49세|50-64세|65세\s?이상)\s*\(\s*[\d.]+명\)\s*>?\s*){5,})/);
  if (ages) for (const x of ages[1].matchAll(/(0세|1-6세|7-12세|13-18세|19-49세|50-64세|65세\s?이상)\s*\(\s*([\d.]+)명\)/g)) {
    const id = AGE[x[1]] || AGE[x[1].replace(/\s/, '')];
    if (id) P[id] = [[k(W), +x[2]]];
  }
  return { week: `${Y}-${W}`, points: P };
}

/**
 * 시도별 영유아 독감 요약 페이지 문장
 * "10/25~31(44주차) 대전시 기준 0~6세 독감·인플루엔자 의사환자분율은 외래환자 1,000명당 47.2명입니다. 전주 30.7명보다 ... 40주차 38.7명과 ..."
 */
const REGION = [
  [/^서울/, '서울'], [/^부산/, '부산'], [/^대구/, '대구'], [/^인천/, '인천'], [/^울산/, '울산'], [/^대전/, '대전'],
  [/^세종/, '세종'], [/^경기/, '경기'], [/^강원/, '강원'], [/^충청북|^충북/, '충북'], [/^충청남|^충남/, '충남'],
  [/^전라북|^전북/, '전북'], [/^전남광주|^광주|^전라남|^전남/, '전남광주'], [/^경상북|^경북/, '경북'], [/^경상남|^경남/, '경남'], [/^제주/, '제주'],
];
export function parseRegionalFlu(text, year) {
  const t = text.replace(/\s+/g, ' ');
  const m = t.match(/\((\d{1,2})주차\)\s*(\S+?)\s*기준\s*0~6세\s*독감·인플루엔자\s*의사환자분율은\s*외래환자\s*1,000명당\s*([\d.]+)명입니다\.\s*전주\s*([\d.]+)명.*?다\.\s*(?:(\d{1,2})주차\s*([\d.]+)명)?/);
  if (!m) return null;
  const label = m[2];
  if (/^전국/.test(label)) return { national: true };
  const hit = REGION.find(([re]) => re.test(label));
  if (!hit) return null;
  const W = +m[1], Y = year || new Date().getFullYear();
  const k = w => `${w > W + 4 ? Y - 1 : Y}-${w}`;
  const pts = [[k(W), +m[3]], [k(W - 1 > 0 ? W - 1 : 52), +m[4]]];
  if (m[5]) pts.push([k(+m[5]), +m[6]]);
  return { region: hit[1], week: `${Y}-${W}`, points: pts };
}

/** 목록 HTML에서 주간소식지 글 번호 찾기 */
export function findBulletinDocs(html) {
  const out = [];
  const seen = new Set();
  // 행 단위로 나눠 같은 행 안의 제목과 17자리 글번호를 짝짓는다
  for (const row of String(html).split(/<tr[\s>]|<li[\s>]/i)) {
    const title = row.replace(/<[^>]+>/g, ' ').match(/(\d{4})년(?:도)?\s*감염병\s*표본감시\s*주간소식지\s*(\d{1,2})\s*주차/);
    const id = row.match(/(?:q_bbsDocNo=|['"(,]\s*)(20\d{15})/);
    if (title && id && !seen.has(id[1])) { seen.add(id[1]); out.push({ year: +title[1], week: +title[2], docNo: id[1] }); }
  }
  return out.sort((a, b) => b.year - a.year || b.week - a.week);
}

/** 질병청 보도자료 목록에서 인플루엔자 글 링크 찾기 */
export function findFluPress(html, base = 'https://www.kdca.go.kr') {
  const out = [];
  const re = /href="(?:([^"]*\/bbs\/kdca\/(4[12])\/(\d+)\/artclView\.do[^"]*)|javascript:jf_viewArtcl\(\s*'kdca'\s*,\s*'(4[12])'\s*,\s*'(\d+)'\s*\))"[^>]*>([\s\S]{0,1500}?)<\/a>/g;
  let m;
  while ((m = re.exec(html))) {
    const title = m[6].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    if (!/인플루엔자|독감/.test(title)) continue;
    const url = m[1] ? new URL(m[1].replace(/&amp;/g, '&'), base).href : `${base}/bbs/kdca/${m[4]}/${m[5]}/artclView.do`;
    out.push({ url, id: +(m[3] || m[5]), title: title.replace(/새글/, '').trim() });
  }
  return out.sort((a, b) => b.id - a.id);
}
