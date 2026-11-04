import { redirect } from "next/navigation";

// 열리는 화면: 로그인 · 계정 발급 · 계정 해지(UG-443). 첫 화면은 계정 발급이에요.
export default function Home() {
  redirect("/accounts");
}
