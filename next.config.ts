import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 정적 내보내기(UG-404) — `next build` 가 out/ 에 HTML·JS 만 만들고, 배포 컨테이너에서는 nginx 가 그대로 서빙한다
  // (gate-web 과 같은 방식, out/login.html · out/accounts.html …). 그래서 서버에서만 도는 기능(서버 액션,
  // route handler, cookies()/headers(), middleware·proxy, rewrites, next/image 최적화)은 쓸 수 없다.
  // 서버 API 는 브라우저가 같은 출처의 상대 경로(/api/...)로 부르고, 컨테이너 nginx 가 환경별 게이트웨이로 넘긴다.
  output: "export",
};

export default nextConfig;
