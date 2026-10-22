// 런타임 설정 — 로컬 개발(npm run dev)용 기본값이에요.
// 배포 컨테이너는 기동할 때 이 파일을 환경별 값으로 다시 써요(GATE_MGMT_API_ORIGIN). 그래서 이미지 하나를 dev · stage · 운영에 그대로 써요.
// 비밀값은 절대 넣지 않아요 — 브라우저에 그대로 내려가는 공개 파일이에요.
window.__APP_CONFIG__ = {
  apiOrigin: "https://api-dev.univsgate.com",
};
