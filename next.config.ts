import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 정적 내보내기(UG-404) — `next build` 가 out/ 에 HTML·JS 만 만들고, 배포 컨테이너에서는 nginx 가 그대로 서빙한다
  // (gate-web 과 같은 방식, out/login.html · out/accounts.html …). 그래서 서버에서만 도는 기능(서버 액션,
  // route handler, cookies()/headers(), middleware·proxy, rewrites, next/image 최적화)은 쓸 수 없다.
  // 서버 API 는 브라우저가 게이트웨이를 직접 부른다(gate-web 과 같음). 주소는 런타임 설정 public/config.js 에서 읽고,
  // 배포 컨테이너가 기동 때 환경별 값으로 다시 쓴다(GATE_MGMT_API_ORIGIN).
  output: "export",
};

export default nextConfig;
