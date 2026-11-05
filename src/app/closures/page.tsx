"use client";

// 「계정 해지」(UG-443 기획 16871 — T1 처리 기록 목록 · T2 계정 찾기 · T3 확인 후 실행).
// 고객이 support@univs.ai 로 탈퇴를 요청하면 직원이 여기서 실행해요(약관 제27조). 콘솔에는 탈퇴 버튼이 없어요.
// 처리는 서버가 단계마다 기록하며 이어 가요(로그인 막기 → 프로젝트 · 데이터 파기 → 계정 삭제 → 처리 기록). 이 화면은 기록을 보여 주고
// 실행 · 다시 시도만 해요. 결과 알림 메일은 만들지 않아요 — 직원이 고객의 탈퇴 요청 메일에 답장해요(Figma 규칙 10번 문안).
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog, PopupSelect, Toast } from "@/components/ui";
import { AppHeader } from "@/components/app-header";
import { IcArrowLeft, IcArrowRight, IcInputClose, IcSearch } from "@/components/icons";
import {
  findClosureTarget,
  listClosures,
  logout,
  retryClosure,
  startClosure,
  withdrawClosure,
  type Closure,
  type ClosureStatus,
  type ClosureStep,
  type ClosureTarget,
} from "@/lib/api";
import { useStaff } from "@/lib/session";
import { fmtDate, fmtFull, handle, kstToday, pageItems } from "@/lib/format";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// 문구 대조표(기획 16871 · Figma)에 있는 것은 그대로, 없는 것은 우리가 지었어요(보고서 「우리가 정한 것」).
const STATUS_LABEL: Record<ClosureStatus, string> = { processing: "처리 중", failed: "실패", completed: "파기 완료", withdrawn: "철회됨" };
const STEP_LABEL: Record<ClosureStep, string> = {
  suspend: "로그인 막기",
  gate_purge: "프로젝트 · 데이터 파기",
  auth_delete: "계정 삭제",
  record: "처리 기록",
};
const LOAD_FAILED = "목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
const NOT_FOUND = "이 이메일로 가입한 계정이 없습니다.";
const STAFF_TARGET = "백오피스 직원 계정은 여기서 해지할 수 없습니다.";
const FIND_FAILED = "계정을 찾지 못했습니다. 잠시 후 다시 시도해 주세요.";
const ALREADY = "이미 해지를 실행한 계정입니다. 목록에서 진행 상황을 확인해 주세요.";
const WARNING = "해지하면 계정과 위 데이터를 5일 안에 모두 파기합니다. 되살릴 수 없습니다.";
/** 처리 중인 줄이 있으면 이 간격으로 목록을 다시 받아요 — 서버가 단계를 이어 가요 */
const POLL_MS = 15_000;

/** 멈춘 까닭 — 표의 「실패」에 마우스를 올리면 보여요 */
function failureText(c: Closure): string {
  const where = `${STEP_LABEL[c.step]} 단계에서 멈췄습니다.`;
  switch (c.failureCode) {
    case "auth_protected":
      return `${where} 계정 서버가 이 계정을 지울 수 없다고 했습니다(관리자 · 상위 권한). 플랫폼 팀에 알려 주세요.`;
    case "auth_last_owner":
      return `${where} 이 회사의 마지막 관리자 계정이라 계정 서버가 지울 수 없다고 했습니다. 플랫폼 팀에 알려 주세요.`;
    case "actor_rejected":
      return `${where} 실행한 직원 계정을 지금 쓸 수 없습니다. 다른 직원이 다시 시도해 주세요.`;
    case "auth_not_configured":
      return `${where} 계정 서버 연결 설정 문제입니다. 플랫폼 팀에 알려 주세요.`;
    case "gate_timeout":
      return `${where} 파기가 24시간 안에 끝나지 않았습니다. 다시 시도해 주세요.`;
    default:
      return `${where} 다시 시도해 주세요.`;
  }
}

