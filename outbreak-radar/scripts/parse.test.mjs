// 실제 질병청·시도 페이지 문구로 파서 검증: node --test scripts/
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWeeklyBulletin, parseFluPress, parseRegionalFlu, findBulletinDocs, findFluPress, htmlToText } from './parse.mjs';

// 2026년 4주차 주간소식지 본문(감염병포털 공개 문구)
const BULLETIN = `간행물·소식지 > 주간소식지 - 등록일시 : 2026-01-29 - 부서명 : 감염병관리과
2026년 감염병 표본감시 주간소식지 4주차
1. 인플루엔자 환자감시 - 의원급 의료기관의 외래환자 1,000명당 인플루엔자 의사환자(ILI) 수는 47.7명으로, 최근 4주간 증가세 ※ 최근 4주간 의사환자분율 추이: (1주) 36.4명 → (2주) 40.9명 → (3주) 44.9명 → (4주) 47.7명
- 병원급 의료기관의 입원환자 수는 420명으로, 최근 3주간 지속적으로 감소 ※ 최근 4주간 입원환자 추이: (1주) 419명 → (2주) 499명 → (3주) 489명 → (4주) 420명 - 상급종합병원급 의료기관의 입원환자 수는 66명으로, 70명 내외에서 증감 반복 ※ 최근 4주간 입원환자 추이: (1주) 73명 → (2주) 65명 → (3주) 71명 → (4주) 66명
병원체 감시 - 의원급 의료기관 외래 호흡기감염병 의심환자 검체 중 인플루엔자 바이러스 검출률은 35.7%로, 전주 대비 감소, 세부 아형은 주로 B형 검출 ※ 최근 4주간 검출률 추이: (1주) 35.1% → (2주) 33.5% → (3주) 39.0% → (4주) 35.7%
2. 코로나19 환자감시 - 병원급 의료기관의 입원환자 수는 51명으로, 60명 내외에서 증감 반복 ※ 최근 4주간 입원환자 추이: (1주) 60명 → (2주) 61명 → (3주) 41명 → (4주) 51명 - 상급종합병원급 의료기관의 입원환자 수는 5명으로, 최근 4주간 5명 내외에서 증감 반복 ※ 최근 4주간 입원환자 추이: (1주) 1명 → (2주) 4명 → (3주) 3명 → (4주) 5명 병원체 감시 - 의원급 의료기관 외래 호흡기감염병 의심환자 검체 중 코로나19 바이러스 검출률은 1.8%로, 전주 대비 증가, 변이바이러스는 NB.1.8.1, PQ.2, XFG 순 검출(12월) ※ 최근 4주간 검출률 추이: (1주) 4.3% → (2주) 2.1% → (3주) 1.5% → (4주) 1.8%
3. 급성호흡기감염증 병원급 입원환자 감시 - (바이러스성) 급성호흡기감염증 입원환자수 1,520명으로 전주(1,536명) 대비 감소, 전년 동 기간(1,897명) 대비 감소 인플루엔자 27.6%, 호흡기세포융합바이러스 감염증 27.6%, 리노바이러스 17.8% 순 - (세균성) 급성호흡기감염증 입원환자수 41명으로 전주(37명) 대비 증가, 전년 동 기간(53명) 대비 감소 마이코플라스마 폐렴균 감염증 85.4%, 클라미디아 폐렴균 감염증 14.6% 발생
4. 중증급성호흡기감염증 상급종합병원급 입원환자 감시 - 중증급성호흡기감염증 입원환자 수 248명으로 전주(273명) 대비 감소, 전년 동 기간(196명) 대비 증가
5. 장관감염증 환자 감시 - 장관감염증 환자는 991명으로 전주(939명) 대비 증가, 세균 14.7%, 바이러스 85.2% 차지 - (세균성) 캄필로박터균 46.6%, 살모넬라균 27.4%, 병원성대장균 19.2% 등의 순 - (바이러스성) 노로바이러스 73.0%, 그룹 A형 로타바이러스 20.1% 등의 순
6. 수족구병 및 엔테로바이러스감염증 환자 감시 - 수족구병 의사환자분율은 1.6명(/1,000명당)으로 전주(1.5명) 대비 증가 * (연령별 발생 현황) 0-6세 2.1명, 7-18세 0.4명 - 엔테로바이러스감염증 환자는 1명으로 전주(7명) 대비 감소
첨부자료 - 2026년도 감염병 표본감시 주간소식지 4주차.pdf`;

