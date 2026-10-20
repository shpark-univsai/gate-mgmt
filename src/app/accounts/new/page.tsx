"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Brand, Dialog, PersonIcon } from "@/components/ui";
import { FlagKR, FlagUS } from "@/components/flags";
import { createAccount, resendGuide, type MailLanguage } from "@/lib/api";
import { useStaff } from "@/lib/session";

const COMPANY_MAX = 40;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const LANGUAGES: { value: MailLanguage; label: string; Flag: () => React.ReactElement }[] = [
  { value: "en", label: "English", Flag: FlagUS },
  { value: "ko", label: "한국어", Flag: FlagKR },
];
const languageName = (l: MailLanguage) => (l === "en" ? "English" : "한국어");

type Done = { company: string; email: string; language: MailLanguage; at: string; resent: boolean };

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
  // 이미 계정이 있는 이메일이면 큰 버튼이 「안내 메일 다시 보내기」로 바뀌어요.
  const [duplicateOf, setDuplicateOf] = useState<string | null>(null);
  // 이미 사용 중인 계정이면 다시 보내지 않고 「비밀번호 재설정」을 안내해요.
  const [inUseOf, setInUseOf] = useState<string | null>(null);

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
  const isResend = duplicateOf !== null && duplicateOf === trimmedEmail.toLowerCase();
  const isInUse = inUseOf !== null && inUseOf === trimmedEmail.toLowerCase();

  function onSubmit(e: React.FormEvent) {
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
    if (res.reason === "duplicate") {
      setDuplicateOf(trimmedEmail.toLowerCase());
    } else if (res.reason === "in_use") {
      setInUseOf(trimmedEmail.toLowerCase());
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
    setDuplicateOf(null);
    setInUseOf(null);
    setCompanyError("");
    setEmailError("");
    setFormError("");
    requestAnimationFrame(() => companyRef.current?.focus());
  }, []);

  if (!staff) return null;

  return (
    <>
      <header className="nav">
        <Brand />
        <div className="profile">
          <div className="avatar" aria-hidden="true">
            {staff.name.slice(0, 1)}
          </div>
          <div className="identity">
            <span className="identity-name">{staff.name}</span>
            <span className="identity-role">{staff.team}</span>
          </div>
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
              <PersonIcon />
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
                  if (duplicateOf) setDuplicateOf(null);
                  if (inUseOf) setInUseOf(null);
                }}
                aria-invalid={!!emailError || isInUse}
                aria-describedby="email-note"
              />
            </div>
            <div id="email-note" className="field" style={{ gap: 8 }}>
              {emailError ? (
                <p className="error t-body-200-r">{emailError}</p>
              ) : isInUse ? (
                // 정말 막힌 경우: 빨간 한 줄 + 큰 버튼 비활성
                <p className="error t-body-200-r">이미 사용 중인 계정입니다. 「비밀번호 재설정」을 안내해 주세요.</p>
              ) : isResend ? (
                // 오류가 아니라 할 일이 바뀐 경우: 회색 안내 + 큰 버튼이 「안내 메일 다시 보내기」
                <p className="help t-body-200-r">이 이메일로 만든 계정이 있습니다. 아직 로그인 전이라 안내 메일을 다시 보낼 수 있습니다.</p>
              ) : (
                <p className="help t-body-200-r">메일에 담당자로 내 이름과 연락처가 들어갑니다.</p>
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
            <button type="submit" className="btn-primary" disabled={isInUse}>
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
        <Dialog title={isResend ? "이 주소로 다시 보낼까요?" : "이 주소로 보낼까요?"} onClose={closeConfirm} closable={!sending}>
          <div className="record">
            <p className="t-body-400-b">
              {company.trim()} · {trimmedEmail}
            </p>
            <p className="t-body-200-r" style={{ color: "var(--gray-500)" }}>
              {languageName(language)} 메일로 보냅니다.{" "}
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
        <Dialog title={done.resent ? "안내 메일을 다시 보냈습니다" : "계정을 만들고 메일을 보냈습니다"} onClose={finish}>
          <div className="record">
            <p className="t-body-200-b">
              {done.company} · {done.email}
            </p>
            <p className="status t-body-200-r">
              <span className="status-dot" aria-hidden="true" />
              발송 요청함
            </p>
            <p className="t-body-200-r" style={{ color: "var(--gray-500)" }}>
              {done.resent ? "새 임시 비밀번호" : "데모 프로젝트 1개"} · {languageName(done.language)} 메일 · {formatKst(done.at)}
            </p>
          </div>
          <p className="help t-body-200-r">메일이 보이지 않으면 스팸함을 확인하도록 안내해 주세요.</p>
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