function ClosureStatusBadge({ closure }: { closure: Closure }) {
  const title =
    closure.status === "failed"
      ? failureText(closure)
      : closure.status === "processing"
        ? closure.authWaiting
          ? "계정 서버의 해지 기능을 기다리고 있습니다. 준비되면 이어서 처리합니다."
          : `${STEP_LABEL[closure.step]} 중입니다.`
        : undefined;
  return (
    <span className={`status status--${closure.status}`} title={title}>
      <span className="status-dot" aria-hidden="true" />
      {STATUS_LABEL[closure.status]}
    </span>
  );
}

/** 이메일을 비운 기록(파기 완료 · 철회)에 마우스를 올리면 보여요(UG-450) */
const SCRUBBED_EMAIL_TIP = "파기되어 도메인만 남겼어요";
/**
 * 고객 이메일. 파기 완료 · 철회한 기록은 서버가 이메일 · 회사명을 비우고 도메인(@example.com)만 남겨요 —
 * 도메인만 덩그러니 보이면 주소로 읽혀 「…@example.com」으로 앞이 지워졌음을 보여 주고 「—」와 같은 회색으로(UG-450).
 * tip: 마우스를 올리면 까닭(PC 목록 · 철회 창). 휴대폰 카드는 마우스가 없어 빼요.
 */
function ClosureEmail({ closure, tip = false }: { closure: Closure; tip?: boolean }) {
  if (closure.email) return <span>{closure.email}</span>;
  return (
    <span className="dash" title={tip ? SCRUBBED_EMAIL_TIP : undefined}>
      {`\u2026${closure.emailDomain}`}
    </span>
  );
}
/** 처리 일시 = 파기 완료 시각(약관 기준). 철회했으면 철회 시각, 끝나기 전에는 실행 시각을 흐리게 */
const processedAtText = (c: Closure) =>
  c.completedAt
    ? fmtFull(c.completedAt)
    : c.status === "withdrawn" && c.withdrawnAt
      ? `${fmtFull(c.withdrawnAt)} 철회`
      : `${fmtFull(c.requestedAt)} 실행`;
function processedAt(c: Closure) {
  return c.completedAt ? processedAtText(c) : <span className="help">{processedAtText(c)}</span>;
}

type ToastState = { title: string; detail: string; tone?: "error" } | null;

