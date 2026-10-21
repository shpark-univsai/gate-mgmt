import { redirect } from "next/navigation";

// 지금 열리는 화면은 로그인 · 계정 발급 두 개뿐이에요.
export default function Home() {
  redirect("/accounts");
}