test('주간소식지: 인플루엔자·코로나·급성호흡기·장관·수족구', () => {
  const r = parseWeeklyBulletin(BULLETIN);
  assert.equal(r.reportWeek, 4);
  assert.equal(r.dataWeek, '2026-4');
  assert.deepEqual(r.points['flu-ili-all'], [['2026-1', 36.4], ['2026-2', 40.9], ['2026-3', 44.9], ['2026-4', 47.7]]);
  assert.deepEqual(r.points['flu-hosp'].at(-1), ['2026-4', 420]);
  assert.equal(r.points['flu-hosp'].length, 4, '상급종합 추이를 병원급으로 착각하지 않음');
  assert.deepEqual(r.points['flu-pos'].at(-1), ['2026-4', 35.7]);
  assert.deepEqual(r.points['covid-hosp'], [['2026-1', 60], ['2026-2', 61], ['2026-3', 41], ['2026-4', 51]]);
  assert.deepEqual(r.points['covid-pos'].at(-1), ['2026-4', 1.8]);
  assert.deepEqual(r.points['ari-hosp'], [['2026-4', 1520], ['2026-3', 1536]]);
  assert.deepEqual(r.points['rsv-hosp'], [['2026-4', 420]]); // 1520 × 27.6%
  assert.deepEqual(r.points['rhino-hosp'], [['2026-4', 271]]);
  assert.deepEqual(r.points['myco-hosp'], [['2026-4', 35]]); // 41 × 85.4%
  assert.deepEqual(r.points['sari-hosp'], [['2026-4', 248], ['2026-3', 273]]);
  assert.deepEqual(r.points['enteric'], [['2026-4', 991], ['2026-3', 939]]);
  assert.deepEqual(r.points['noro-cases'], [['2026-4', 616]]); // 991 × 85.2% × 73%
  assert.deepEqual(r.points['hfmd-ili'], [['2026-4', 1.6], ['2026-3', 1.5]]);
  assert.deepEqual(r.points['hfmd-0-6'], [['2026-4', 2.1]]);
  assert.match(r.notes['ari-hosp'], /^4주 원인: 인플루엔자 27.6%/);
});

test('주간소식지: 연초 소식지의 전년 주차', () => {
  const r = parseWeeklyBulletin('2026년 감염병 표본감시 주간소식지 1주차 1. 인플루엔자 환자감시 - ※ 최근 4주간 의사환자분율 추이: (50주) 48.4명 → (51주) 39.1명 → (52주) 37.5명 → (1주) 36.4명 2. 코로나19 환자감시');
  assert.deepEqual(r.points['flu-ili-all'][0], ['2025-50', 48.4]);
  assert.deepEqual(r.points['flu-ili-all'][3], ['2026-1', 36.4]);
});

test('보도자료: 연령별 ILI', () => {
  const t = '인플루엔자 발생 다시 증가! ** (최근 4주 ILI 분율) 41주 21.6명 → 42주 17.7명 → 43주 19.2명 → 44주 22.8명 모든 연령층에서 발생이 증가 * 7-12세(60.9명) > 13-18세(37.4명) > 1-6세(33.1명) > 19-49세(23.7명) > 0세(20.6명) > 50-64세(13.1명) > 65세 이상(10.1명) 병원급';
  const r = parseFluPress(t, 2026);
  assert.equal(r.week, '2026-44');
  assert.deepEqual(r.points['flu-ili-all'].at(-1), ['2026-44', 22.8]);
  assert.deepEqual(r.points['flu-ili-7-12'], [['2026-44', 60.9]]);
  assert.deepEqual(r.points['flu-ili-65'], [['2026-44', 10.1]]);
  assert.deepEqual(r.points['flu-ili-0'], [['2026-44', 20.6]]);
});

test('시도별: 경남·대전, 전국 대체값 거르기', () => {
  const a = parseRegionalFlu('10/25~31(44주차) 경상남도 기준 0~6세 독감·인플루엔자 의사환자분율은 외래환자 1,000명당 34.0명입니다. 전주 29.8명보다 14.1% 증가했습니다. 40주차 27.6명과 비교하면 최근 흐름이 높은 편입니다.', 2026);
  assert.deepEqual(a, { region: '경남', week: '2026-44', points: [['2026-44', 34], ['2026-43', 29.8], ['2026-40', 27.6]] });
  const b = parseRegionalFlu('10/25~31(44주차) 전남광주통합특별시 기준 0~6세 독감·인플루엔자 의사환자분율은 외래환자 1,000명당 33.1명입니다. 전주 31.7명보다 4.4% 증가했습니다. 40주차 37.7명과', 2026);
  assert.equal(b.region, '전남광주');
  const c = parseRegionalFlu('10/25~31(44주차) 전국 기준 0~6세 독감·인플루엔자 의사환자분율은 외래환자 1,000명당 33.1명입니다. 전주 31.7명보다 4.4% 증가했습니다.', 2026);
  assert.deepEqual(c, { national: true });
});

test('목록에서 글번호 찾기', () => {
  const html = `<table><tr><td>1411</td><td><a href="#none" onclick="fn_view('20261105170000123')">2026년 감염병 표본감시 주간소식지 44주차</a></td></tr>
  <tr><td><a href="/pot/bbs/BD_selectBbs.do?q_bbsSn=1010&amp;q_bbsDocNo=20261030165037033&amp;q_clsfNo=2">2026년 감염병 표본감시 주간소식지 43주차</a></td></tr>
  <tr><td><a href="?q_bbsDocNo=20261030165037999">2026년 43주차 하수 기반 감염병 감시 주간 분석 보고</a></td></tr></table>`;
  assert.deepEqual(findBulletinDocs(html).map(d => d.week), [44, 43]);
  const press = findFluPress('<a href="/bbs/kdca/42/313376/artclView.do?layout=unknown" title="x"><strong>인플루엔자 발생 다시 증가!</strong></a><a href="/bbs/kdca/42/313385/artclView.do">성인 비만율</a>');
  assert.equal(press.length, 1);
  assert.equal(press[0].url, 'https://www.kdca.go.kr/bbs/kdca/42/313376/artclView.do?layout=unknown');
  assert.equal(htmlToText('<p>A&nbsp;&amp;B</p><script>x</script>').trim(), 'A &B');
});
