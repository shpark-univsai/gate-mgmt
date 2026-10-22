"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Brand } from "@/components/ui";
import { IcVisibilityOff, IcVisibilityOn } from "@/components/icons";
import { login } from "@/lib/api";
import { saveStaff, useLoginReason } from "@/lib/session";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // 세션이 끊겨 이 화면으로 왔으면 이유를 보여 줘요(로그인을 다시 누르면 숨겨요).
  const reason = useLoginReason();
  const [noticeHidden, setNoticeHidden] = useState(false);
  const notice =
    noticeHidden || !reason
      ? ""
      : reason === "forbidden"
        ? "백오피스를 사용할 수 있는 계정이 아닙니다. 운영 담당자에게 요청해 주세요."
        : "로그인이 만료되었습니다. 다시 로그인해 주세요.";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!email.trim() || !password) {
      setError("이메일과 비밀번호를 입력해 주세요.");
      return;
    }
    setBusy(true);
    setError("");
    setNoticeHidden(true);
    const res = await login(email.trim(), password);
    if (res.ok) {
      saveStaff(res.staff);
      router.replace("/accounts");
      return;
    }
    // 계정이 있는지 알려 주지 않도록 이메일 · 비밀번호 오류는 한 가지 문구만 써요.
    setError(
      res.reason === "forbidden"
        ? "백오피스를 사용할 수 있는 계정이 아닙니다. 운영 담당자에게 요청해 주세요."
        : res.reason === "failed"
          ? "로그인하지 못했습니다. 잠시 후 다시 시도해 주세요."
          : "이메일 또는 비밀번호가 맞지 않습니다.",
    );
    setBusy(false);
  }

  return (
    <main className="login">
      {/* 휴대폰: 위쪽 48px 띠에 흰 로고, 화면 전체가 다크 모드처럼 반전 */}
      <div className="login-top">
        <Brand inverse />
      </div>
      <form className="login-card" onSubmit={onSubmit} noValidate>
        <div className="login-brand">
          <Brand />
        </div>
        <h1 className="t-heading-200">
          로그인
        </h1>
        {notice && (
          <p className="error" role="status">
            {notice}
          </p>
        )}

        <div className="field">
          <label htmlFor="email" className="t-body-200-b">
            이메일
          </label>
          <div className="input-box">
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
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={!!error}
              aria-describedby={error ? "login-error" : undefined}
            />
            <button
              type="button"
              className="eye-toggle"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 보기"}
              aria-pressed={showPassword}
            >
              {showPassword ? <IcVisibilityOn size={18} /> : <IcVisibilityOff size={18} />}
            </button>
          </div>
          {error && (
            <p id="login-error" className="error" role="alert">
              {error}
            </p>
          )}
        </div>

        <button type="submit" className="btn btn-dark" disabled={busy} aria-busy={busy || undefined}>
          {busy ? "로그인 중…" : "로그인"}
        </button>

        <p className="help">계정이 없으면 운영 담당자에게 요청해 주세요.</p>
      </form>
    </main>
  );
}
