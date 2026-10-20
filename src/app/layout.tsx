import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "UNIVS GATE Backoffice",
  description: "UNIVS GATE Admin Dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <head />
      <body>{children}</body>
    </html>
  );
}