export default function ClosuresPage() {
  const router = useRouter();
  const staff = useStaff();

  const [rows, setRows] = useState<Closure[]>([]);
  const [total, setTotal] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState<ClosureStatus | "all">("all");
  const [applied, setApplied] = useState<{ keyword: string; status: ClosureStatus | "all" }>({ keyword: "", status: "all" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [version, setVersion] = useState(0);
  const [opening, setOpening] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [withdrawTarget, setWithdrawTarget] = useState<Closure | null>(null);
  const [freshId, setFreshId] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (staff === null) router.replace("/login");
  }, [staff, router]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const clearToast = useCallback(() => setToast(null), []);

  useEffect(() => {
    if (!staff) return;
    let alive = true;
    listClosures({ ...applied, page, size: pageSize })
      .then((list) => {
        if (!alive) return;
        const last = Math.max(1, Math.ceil(list.total / pageSize));
        if (list.items.length === 0 && page > last) {
          setPage(last);
          return;
        }
        setRows(list.items);
        setTotal(list.total);
        setLoadError(false);
        setLoaded(true);
      })
      .catch(() => {
        if (alive) setLoadError(true);
      });
    return () => {
      alive = false;
    };
  }, [staff, applied, page, pageSize, version]);

  // 처리 중인 줄이 보이면 조금씩 다시 받아요(파기 완료 · 실패로 바뀌는 것을 보여 주려고).
  // 계정 서버 대기만 남았으면 멈춰요 — 그 줄은 계정 서버 기능이 켜질 때까지 바뀌지 않아요.
  const hasProcessing = rows.some((r) => r.status === "processing" && !r.authWaiting);
  useEffect(() => {
    if (!hasProcessing) return;
    const t = setInterval(reload, POLL_MS);
    return () => clearInterval(t);
  }, [hasProcessing, reload]);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, pageCount);
  const from = total ? (current - 1) * pageSize + 1 : 0;
  const to = Math.min(current * pageSize, total);
  const filtered = applied.keyword !== "" || applied.status !== "all";
  const emptyText = loadError
    ? LOAD_FAILED
    : !loaded
      ? "불러오는 중…"
      : !filtered && total === 0
        ? "아직 해지한 계정이 없습니다."
        : "검색 결과가 없습니다.";

  function onSearch(e?: React.FormEvent) {
    e?.preventDefault();
    setApplied({ keyword: keyword.trim(), status });
    setPage(1);
  }
  function onReset() {
    setKeyword("");
    setStatus("all");
    setApplied({ keyword: "", status: "all" });
    setPage(1);
  }
  function clearKeyword() {
    setKeyword("");
    setApplied((a) => ({ ...a, keyword: "" }));
    setPage(1);
    searchRef.current?.focus();
  }
  function pickStatus(v: ClosureStatus | "all") {
    setStatus(v);
    setApplied((a) => ({ ...a, status: v }));
    setPage(1);
  }
  function goPage(n: number) {
    setPage(Math.min(Math.max(n, 1), pageCount));
    window.scrollTo({ top: 0 });
  }

  async function retry(c: Closure) {
    setRetrying(c.id);
    const res = await retryClosure(c.id);
    setRetrying(null);
    if (res.ok) {
      setToast({ title: "다시 시도합니다", detail: `${STEP_LABEL[res.closure.step]} 단계부터 이어서 처리합니다` });
    } else if (res.reason === "not_retryable") {
      setToast({ tone: "error", title: "다시 시도할 수 없습니다", detail: "이미 처리 중이거나 끝났습니다. 목록을 새로 불러옵니다" });
    } else {
      setToast({ tone: "error", title: "다시 시도하지 못했습니다", detail: "잠시 후 다시 눌러 주세요" });
    }
    reload();
  }

  const onStarted = useCallback(
    (c: Closure) => {
      setOpening(false);
      setFreshId(c.id);
      setApplied({ keyword: "", status: "all" });
      setKeyword("");
      setStatus("all");
      setPage(1);
      reload();
      setToast({ title: "계정 해지를 시작했습니다", detail: "파기가 끝나면 상태가 「파기 완료」로 바뀝니다" });
    },
    [reload],
  );

  if (!staff) return null;

  return (
    <>
      <AppHeader
        current="closures"
        email={staff.email}
        onLogout={() => {
          logout();
          router.replace("/login");
        }}
      />

      <div className="breadcrumb">
        <span>BACKOFFICE</span>
        <IcArrowRight size={14} className="breadcrumb-sep" />
        <span className="breadcrumb-current">계정 해지</span>
      </div>

      <main className="content">
        <div className="page-title">
          <h1 className="t-heading-300">계정 해지</h1>
          <div className="page-actions">
            <button type="button" className="btn btn-dark btn-sm" onClick={() => setOpening(true)}>
              계정 해지
            </button>
          </div>
        </div>

        <form className="toolbar" onSubmit={onSearch} role="search">
          <label className="search">
            <IcSearch size={16} className="search-icon" />
            <span className="visually-hidden">검색어</span>
            <input
              ref={searchRef}
              type="search"
              enterKeyHint="search"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && keyword) {
                  e.preventDefault();
                  clearKeyword();
                }
              }}
              placeholder="고객 이메일, 회사명 검색"
            />
            {keyword && (
              <button type="button" className="search-clear" onClick={clearKeyword} aria-label="검색어 지우기">
                <IcInputClose size={18} />
              </button>
            )}
          </label>
          <PopupSelect<ClosureStatus | "all">
            className="select"
            label="상태"
            value={status}
            onChange={setStatus}
            options={[
              { value: "all", label: "상태 전체" },
              { value: "processing", label: STATUS_LABEL.processing },
              { value: "failed", label: STATUS_LABEL.failed },
              { value: "completed", label: STATUS_LABEL.completed },
              { value: "withdrawn", label: STATUS_LABEL.withdrawn },
            ]}
          />
          <button type="submit" className="btn btn-outline btn-sm">
            검색
          </button>
          <button type="button" className="btn btn-outline btn-sm" onClick={onReset}>
            초기화
          </button>
          {/* 휴대폰: 상태 칩 — PC 는 위 선택 상자 */}
          <div className="status-chips" role="group" aria-label="상태">
            {(["all", "processing", "failed", "completed", "withdrawn"] as const).map((v) => (
              <button
                key={v}
                type="button"
                className={`status-chip${applied.status === v ? " is-on" : ""}`}
                aria-pressed={applied.status === v}
                onClick={() => pickStatus(v)}
              >
                {v === "all" ? "전체" : STATUS_LABEL[v]}
              </button>
            ))}
          </div>
          <span className="count">총 {total}개</span>
          {loadError && rows.length > 0 && (
            <span className="error" role="alert">
              {LOAD_FAILED}
            </span>
          )}
        </form>

        {/* PC: 표 */}
        <div className="table" role="table" aria-label="계정 해지 처리 기록">
          <div className="tr th" role="row">
            {["회사명", "고객 이메일", "프로젝트", "상태", "처리자", "처리 일시", "관리"].map((h) => (
              <span key={h} role="columnheader">
                {h}
              </span>
            ))}
          </div>
          {rows.length === 0 ? (
            <div className="empty">
              <p>{emptyText}</p>
              {loaded && !loadError && filtered && (
                <button type="button" className="empty-action" onClick={onReset}>
                  검색 초기화
                </button>
              )}
            </div>
          ) : (
            rows.map((c) => (
              <div key={c.id} className={`tr${c.id === freshId ? " is-new" : ""}`} role="row">
                <span role="cell">{c.company ?? <span className="dash">—</span>}</span>
                <span role="cell">
                  <ClosureEmail closure={c} tip />
                </span>
                <span role="cell">{c.projectCount}개</span>
                <span role="cell">
                  <ClosureStatusBadge closure={c} />
                </span>
                <span role="cell">{handle(c.processedBy)}</span>
                <span role="cell">{processedAt(c)}</span>
                <span role="cell">
                  <span className="row-actions">
                    {c.status === "failed" && (
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={() => retry(c)}
                        disabled={retrying !== null}
                        aria-busy={retrying === c.id || undefined}
                        title={failureText(c)}
                      >
                        {retrying === c.id ? "다시 시도하는 중…" : "다시 시도"}
                      </button>
                    )}
                    {c.status === "processing" && c.authWaiting && <span className="cancel-note">계정 서버 대기</span>}
                    {c.withdrawable && (
                      <button type="button" className="btn btn-outline btn-sm" onClick={() => setWithdrawTarget(c)} disabled={retrying !== null}>
                        철회
                      </button>
                    )}
                    {c.status !== "failed" && !(c.status === "processing" && c.authWaiting) && !c.withdrawable && (
                      <span className="dash">—</span>
                    )}
                  </span>
                </span>
              </div>
            ))
          )}
        </div>

        {/* 휴대폰: 줄마다 카드 */}
        <ul className="cards" aria-label="계정 해지 처리 기록">
          {rows.length === 0 && (
            <li className="empty">
              <p>{emptyText}</p>
            </li>
          )}
          {rows.map((c) => (
            <li
              key={c.id}
              className={`card-row${c.id === freshId ? " is-new" : ""}${c.status === "completed" || c.status === "withdrawn" ? " is-cancelled" : ""}`}
            >
              <div className="card-line">
                <strong className="card-company">{c.company ?? <span className="dash">—</span>}</strong>
                <span className="card-status">
                  <ClosureStatusBadge closure={c} />
                </span>
              </div>
              <div className="card-line">
                <span className="card-email">
                  <ClosureEmail closure={c} />
                </span>
                {c.status === "failed" ? (
                  <button type="button" className="link-action" onClick={() => retry(c)} disabled={retrying !== null}>
                    {retrying === c.id ? "다시 시도하는 중…" : "다시 시도"}
                  </button>
                ) : (
                  c.withdrawable && (
                    <button type="button" className="link-action" onClick={() => setWithdrawTarget(c)}>
                      철회
                    </button>
                  )
                )}
              </div>
              <div className="card-line">
                <span className="card-meta">
                  {`프로젝트 ${c.projectCount}개 · ${handle(c.processedBy)} · ${processedAtText(c)}`}
                </span>
              </div>
            </li>
          ))}
        </ul>

        {total > 0 && (
          <nav className={`pagination${pageCount <= 1 ? " is-single" : ""}`} aria-label="페이지">
            <span className="pagination-range">
              {from}–{to} / {total}개
            </span>
            <div className="pages">
              <button type="button" className="page-btn" onClick={() => goPage(current - 1)} disabled={current <= 1} aria-label="이전 페이지">
                <IcArrowLeft size={16} />
              </button>
              {pageItems(current, pageCount).map((n, i) =>
                n === "gap" ? (
                  <span key={`gap-${i}`} className="page-gap" aria-hidden="true">
                    …
                  </span>
                ) : (
                  <button
                    key={n}
                    type="button"
                    className={`page-btn${n === current ? " is-current" : ""}`}
                    aria-current={n === current ? "page" : undefined}
                    onClick={() => goPage(n)}
                  >
                    {n}
                  </button>
                ),
              )}
              <button
                type="button"
                className="page-btn"
                onClick={() => goPage(current + 1)}
                disabled={current >= pageCount}
                aria-label="다음 페이지"
              >
                <IcArrowRight size={16} />
              </button>
            </div>
            <PopupSelect<number>
              className="page-size"
              label="한 페이지에 보기"
              placement="top"
              value={pageSize}
              onChange={(n) => {
                setPageSize(n);
                setPage(1);
              }}
              options={[10, 20, 50].map((n) => ({ value: n, label: `${n}개씩 보기` }))}
            />
          </nav>
        )}
      </main>

      {opening && (
        <CloseAccountDialog
          onClose={() => {
            setOpening(false);
            reload();
          }}
          onStarted={onStarted}
        />
      )}

      {withdrawTarget && (
        <WithdrawDialog
          closure={withdrawTarget}
          onClose={() => {
            setWithdrawTarget(null);
            reload();
          }}
          onWithdrawn={() => {
            setWithdrawTarget(null);
            reload();
            setToast({ title: "해지를 철회했습니다", detail: "아무것도 지우지 않았습니다" });
          }}
        />
      )}

      {toast && <Toast title={toast.title} detail={toast.detail} tone={toast.tone} onDone={clearToast} />}
    </>
  );
}

