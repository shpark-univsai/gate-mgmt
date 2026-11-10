import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "UNIVS GATE Backoffice",
  robots: { index: false, follow: false },
  // 아이폰 Safari 가 이메일 · 전화번호를 저절로 링크(밑줄)로 바꾸지 않게(UG-453 기획 17101)
  formatDetection: { telephone: false, email: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>
        {/* 런타임 설정(서버 주소). 배포 컨테이너가 환경별 값으로 다시 써요 — 화면보다 먼저 읽어야 해요. */}
        <Script src="/config.js" strategy="beforeInteractive" />
        {children}
      </body>
    </html>
  );
}
