"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Brand, Dialog } from "@/components/ui";
import { FlagKR, FlagUS } from "@/components/flags";
import { checkEmail, createAccount, resendGuide, type EmailCheck, type MailLanguage } from "@/lib/api";
import { useStaff } from "@/lib/session";

const COMPANY_MAX = 40;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const LANGUAGES: { value: MailLanguage; label: string; Flag: () => React.ReactElement }[] = [
  { value: "en", label: "English", Flag: FlagUS },
  { value: "ko", label: "한국어", Flag: FlagKR },
];
const languageName = (l: MailLanguage) => (l === "en" ? "English" : "한국어");

type Done = { company: string; email: string; language: MailLanguage; at: string; resent: boolean };

function formatMonthDay(iso: string) {
  const parts = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso));
  const p = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
  return `${p("month")}.${p("day")}`;
}

function formatKst(iso: string) {
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const p = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
  return `${p("year")}.${p("month")}.${p("day")} ${p("hour")}:${p("minute")} KST`;
}

export default function CreateAccountPage() {
  const router = useRouter();
  const staff = useStaff();

  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [language, setLanguage] = useState<MailLanguage>("en");

  const [companyError, setCompanyError] = useState("");
  const [emailError, setEmailError] = useState("");
  const [formError, setFormError] = useState("");
  // 이메일 미리 조회 결과. 보내기 전에 「첫 로그인 전」 · 「이미 사용 중」을 알려 줘요.
  const [check, setCheck] = useState<{ email: string; result: EmailCheck } | null>(null);

  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<Done | null>(null);

  const companyRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  // 목업 로그인 확인. 화면 이동용이고, 실제 권한 검사는 서버가 해요.
  useEffect(() => {
    if (staff === null) router.replace("/login");
  }, [staff, router]);

  const trimmedEmail = email.trim();
  const key = trimmedEmail.toLowerCase();
  const current = check && check.email === key ? check.result : null;
  const pending = current?.status === "pending" ? current : null;
  const isResend = pending !== null;
  const isInUse = current?.status === "in_use";

  async function runCheck(): Promise<EmailCheck | null> {
    if (!EMAIL_RE.test(trimmedEmail)) return null;
    if (current) return current;
    const asked = key;
    const result = await checkEmail(trimmedEmail);
    // 조회하는 사이 이메일을 고쳤으면 버려요.
    if (emailRef.current?.value.trim().toLowerCase() !== asked) return null;
    setCheck({ email: asked, result });
    // 첫 로그인 전이면 메일 언어를 처음 보낸 언어로 미리 골라 둬요.
    if (result.status === "pending") setLanguage(result.language);
    return result;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    let cError = "";
    let eError = "";
    if (!company.trim()) cError = "회사명을 입력해 주세요.";
    else if (company.trim().length > COMPANY_MAX) cError = `회사명은 ${COMPANY_MAX}자까지 쓸 수 있습니다.`;
    if (!trimmedEmail) eError = "고객 이메일을 입력해 주세요.";
    else if (!EMAIL_RE.test(trimmedEmail)) eError = "이메일 형식을 확인해 주세요.";
    setCompanyError(cError);
    setEmailError(eError);
    setFormError("");
    if (cError) return companyRef.current?.focus();
    if (eError) return emailRef.current?.focus();
    // 아직 조회 전이면 먼저 조회해요. 상태가 새로 드러나면 창을 열지 않고 칸 아래에 먼저 보여 줘요.
    if (!current) {
      const result = await runCheck();
      if (!result || result.status !== "new") return emailRef.current?.focus();
    }
    if (isInUse) return emailRef.current?.focus();
    setConfirming(true);
  }

  const closeConfirm = useCallback(() => {
    if (sending) return;
    setConfirming(false);
    // 「취소」는 창을 닫고 이메일 칸에 커서를 둬요.
    requestAnimationFrame(() => emailRef.current?.focus());
  }, [sending]);

  async function send() {
    setSending(true);
    const input = { company: company.trim(), email: trimmedEmail, language };
    const res = isResend ? await resendGuide(input) : await createAccount(input);
    setSending(false);
    setConfirming(false);

    if (res.ok) {
      setDone({ ...input, at: res.requestedAt, resent: isResend });
      return;
    }
    if (res.reason === "duplicate" || res.reason === "in_use") {
      // 조회와 보내기 사이에 상태가 바뀐 경우: 다시 조회해서 칸 아래에 보여 줘요.
      const result = await checkEmail(trimmedEmail);
      setCheck({ email: key, result });
      if (result.status === "pending") setLanguage(result.language);
      emailRef.current?.focus();
    } else if (res.reason === "daily_limit") {
      setFormError("오늘 보낼 수 있는 수를 넘었습니다.");
    } else {
      setFormError(isResend ? "안내 메일을 보내지 못했습니다. 다시 시도해 주세요." : "계정을 만들지 못했습니다. 다시 시도해 주세요.");
    }
  }

  const finish = useCallback(() => {
    // 「확인」을 누르면 칸을 비워 다음 고객을 바로 넣을 수 있어요. 언어는 English로 돌아가요.
    setDone(null);
    setCompany("");
    setEmail("");
    setLanguage("en");
    setCheck(null);
    setCompanyError("");
    setEmailError("");
    setFormError("");
    requestAnimationFrame(() => companyRef.current?.focus());
  }, []);

  if (!staff) return null;

  return (
    <>
      <header className="nav">
        <Brand inverse />
        <div className="profile">
          <div className="avatar" aria-hidden="true">
            {staff.name.slice(0, 1)}
          </div>
          <span className="identity identity-name">{staff.name}</span>
        </div>
      </header>

      <main className="main-center">
        <form className="card card--create" onSubmit={onSubmit} noValidate>
          <h1 className="t-heading-300" style={{ margin: 0 }}>
            Gate 계정 만들기
          </h1>

          <div className="field">
            <label htmlFor="company" className="t-body-200-b">
              회사명
            </label>
            <div className={`input-box${companyError ? " is-error" : ""}`}>
              <input
                ref={companyRef}
                id="company"
                autoComplete="organization"
                value={company}
                onChange={(e) => {
                  setCompany(e.target.value);
                  if (companyError) setCompanyError("");
                }}
                aria-invalid={!!companyError}
                aria-describedby={companyError ? "company-error" : undefined}
              />
            </div>
            {companyError && (
              <p id="company-error" className="error t-body-200-r">
                {companyError}
              </p>
            )}
          </div>

          <div className="field">
            <label htmlFor="email" className="t-body-200-b">
              고객 이메일
            </label>
            <div className={`input-box${emailError || isInUse ? " is-error" : ""}`}>
                <input
                ref={emailRef}
                id="email"
                type="email"
                inputMode="email"
                autoComplete="off"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  // 이메일을 고치면 원래 버튼(계정 만들고 메일 보내기)으로 돌아가요.
                  if (emailError) setEmailError("");
                }}
                onBlur={() => void runCheck()}
                aria-invalid={!!emailError || isInUse}
                aria-describedby="email-note"
              />
            </div>
            <div id="email-note" className="field" style={{ gap: 8 }} role="status" aria-live="polite">
              {emailError ? (
                <p className="error t-body-200-r">{emailError}</p>
              ) : isInUse ? (
                // 정말 막힌 경우: 빨간 한 줄 + 큰 버튼 비활성
                <p className="error t-body-200-r">이미 사용 중인 계정입니다. 「비밀번호 재설정」을 안내해 주세요.</p>
              ) : isResend ? (
                // 오류가 아니라 할 일이 바뀐 경우: 회색 안내 + 큰 버튼이 「안내 메일 다시 보내기」
                <p className="help t-body-200-r">
                  {pending.createdBy}님이 {formatMonthDay(pending.createdAt)}에 만든 계정입니다. 로그인 전이라 다시 보낼 수 있습니다.
                </p>
              ) : (
                <p className="help t-body-200-r">메일에 담당자로 내 이름과 이메일이 들어갑니다.</p>
              )}
            </div>
          </div>

          <div className="field">
            <span id="language-label" className="t-body-200-b">
              메일 언어
            </span>
            <div className="segmented" role="radiogroup" aria-labelledby="language-label">
              {LANGUAGES.map(({ value, label, Flag }) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={language === value}
                  onClick={() => setLanguage(value)}
                >
                  <Flag />
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <button type="submit" className="btn-primary" disabled={isInUse} aria-describedby="email-note">
              {isResend ? "안내 메일 다시 보내기" : "계정 만들고 메일 보내기"}
            </button>
            {formError && (
              <p className="error t-body-200-r" role="alert">
                {formError}
              </p>
            )}
          </div>
        </form>
      </main>

      {confirming && (
        <Dialog title={isResend ? "이 주소로 다시 보내시겠습니까?" : "이 주소로 보내시겠습니까?"} onClose={closeConfirm} closable={!sending}>
          <div className="record">
            {/* 이 창은 주소 확인이 목적이라 이메일만 크게 */}
            <p className="t-body-400-b">{trimmedEmail}</p>
            <p className="t-body-200-r" style={{ color: "var(--gray-500)" }}>
              {company.trim()} · {languageName(language)} 메일 ·{" "}
              {isResend ? "새 임시 비밀번호가 가고, 이전 비밀번호는 쓸 수 없게 됩니다." : "임시 비밀번호가 이 주소로 갑니다."}
            </p>
          </div>
          <p className="help t-body-200-r">주소가 한 글자라도 틀리면 다른 사람이 계정을 받게 됩니다.</p>
          <div className="dialog-actions">
            <button type="button" className="btn-action btn-action--wide" onClick={closeConfirm} disabled={sending}>
              취소
            </button>
            <button type="button" className="btn-action btn-action--dark" onClick={send} disabled={sending}>
              {sending ? "보내는 중…" : "보내기"}
            </button>
          </div>
        </Dialog>
      )}

      {done && (
        <Dialog title={done.resent ? "안내 메일을 다시 보냈습니다" : "계정을 만들었습니다"} onClose={finish}>
          <div className="record">
            <p className="t-body-200-b">
              {done.company} · {done.email}
            </p>
            <p className="status t-body-200-r">
              <span className="status-dot" aria-hidden="true" />
              안내 메일 발송을 요청했습니다
            </p>
            <p className="t-body-200-r" style={{ color: "var(--gray-500)" }}>
              {done.resent ? "새 임시 비밀번호" : "데모 프로젝트 1개"} · {languageName(done.language)} 메일 · {formatKst(done.at)}
            </p>
          </div>
          <p className="help t-body-200-r">
            고객에게 메일의 QR로 휴대폰 데모부터 해 보도록 안내해 주세요. 메일이 안 보이면 스팸함을 확인하게 해 주세요.
          </p>
          <div className="dialog-actions">
            <button type="button" className="btn-action btn-action--dark" onClick={finish}>
              확인
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
