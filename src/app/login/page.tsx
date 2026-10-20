"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Brand, PersonIcon } from "@/components/ui";
import { login } from "@/lib/api";
import { saveStaff } from "@/lib/session";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!email.trim() || !password) {
      setError("이메일과 비밀번호를 입력해 주세요.");
      return;
    }
    setBusy(true);
    setError("");
    const res = await login(email.trim(), password);
    if (res.ok) {
      saveStaff(res.staff);
      router.replace("/accounts/new");
      return;
    }
    // 계정이 있는지 알려 주지 않도록 한 가지 문구만 써요.
    setError("이메일 또는 비밀번호가 맞지 않습니다.");
    setBusy(false);
  }

  return (
    <main className="page-center">
      <form className="card card--login" onSubmit={onSubmit} noValidate>
        <Brand />
        <h1 className="t-heading-200" style={{ margin: 0 }}>
          로그인
        </h1>

        <div className="field">
          <label htmlFor="email" className="t-body-200-b">
            이메일
          </label>
          <div className="input-box">
            <PersonIcon />
            <input
              id="email"
              type="email"
              autoComplete="username"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="password" className="t-body-200-b">
            비밀번호
          </label>
          <div className={`input-box${error ? " is-error" : ""}`}>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={!!error}
              aria-describedby={error ? "login-error" : undefined}
            />
          </div>
          {error && (
            <p id="login-error" className="error t-body-200-r" role="alert">
              {error}
            </p>
          )}
        </div>

        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "로그인 중…" : "로그인"}
        </button>

        <p className="help t-body-200-r">계정이 없으면 운영 담당자에게 요청해 주세요.</p>
      </form>
    </main>
  );
}
