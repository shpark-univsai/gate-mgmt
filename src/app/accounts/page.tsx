"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Brand, Dialog, Toast } from "@/components/ui";
import { FlagKR, FlagUS } from "@/components/flags";
import { IcArrowDown, IcArrowLeft, IcArrowRight, IcReload, IcSearch } from "@/components/icons";
import {
  checkEmail,
  createAccount,
  listAccounts,
  resendGuide,
  type Account,
  type AccountStatus,
  type EmailCheck,
  type MailLanguage,
  type Staff,
} from "@/lib/api";
import { useStaff } from "@/lib/session";

const COMPANY_MAX = 40;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const LANGUAGES: { value: MailLanguage; label: string; Flag: () => React.ReactElement }[] = [
  { value: "en", label: "English", Flag: FlagUS },
  { value: "ko", label: "한국어", Flag: FlagKR },
];
const languageName = (l: MailLanguage) => (l === "en" ? "English" : "한국어");
const STATUS_LABEL: Record<AccountStatus, string> = { pending: "첫 로그인 전", in_use: "사용 중" };

function kstParts(iso: string) {
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
  return { y: p("year"), m: p("month"), d: p("day"), h: p("hour"), min: p("minute") };
}
const fmtFull = (iso: string) => {
  const t = kstParts(iso);
  return `${t.y}.${t.m}.${t.d} ${t.h}:${t.min}`;
};
const fmtShort = (iso: string) => {
  const t = kstParts(iso);
  return `${t.m}.${t.d} ${t.h}:${t.min}`;
};
/** 직원은 이름 대신 회사 이메일로 구분해요. 목록 · 안내에는 @ 앞부분만. */
const handle = (email: string) => email.split("@")[0];
const fmtMonthDay = (iso: string) => {
  const t = kstParts(iso);
  return `${t.m}.${t.d}`;
};

type ToastState = { title: string; detail: string } | null;

