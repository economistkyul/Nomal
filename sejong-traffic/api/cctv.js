// 지금 세종 교통 — 국가교통정보센터(ITS) 교통 CCTV 목록을 대신 불러오는 서버 함수
// 화면에서 지도에 보이는 범위(minX,maxX,minY,maxY = 경도·위도)를 보내면 그 안의 CCTV를 돌려줍니다.
// ITS 인증키는 여기서만 쓰고 화면에는 내보내지 않습니다.
//
// 디버그: /api/cctv?debug=1  → ITS가 돌려준 원본 응답 앞부분을 보여줍니다(인증키는 지움).
//   CCTV가 안 뜨면 이 주소를 열어 오류 메시지를 확인하세요.

const BASE = 'https://openapi.its.go.kr:9443/cctvInfo';
// type: ex = 고속도로, its = 국도
const ROAD_TYPES = ['ex', 'its'];
// cctvType: 4 = 실시간 스트리밍(HTTPS), 1 = 실시간 스트리밍(HTTP). HTTPS 화면에서는 4가 필요해 먼저 시도합니다.
const STREAM_TYPES = ['4', '1'];
const SEJONG = { minX: 127.10, maxX: 127.45, minY: 36.40, maxY: 36.75 };
const MAX_SPAN = 0.8; // 한 번에 묻는 범위 상한(도) — 너무 넓은 범위 요청을 막습니다.

function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }

function bbox(q) {
  let b = {
    minX: num(q.minX, SEJONG.minX), maxX: num(q.maxX, SEJONG.maxX),
    minY: num(q.minY, SEJONG.minY), maxY: num(q.maxY, SEJONG.maxY),
  };
  if (b.minX > b.maxX) [b.minX, b.maxX] = [b.maxX, b.minX];
  if (b.minY > b.maxY) [b.minY, b.maxY] = [b.maxY, b.minY];
  const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
  const hx = Math.min((b.maxX - b.minX) / 2, MAX_SPAN / 2), hy = Math.min((b.maxY - b.minY) / 2, MAX_SPAN / 2);
  b = { minX: cx - hx, maxX: cx + hx, minY: cy - hy, maxY: cy + hy };
  // 대한민국 범위 밖이면 세종으로 되돌립니다.
  if (b.maxX < 124 || b.minX > 132 || b.maxY < 33 || b.minY > 39) b = { ...SEJONG };
  return b;
}

function urlFor(key, type, cctvType, b) {
  const p = new URLSearchParams({
    apiKey: key, type, cctvType,
    minX: b.minX.toFixed(5), maxX: b.maxX.toFixed(5), minY: b.minY.toFixed(5), maxY: b.maxY.toFixed(5),
    getType: 'json',
  });
  return BASE + '?' + p.toString();
}

async function getJson(url, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { Accept: 'application/json' } });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* ITS가 XML·HTML 오류를 줄 때가 있습니다 */ }
    return { status: r.status, json, text };
  } finally { clearTimeout(t); }
}

// ITS 응답은 { response: { data: [...] } } 형태입니다. data가 한 건이면 배열이 아닐 수 있어 둘 다 받습니다.
function rows(json) {
  const d = json && json.response && json.response.data;
  if (!d) return [];
  return Array.isArray(d) ? d : [d];
}

function normalize(r, type) {
  const lat = Number(r.coordy), lng = Number(r.coordx);
  const url = String(r.cctvurl || '').trim();
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !url) return null;
  return {
    name: String(r.cctvname || 'CCTV').trim(),
    lat, lng, url,
    format: String(r.cctvformat || '').trim(),
    road: type === 'ex' ? '고속도로' : '국도',
  };
}

module.exports = async (req, res) => {
  const key = (process.env.ITS_API_KEY || '').trim();
  if (!key) { res.setHeader('Cache-Control', 'no-store'); res.status(503).json({ ok: false, error: 'its_key_missing' }); return; }
  const q = req.query || {};
  const b = bbox(q);

  if (q.debug) {
    const out = await getJson(urlFor(key, 'its', STREAM_TYPES[0], b), 8000).catch((e) => ({ status: 0, text: String(e) }));
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ ok: true, bbox: b, status: out.status, sample: String(out.text || '').split(key).join('***').slice(0, 1500) });
    return;
  }

  const seen = new Set();
  const list = [];
  let failures = 0, attempts = 0;
  for (const cctvType of STREAM_TYPES) {
    const jobs = ROAD_TYPES.map((type) => getJson(urlFor(key, type, cctvType, b), 8000)
      .then((r) => ({ type, r }))
      .catch(() => ({ type, r: null })));
    for (const { type, r } of await Promise.all(jobs)) {
      attempts++;
      if (!r || r.status !== 200 || !r.json) { failures++; continue; }
      for (const raw of rows(r.json)) {
        const c = normalize(raw, type);
        if (!c) continue;
        const id = c.name + '|' + c.lat.toFixed(5) + '|' + c.lng.toFixed(5);
        if (seen.has(id)) continue;
        seen.add(id);
        list.push(c);
      }
    }
    if (list.length) break; // HTTPS 영상으로 찾았으면 HTTP 목록은 묻지 않습니다.
  }

  if (!list.length && failures === attempts) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ ok: false, error: 'its_unavailable' });
    return;
  }
  // 같은 범위는 1분 동안 Vercel이 저장해 두고 그대로 돌려줍니다(ITS 호출 횟수 절약).
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
  res.status(200).json({ ok: true, bbox: b, count: list.length, cctv: list.slice(0, 300) });
};