/**
 * T2(계정 찾기) → T3(지워질 것 확인 후 실행). 한 창 안에서 넘어가요.
 * T3: 확인 칸에 계정 이메일을 똑같이(대소문자 무시) 입력해야 빨간 [계정 해지]가 켜져요. 「고객이 탈퇴를 요청한 날」은 오늘로 채워 두고 고칠 수 있어요.
 */
function CloseAccountDialog({ onClose, onStarted }: { onClose: () => void; onStarted: (c: Closure) => void }) {
  const [email, setEmail] = useState("");
  const [finding, setFinding] = useState(false);
  const [findError, setFindError] = useState("");
  const [target, setTarget] = useState<ClosureTarget | null>(null);
  const [requestedOn, setRequestedOn] = useState(() => kstToday());
  const [confirm, setConfirm] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  // 빠르게 두 번 눌러도(Enter + 클릭) 한 번만 보내요 — sending 상태는 다음 그리기까지 늦어요
  const sendingRef = useRef(false);
  const today = kstToday();
  const oldest = (() => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 365);
    return d.toISOString().slice(0, 10);
  })();

  async function find(e: React.FormEvent) {
    e.preventDefault();
    const value = email.trim();
    if (!EMAIL_RE.test(value)) {
      setFindError("이메일 형식을 확인해 주세요.");
      return;
    }
    setFinding(true);
    setFindError("");
    const res = await findClosureTarget(value);
    setFinding(false);
    if (!res.ok) {
      setFindError(res.reason === "not_found" ? NOT_FOUND : res.reason === "staff" ? STAFF_TARGET : FIND_FAILED);
      return;
    }
    if (res.target.closure) {
      setFindError(ALREADY);
      return;
    }
    setTarget(res.target);
  }

  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(requestedOn) && requestedOn <= today && requestedOn >= oldest;
  const confirmed = !!target && confirm.trim().toLowerCase() === target.email.toLowerCase();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!target || !confirmed || !dateValid || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setSendError("");
    const res = await startClosure({ email: target.email, confirmEmail: confirm.trim(), requestedOn });
    sendingRef.current = false;
    setSending(false);
    if (res.ok) return onStarted(res.closure);
    setSendError(
      res.reason === "exists"
        ? ALREADY
        : res.reason === "not_found"
          ? NOT_FOUND
          : res.reason === "staff"
            ? STAFF_TARGET
            : res.reason === "invalid"
              ? "확인 이메일과 탈퇴 요청일을 다시 확인해 주세요."
              : "계정 해지를 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    );
  }

  if (!target) {
    return (
      <Dialog title="계정 해지" onClose={onClose} closable={!finding}>
        <form className="dialog-form" onSubmit={find} noValidate>
          <div className="field">
            <label htmlFor="closure-email" className="t-body-200-b">
              탈퇴를 요청한 계정 이메일
            </label>
            <div className={`input-box${findError ? " is-error" : ""}`}>
              <input
                id="closure-email"
                type="email"
                inputMode="email"
                autoComplete="off"
                placeholder="name@company.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setFindError("");
                }}
                aria-invalid={!!findError}
                aria-describedby="closure-email-note"
              />
            </div>
            <div id="closure-email-note" role="status" aria-live="polite">
              {findError ? <p className="error">{findError}</p> : <p className="help">탈퇴 요청 메일을 보낸 주소와 같은 계정만 해지합니다.</p>}
            </div>
          </div>
          <div className="dialog-actions">
            <button type="button" className="btn btn-outline" onClick={onClose} disabled={finding}>
              취소
            </button>
            <button type="submit" className="btn btn-dark" disabled={finding || !email.trim()} aria-busy={finding || undefined}>
              {finding ? "찾는 중…" : "계정 찾기"}
            </button>
          </div>
        </form>
      </Dialog>
    );
  }

  const joined =
    target.signupType === "sales"
      ? [target.signedUpAt ? fmtDate(target.signedUpAt) : "", "영업 발급"].filter(Boolean).join(" · ")
      : "직접 가입";

  return (
    <Dialog title="계정 해지" onClose={onClose} closable={!sending}>
      <form className="dialog-form" onSubmit={submit} noValidate>
        <div className="closure-summary">
          <dl className="summary-rows summary-rows--strong">
            <div>
              <dt>회사명</dt>
              <dd>{target.company ?? "—"}</dd>
            </div>
            <div>
              <dt>계정</dt>
              <dd>{target.email}</dd>
            </div>
            <div>
              <dt>가입일</dt>
              <dd>{joined}</dd>
            </div>
            <div>
              <dt>지워지는 것</dt>
              <dd>
                {`프로젝트 ${target.projects.toLocaleString("ko-KR")}개 · 등록 ${target.registrations.toLocaleString("ko-KR")}건 · ` +
                  `인증 기록 ${target.authRecords.toLocaleString("ko-KR")}건 · 사진 · API 키`}
              </dd>
            </div>
          </dl>
        </div>

        <p className="closure-warning" role="note">
          {WARNING}
        </p>

        <div className="field">
          <label htmlFor="closure-requested-on" className="t-body-200-b">
            고객이 탈퇴를 요청한 날
          </label>
          <div className={`input-box${dateValid ? "" : " is-error"}`}>
            <input
              id="closure-requested-on"
              type="date"
              value={requestedOn}
              max={today}
              min={oldest}
              onChange={(e) => setRequestedOn(e.target.value)}
              aria-invalid={!dateValid}
            />
          </div>
          {!dateValid && <p className="error">오늘부터 1년 전까지의 날짜를 넣어 주세요.</p>}
        </div>

        <div className="field">
          <label htmlFor="closure-confirm" className="t-body-200-b">
            확인을 위해 계정 이메일을 입력해 주세요
          </label>
          <div className="input-box">
            <input
              id="closure-confirm"
              type="email"
              inputMode="email"
              autoComplete="off"
              placeholder={target.email}
              value={confirm}
              onChange={(e) => {
                setConfirm(e.target.value);
                setSendError("");
              }}
            />
          </div>
        </div>

        {sendError && (
          <p className="error" role="alert">
            {sendError}
          </p>
        )}

        <div className="dialog-actions">
          {/* 처음 초점은 「취소」 — Enter 한 번에 실행되지 않게 */}
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={sending} data-autofocus>
            취소
          </button>
          <button type="submit" className="btn btn-danger" disabled={!confirmed || !dateValid || sending} aria-busy={sending || undefined}>
            {sending ? "해지하는 중…" : "계정 해지"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** [철회] 확인 창 — 아직 아무것도 지우지 않은 해지만(서버가 다시 판정해요). 처음 초점은 「취소」. */
function WithdrawDialog({ closure, onClose, onWithdrawn }: { closure: Closure; onClose: () => void; onWithdrawn: () => void }) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<"" | "not_withdrawable" | "not_found" | "failed">("");
  const sendingRef = useRef(false);

  async function withdraw() {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setError("");
    const res = await withdrawClosure(closure.id);
    sendingRef.current = false;
    setSending(false);
    if (res.ok) return onWithdrawn();
    setError(res.reason);
  }

  const gone = error === "not_withdrawable" || error === "not_found";
  return (
    <Dialog title="해지 철회" onClose={onClose} closable={!sending}>
      <div className="summary">
        <div className="summary-target">
          {closure.company && <strong>{closure.company}</strong>}
          <ClosureEmail closure={closure} tip />
        </div>
      </div>
      <p>해지를 철회할까요? 아직 지운 데이터는 없습니다.</p>
      {error && (
        <p className="error" role="alert">
          {gone ? "이미 로그인 막기가 시작됐거나 끝나 철회할 수 없습니다. 목록을 새로 불러옵니다." : "철회하지 못했습니다. 다시 시도해 주세요."}
        </p>
      )}
      <div className="dialog-actions">
        {gone ? (
          <button type="button" className="btn btn-outline" onClick={onClose} autoFocus>
            닫기
          </button>
        ) : (
          <>
            <button type="button" className="btn btn-outline" onClick={onClose} disabled={sending} data-autofocus>
              취소
            </button>
            <button type="button" className="btn btn-danger-outline" onClick={withdraw} disabled={sending} aria-busy={sending || undefined}>
              {sending ? "철회하는 중…" : "철회"}
            </button>
          </>
        )}
      </div>
    </Dialog>
  );
}