export default function AccountsPage() {
  const router = useRouter();
  const staff = useStaff();

  const [all, setAll] = useState<Account[]>([]);
  const [rows, setRows] = useState<Account[]>([]);
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState<AccountStatus | "all">("all");
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [resendTarget, setResendTarget] = useState<Account | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [freshId, setFreshId] = useState<string | null>(null);

  // 목업 로그인 확인. 화면 이동용이고, 실제 권한 검사는 서버가 해요.
  useEffect(() => {
    if (staff === null) router.replace("/login");
  }, [staff, router]);

  const reload = useCallback(async (q: { keyword: string; status: AccountStatus | "all" }) => {
    const [list, everything] = await Promise.all([listAccounts(q), listAccounts()]);
    setRows(list);
    setAll(everything);
  }, []);

  useEffect(() => {
    // 처음 한 번 목록을 불러와요.
    let alive = true;
    Promise.all([listAccounts(), listAccounts()]).then(([list, everything]) => {
      if (!alive) return;
      setRows(list);
      setAll(everything);
    });
    return () => {
      alive = false;
    };
  }, []);

  const metrics = useMemo(() => {
    const now = kstParts(new Date().toISOString());
    const thisMonth = all.filter((a) => {
      const t = kstParts(a.createdAt);
      return t.y === now.y && t.m === now.m;
    }).length;
    return {
      total: all.length,
      pending: all.filter((a) => a.status === "pending").length,
      inUse: all.filter((a) => a.status === "in_use").length,
      thisMonth,
    };
  }, [all]);

  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(page, pageCount);
  const visible = rows.slice((current - 1) * pageSize, current * pageSize);
  const from = rows.length ? (current - 1) * pageSize + 1 : 0;
  const to = Math.min(current * pageSize, rows.length);

  async function onSearch(e?: React.FormEvent) {
    e?.preventDefault();
    setPage(1);
    await reload({ keyword, status });
  }

  async function onReset() {
    setKeyword("");
    setStatus("all");
    setPage(1);
    await reload({ keyword: "", status: "all" });
  }

  const afterSend = useCallback(
    async (result: { kind: "created"; account: Account } | { kind: "resent"; account: Pick<Account, "email"> }) => {
      setCreating(false);
      setResendTarget(null);
      if (result.kind === "created") {
        setKeyword("");
        setStatus("all");
        setPage(1);
        await reload({ keyword: "", status: "all" });
        setFreshId(result.account.id);
        setToast({ title: "계정을 만들었습니다", detail: "안내 메일 발송을 요청했습니다" });
      } else {
        setToast({ title: "안내 메일을 다시 보냈습니다", detail: "새 임시 비밀번호로 발송을 요청했습니다" });
      }
    },
    [reload],
  );

  useEffect(() => {
    if (!freshId) return;
    const t = setTimeout(() => setFreshId(null), 4000);
    return () => clearTimeout(t);
  }, [freshId]);

  const clearToast = useCallback(() => setToast(null), []);

  if (!staff) return null;

  return (
    <>
      <header className="app-nav">
        <div className="app-nav-left">
          <Brand />
          <nav className="app-menu" aria-label="메뉴">
            <a className="app-menu-item is-active" href="/accounts" aria-current="page">
              계정 발급
            </a>
          </nav>
        </div>
        <div className="profile">
          <div className="avatar" aria-hidden="true">
            {staff.email.slice(0, 1).toUpperCase()}
          </div>
          <span className="identity-name">{staff.email}</span>
        </div>
      </header>

      <div className="breadcrumb">
        <span>BACKOFFICE</span>
        <IcArrowRight size={14} className="breadcrumb-sep" />
        <span className="breadcrumb-current">계정 발급</span>
      </div>

      <main className="content">
        <div className="page-title">
          <h1 className="t-heading-300">계정 발급</h1>
          <button type="button" className="btn btn-dark btn-sm" onClick={() => setCreating(true)}>
            계정 만들기
          </button>
        </div>

        <section className="overview" aria-label="요약">
          <Metric label="전체" value={metrics.total} sub={`이번 달 ${metrics.thisMonth}개`} />
          <Metric label="첫 로그인 전" value={metrics.pending} sub="안내 메일을 다시 보낼 수 있음" />
          <Metric label="사용 중" value={metrics.inUse} sub="고객이 콘솔에 로그인함" />
        </section>

        <form className="toolbar" onSubmit={onSearch} role="search">
          <label className="search">
            <IcSearch size={16} className="search-icon" />
            <span className="visually-hidden">검색어</span>
            <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="회사명, 고객 이메일 검색" />
          </label>
          <label className="select">
            <span className="visually-hidden">상태</span>
            <select value={status} onChange={(e) => setStatus(e.target.value as AccountStatus | "all")}>
              <option value="all">상태 전체</option>
              <option value="pending">첫 로그인 전</option>
              <option value="in_use">사용 중</option>
            </select>
            <IcArrowDown size={16} className="select-icon" />
          </label>
          <button type="submit" className="btn btn-dark btn-sm">
            검색
          </button>
          <button type="button" className="btn btn-outline btn-sm" onClick={onReset}>
            초기화
          </button>
          <span className="count">총 {rows.length}개</span>
        </form>

        {/* PC: 표 */}
        <div className="table" role="table" aria-label="발급한 계정">
          <div className="tr th" role="row">
            {["회사명", "고객 이메일", "메일 언어", "상태", "만든 사람", "만든 일시", "관리"].map((h) => (
              <span key={h} role="columnheader">
                {h}
              </span>
            ))}
          </div>
          {visible.length === 0 ? (
            <p className="empty">{all.length === 0 ? "아직 만든 Gate 계정이 없습니다." : "검색 결과가 없습니다."}</p>
          ) : (
            visible.map((a) => (
              <div key={a.id} className={`tr${a.id === freshId ? " is-new" : ""}`} role="row">
                <span role="cell">{a.company}</span>
                <span role="cell">{a.email}</span>
                <span role="cell">{languageName(a.language)}</span>
                <span role="cell">
                  <Status status={a.status} />
                </span>
                <span role="cell">{handle(a.createdBy)}</span>
                <span role="cell">{fmtFull(a.createdAt)}</span>
                <span role="cell">
                  {a.status === "pending" ? (
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => setResendTarget(a)}>
                      안내 메일 다시 보내기
                    </button>
                  ) : (
                    <span className="dash">—</span>
                  )}
                </span>
              </div>
            ))
          )}
        </div>

        {/* 휴대폰: 줄마다 카드 */}
        <ul className="cards" aria-label="발급한 계정">
          {visible.length === 0 && (
            <li className="empty">{all.length === 0 ? "아직 만든 Gate 계정이 없습니다." : "검색 결과가 없습니다."}</li>
          )}
          {visible.map((a) => (
            <li key={a.id} className={`card-row${a.id === freshId ? " is-new" : ""}`}>
              <div className="card-line">
                <strong className="card-company">{a.company}</strong>
                <Status status={a.status} />
              </div>
              <div className="card-line">
                <span className="card-email">{a.email}</span>
                {a.status === "pending" && (
                  <button type="button" className="link-action" onClick={() => setResendTarget(a)}>
                    <IcReload size={16} />
                    다시 보내기
                  </button>
                )}
              </div>
              <p className="card-meta">
                {languageName(a.language)} 메일 · {handle(a.createdBy)} · {fmtShort(a.createdAt)}
              </p>
            </li>
          ))}
        </ul>

        {rows.length > 0 && (
          <nav className="pagination" aria-label="페이지">
            <span className="pagination-range">
              {from}–{to} / {rows.length}개
            </span>
            <div className="pages">
              <button type="button" className="page-btn" onClick={() => setPage(current - 1)} disabled={current <= 1} aria-label="이전 페이지">
                <IcArrowLeft size={16} />
              </button>
              {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`page-btn${n === current ? " is-current" : ""}`}
                  aria-current={n === current ? "page" : undefined}
                  onClick={() => setPage(n)}
                >
                  {n}
                </button>
              ))}
              <button
                type="button"
                className="page-btn"
                onClick={() => setPage(current + 1)}
                disabled={current >= pageCount}
                aria-label="다음 페이지"
              >
                <IcArrowRight size={16} />
              </button>
            </div>
            <label className="page-size">
              <span className="visually-hidden">한 페이지에 보기</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
              >
                {[10, 20, 50].map((n) => (
                  <option key={n} value={n}>
                    {n}개씩 보기
                  </option>
                ))}
              </select>
              <IcArrowDown size={16} className="select-icon" />
            </label>
          </nav>
        )}
      </main>

      {creating && (
        <CreateDialog
          staff={staff}
          onClose={() => setCreating(false)}
          onCreated={(account) => afterSend({ kind: "created", account })}
          onResent={(email) => afterSend({ kind: "resent", account: { email } })}
        />
      )}

      {resendTarget && (
        <ResendDialog
          account={resendTarget}
          onClose={() => setResendTarget(null)}
          onResent={() => afterSend({ kind: "resent", account: resendTarget })}
        />
      )}

      {toast && <Toast title={toast.title} detail={toast.detail} onDone={clearToast} />}
    </>
  );
}

