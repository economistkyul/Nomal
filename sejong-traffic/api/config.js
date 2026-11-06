// 지금 세종 교통 — 화면이 처음 열릴 때 필요한 설정을 알려주는 서버 함수 (Vercel Serverless Function)
// 키는 Vercel 프로젝트의 Settings → Environment Variables 에 넣습니다.
//   KAKAO_JS_KEY : 카카오디벨로퍼스 앱의 JavaScript 키 (도메인 제한이 걸려 있어 화면에 보여도 괜찮은 키)
//   ITS_API_KEY  : 국가교통정보센터(ITS) 오픈API 인증키 — 화면에는 내보내지 않고 api/cctv.js 에서만 씁니다.
module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    ok: true,
    kakaoKey: (process.env.KAKAO_JS_KEY || '').trim(),
    cctv: !!(process.env.ITS_API_KEY || '').trim(),
  });
};