function Metric({ label, value, sub }: { label: string; value: number; sub: string }) {
  return (
    <div className="metric">
      <span className="metric-label">{label}</span>
      <div>
        <strong className="metric-value">{value}</strong>
        <span className="metric-sub">{sub}</span>
      </div>
    </div>
  );
}

function Status({ status }: { status: AccountStatus }) {
  return (
    <span className={`status status--${status}`}>
      <span className="status-dot" aria-hidden="true" />
      {STATUS_LABEL[status]}
    </span>
  );
}

/** 「계정 만들기」 창(B · C · D). 보내기 전 확인은 이 창 하나로 해요. */
function CreateDialog({
  staff,
  onClose,
  onCreated,
  onResent,
}: {
  staff: Staff;
  onClose: () => void;
  onCreated: (a: Account) => void;
  onResent: (email: string) => void;
}) {
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [language, setLanguage] = useState<MailLanguage>("en");
  const [companyError, setCompanyError] = useState("");
  const [emailError, setEmailError] = useState("");
  const [formError, setFormError] = useState("");
  const [check, setCheck] = useState<{ email: string; result: EmailCheck } | null>(null);
  const [sending, setSending] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const companyRef = useRef<HTMLInputElement>(null);

  const trimmed = email.trim();
  const key = trimmed.toLowerCase();
  const current = check && check.email === key ? check.result : null;
  const pending = current?.status === "pending" ? current : null;
  const inUse = current?.status === "in_use";

  async function runCheck(): Promise<EmailCheck | null> {
    if (!EMAIL_RE.test(trimmed)) return null;
    if (current) return current;
    const asked = key;
    const result = await checkEmail(trimmed);
    // 조회하는 사이 이메일을 고쳤으면 버려요.
    if (emailRef.current?.value.trim().toLowerCase() !== asked) return null;
    setCheck({ email: asked, result });
    // 첫 로그인 전이면 메일 언어를 처음 보낸 언어로 미리 골라 둬요.
    if (result.status === "pending") setLanguage(result.language);
    return result;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (sending) return;
    let cError = "";
    let eError = "";
    if (!company.trim()) cError = "회사명을 입력해 주세요.";
    else if (company.trim().length > COMPANY_MAX) cError = `회사명은 ${COMPANY_MAX}자까지 쓸 수 있습니다.`;
    if (!trimmed) eError = "고객 이메일을 입력해 주세요.";
    else if (!EMAIL_RE.test(trimmed)) eError = "이메일 형식을 확인해 주세요.";
    setCompanyError(cError);
    setEmailError(eError);
    setFormError("");
    if (cError) return companyRef.current?.focus();
    if (eError) return emailRef.current?.focus();

    // 아직 조회 전이면 먼저 조회해요. 상태가 새로 드러나면 보내지 않고 칸 아래에 먼저 보여 줘요.
    let state = current;
    if (!state) {
      state = await runCheck();
      if (!state || state.status !== "new") return emailRef.current?.focus();
    }
    if (state.status === "in_use") return;

    setSending(true);
    const input = { company: company.trim(), email: trimmed, language };
    if (state.status === "pending") {
      const res = await resendGuide(input);
      setSending(false);
      if (res.ok) return onResent(trimmed);
      setFormError("안내 메일을 보내지 못했습니다. 다시 시도해 주세요.");
      return;
    }
    const res = await createAccount(input, staff);
    setSending(false);
    if (res.ok) return onCreated(res.account);
    if (res.reason === "duplicate" || res.reason === "in_use") {
      // 조회와 보내기 사이에 상태가 바뀐 경우: 다시 조회해서 칸 아래에 보여 줘요.
      const result = await checkEmail(trimmed);
      setCheck({ email: key, result });
      if (result.status === "pending") setLanguage(result.language);
      emailRef.current?.focus();
    } else setFormError("계정을 만들지 못했습니다. 다시 시도해 주세요.");
  }

  return (
    <Dialog title="Gate 계정 만들기" onClose={onClose} closable={!sending}>
      <form className="dialog-form" onSubmit={onSubmit} noValidate>
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
            <p id="company-error" className="error">
              {companyError}
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor="email" className="t-body-200-b">
            고객 이메일
          </label>
          <div className={`input-box${emailError || inUse ? " is-error" : ""}`}>
            <input
              ref={emailRef}
              id="email"
              type="email"
              inputMode="email"
              autoComplete="off"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (emailError) setEmailError("");
              }}
              onBlur={() => void runCheck()}
              aria-invalid={!!emailError || inUse}
              aria-describedby="email-note"
            />
          </div>
          <div id="email-note" role="status" aria-live="polite">
            {emailError ? (
              <p className="error">{emailError}</p>
            ) : inUse ? (
              // 정말 막힌 경우: 빨간 한 줄 + 실행 버튼 비활성
              <p className="error">이미 사용 중인 계정입니다. 「비밀번호 재설정」을 안내해 주세요.</p>
            ) : pending ? (
              // 오류가 아니라 할 일이 바뀐 경우: 회색 안내 + 실행 버튼이 「안내 메일 다시 보내기」
              <p className="help">
                이미 만든 계정입니다({handle(pending.createdBy)} · {fmtMonthDay(pending.createdAt)}). 로그인 전이라 다시 보낼 수 있습니다.
              </p>
            ) : (
              <p className="help">주소가 틀리면 다른 사람이 계정을 받습니다.</p>
            )}
          </div>
        </div>

        <div className="field">
          <span id="language-label" className="t-body-200-b">
            메일 언어
          </span>
          <div className="segmented" role="radiogroup" aria-labelledby="language-label">
            {LANGUAGES.map(({ value, label, Flag }) => (
              <button key={value} type="button" role="radio" aria-checked={language === value} onClick={() => setLanguage(value)}>
                <Flag />
                {label}
              </button>
            ))}
          </div>
        </div>

        {pending && <p className="help">다시 보내면 이전 임시 비밀번호는 쓸 수 없게 됩니다.</p>}
        {formError && (
          <p className="error" role="alert">
            {formError}
          </p>
        )}

        <div className="dialog-actions">
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={sending}>
            취소
          </button>
          <button type="submit" className="btn btn-dark" disabled={inUse || sending} aria-busy={sending || undefined}>
            {sending ? "보내는 중…" : pending ? "안내 메일 다시 보내기" : "계정 만들고 메일 보내기"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** 목록 줄의 「안내 메일 다시 보내기」 확인 창(F) */
function ResendDialog({ account, onClose, onResent }: { account: Account; onClose: () => void; onResent: () => void }) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  async function send() {
    setSending(true);
    setError("");
    const res = await resendGuide({ company: account.company, email: account.email, language: account.language });
    setSending(false);
    if (res.ok) return onResent();
    setError("안내 메일을 보내지 못했습니다. 다시 시도해 주세요.");
  }

  return (
    <Dialog title="안내 메일 다시 보내기" onClose={onClose} closable={!sending}>
      <div className="summary">
        <div className="summary-target">
          <strong>{account.company}</strong>
          <span>{account.email}</span>
        </div>
        <dl className="summary-rows">
          <div>
            <dt>메일 언어</dt>
            <dd>{languageName(account.language)}</dd>
          </div>
          <div>
            <dt>임시 비밀번호</dt>
            <dd>새로 발급 · 이전 비밀번호는 사용 불가</dd>
          </div>
        </dl>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button type="button" className="btn btn-outline" onClick={onClose} disabled={sending}>
          취소
        </button>
        <button type="button" className="btn btn-dark" onClick={send} disabled={sending} aria-busy={sending || undefined}>
          {sending ? "보내는 중…" : "다시 보내기"}
        </button>
      </div>
    </Dialog>
  );
}
