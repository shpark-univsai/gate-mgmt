"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog, PopupSelect, Toast } from "@/components/ui";
import { AppHeader } from "@/components/app-header";
import { fmtFull, fmtShort, handle, kstParts, pageItems } from "@/lib/format";
import { FlagKR, FlagUS } from "@/components/flags";
import { IcArrowDown, IcArrowLeft, IcArrowRight, IcCamera, IcInputClose, IcMoreVert, IcReload, IcSearch } from "@/components/icons";
import {
  cancelIssue,
  checkEmail,
  createAccount,
  deleteCardDraft,
  exportAccounts,
  getCardDraft,
  getSummary,
  listAccounts,
  listCardDrafts,
  logout,
  resendGuide,
  saveCardDraft,
  CARD_DRAFT_MAX,
  type Account,
  type AccountStatus,
  type AccountSummary,
  type CancelFailure,
  type CardDraft,
  type CardDraftDetail,
  type CardDraftInput,
  type EmailCheck,
  type MailFailureReason,
  type MailLanguage,
  type ResendFailure,
} from "@/lib/api";
import { useStaff } from "@/lib/session";
import { buildAccountsCsv, exportFileName } from "@/lib/accounts-csv";
import { createCardReader } from "@/lib/card-ocr";
import { CARD_PHOTO_TEXT, purgeLegacyCardPhotos } from "@/lib/card-photo";
import { chipsForDraft, draftField, photoForDraft, photoFromDraft, scanFromDraft } from "@/lib/card-draft";
import {
  confusableParts,
  emailDomain,
  emailHasConfusable,
  isFilled,
  scanCard,
  tapChip,
  unlink,
  type Chip,
  type ScanField,
  type ScanLinks,
} from "@/lib/card-scan";

const COMPANY_MAX = 40;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// 고객 이름 · 연락처(UG-431) — 서버(CreateAccountRequest)와 같은 한도 · 같은 글자
const NAME_MAX = 40;
const PHONE_MAX = 30;
const PHONE_RE = /^[0-9 +()-]*$/;

/** 이름 칸 안내. required = 새로 만들 때(고치는 재발송의 옛 기록은 비어도 돼요) */
const nameErrorOf = (v: string, required: boolean) =>
  !v ? (required ? "이름을 입력해 주세요." : "") : v.length > NAME_MAX ? `이름은 ${NAME_MAX}자까지 쓸 수 있습니다.` : "";
/** 연락처 칸 안내 — 선택 항목이라 비면 통과 */
const phoneErrorOf = (v: string) =>
  !v
    ? ""
    : v.length > PHONE_MAX
      ? `연락처는 ${PHONE_MAX}자까지 쓸 수 있습니다.`
      : !PHONE_RE.test(v)
        ? "연락처에는 숫자 · 공백 · + - ( ) 만 쓸 수 있습니다."
        : "";
/** 만들기 요청의 이름 · 연락처 — 빈 값은 보내지 않아요 */
const personInput = (name: string, phone: string) => ({ ...(name ? { name } : {}), ...(phone ? { phone } : {}) });

// 안내 문구는 명함 사진 문구와 함께 card-photo.ts 한 곳에
const SCAN_HELP = CARD_PHOTO_TEXT.scanHelp;
const SCAN_READING = "명함을 읽고 있습니다…";
// 읽는 동안만(N2) — 첫 읽기는 글자 읽기 도구(약 8MB)를 내려받아 더 걸려요
const SCAN_WAIT = "보통 몇 초 걸립니다. 처음 한 번은 글자 읽기 도구를 내려받아 조금 더 걸립니다.";
const SCAN_DONE = "명함에서 읽었습니다. 틀린 글자가 있을 수 있으니 고객과 함께 확인해 주세요.";
// 읽기 도구를 받지 못했거나(첫 사용 · 인터넷 없음) 글자를 찾지 못함 — 막힌 게 아니라 직접 입력하면 돼서 회색
const SCAN_FAILED = "명함을 읽지 못했습니다. 다시 찍거나 직접 입력해 주세요.";

const LANGUAGES: { value: MailLanguage; label: string; Flag: () => React.ReactElement }[] = [
  { value: "en", label: "English", Flag: FlagUS },
  { value: "ko", label: "한국어", Flag: FlagKR },
];
const languageName = (l: MailLanguage) => (l === "en" ? "English" : "한국어");
/** 휴대폰 카드용 짧은 표기 */
const languageShort = (l: MailLanguage) => (l === "en" ? "EN" : "KO");
// closed = 계정 해지(UG-443)가 끝나 정리된 기록 — 기획 16871 「해지됨」
// closing = 해지 중(UG-443 기획 16908) — 계정 해지가 끝나기 전. 그동안 다시 보내기 · 발급 취소를 막아요
const STATUS_LABEL: Record<AccountStatus, string> = {
  pending: "첫 로그인 전",
  in_use: "사용 중",
  closing: "해지 중",
  cancelled: "발급 취소",
  closed: "해지됨",
};
/** 해지 중인 줄의 동작 안내(툴팁) */
const CLOSING_TIP = "해지 처리 중인 계정입니다";
/** 발급 취소 · 해지됨 — 계정이 없어진 기록(고객 정보를 비웠어요). 목록 줄 · 카드가 흐리게 · 누가 · 언제만 보여요. */
const isGone = (a: Account) => a.status === "cancelled" || a.status === "closed";

/** 검색어와 맞은 글자에 바탕색 — 대소문자 구분 없이, 여러 번 나오면 모두. */
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLowerCase();
  if (!q) return text;
  const lower = text.toLowerCase();
  const parts: React.ReactNode[] = [];
  let from = 0;
  for (let at = lower.indexOf(q); at !== -1; at = lower.indexOf(q, from)) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(<mark key={at} className="hit">{text.slice(at, at + q.length)}</mark>);
    from = at + q.length;
  }
  if (from < text.length) parts.push(text.slice(from));
  return parts;
}

/** 결과 없음 — 무엇으로 찾았는지 그대로 보여 줘요(검색어는 굵게). */
function noResultText({ keyword, status }: { keyword: string; status: AccountStatus | "all" }) {
  const where = status === "all" ? "" : `「${STATUS_LABEL[status]}」에서 `;
  const k = keyword.trim();
  if (k)
    return (
      <>
        {where}
        <strong className="empty-keyword">‘{k}’</strong>에 대한 검색 결과가 없습니다.
      </>
    );
  return status === "all" ? "검색 결과가 없습니다." : `「${STATUS_LABEL[status]}」 계정이 없습니다.`;
}

const fmtMonthDay = (iso: string) => {
  const t = kstParts(iso);
  return `${t.m}.${t.d}`;
};

/** 발급 취소 · 해지됨 줄: 누가 · 언제 취소(해지)했는지 */
// 「EN · 만든 사람 · 날짜」와 같은 모양, 언어 자리에 「취소」(해지됨은 「해지」 — 해지를 실행한 직원 · 파기 완료 시각). 직원이 없으면(시스템 정리) 그 칸은 빼요.
const cancelNote = (a: Account) =>
  [a.status === "closed" ? "해지" : "취소", a.cancelledBy ? handle(a.cancelledBy) : "", a.cancelledAt ? fmtShort(a.cancelledAt) : ""]
    .filter(Boolean)
    .join(" · ");

/** 상태 글자(메일 실패 까닭 포함) — 목록 줄과 확인 창이 같은 말을 써요. */
const statusText = (a: Account) =>
  a.status === "pending" && a.mailFailureReason ? MAIL_FAILURE_LABEL[a.mailFailureReason] : STATUS_LABEL[a.status];

type ToastState = { title: string; detail: string; tone?: "error" } | null;

/**
 * 계정 만들기 창을 닫을 때 「작성 중」으로 남길 것(UG-431 기획 16864). id 가 있으면 이어서 만든 그 명함을 갱신해요.
 * remove = 이어서 만든 명함의 칸 · 사진을 모두 비우고 닫음 — 남길 것이 없어 지워요.
 */
type DraftKeep = { id: string | null; input: CardDraftInput; remove?: false } | { id: string; remove: true };

/** 「작성 중」 상태 글자(목록 줄 · 휴대폰 카드) */
const DRAFT_LABEL = "작성 중";
/** 「작성 중」 줄의 회사명 칸(목록 줄 · 휴대폰 카드 제목) — 회사명이 비면 이름, 둘 다 없으면 ""(「—」). PC 목록에 이름 열이 없어 알아볼 값이 이것뿐이에요(UG-431 기획 16888) */
const draftTitle = (d: CardDraft) => d.company || d.name || "";
// 창은 이미 닫혔으므로 목록 위 알림으로(기존 완료 알림과 같은 자리 · 모양, 아이콘만 오류)
const DRAFT_SAVE_FAILED = "작성 중인 명함을 저장하지 못했습니다";
const DRAFTS_LOAD_FAILED = "작성 중인 명함을 불러오지 못했습니다.";
const DRAFT_GONE = { title: "작성 중인 명함이 이미 지워졌습니다", detail: "다른 직원이 계정을 만들었거나 지웠습니다" };

const CHECK_FAILED = "이메일을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.";
const LOAD_FAILED = "목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
// 「CSV 내려받기」 실패(UG-431). 너무 많을 때는 서버(MGMT-107)의 한국어 문구와 같은 말 — 서버 문구는 브라우저 언어를 따라 영어로 올 수 있어요.
const EXPORT_TOO_MANY = "내보낼 기록이 10,000건을 넘습니다. 검색어나 상태로 범위를 좁혀 다시 시도해 주세요.";
const EXPORT_FAILED = "CSV 파일을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.";

/** 브라우저에서 만든 CSV 를 파일로 내려받아요. 임시 주소는 내려받기가 시작된 뒤 지워요(Safari 는 바로 지우면 받지 못해요). */
function downloadCsv(text: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 목록 줄 상태: 안내 메일을 보내지 못한 첫 로그인 전 계정은 까닭을 빨간 글씨로 보여 줘요(필터 · 요약은 그대로 「첫 로그인 전」). */
const MAIL_FAILURE_LABEL: Record<MailFailureReason, string> = {
  temporary: "일시적 발송 오류",
  address: "이메일 주소 오류",
  unknown: "메일 발송 실패",
};

/** 만들기 · 다시 보내기 직후 창에 보여 주는 실패 까닭(I · I2 · J · K, 휴대폰 M6–M9) */
const MAIL_FAILURE_TEXT: Record<MailFailureReason | "blocked", string> = {
  temporary: "일시적인 오류로 안내 메일을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.",
  address: "이메일 주소가 유효하지 않으니 발급 취소 후 다시 만들어 주세요.",
  unknown: "안내 메일을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.",
  // 3번 막힘도 영업에겐 같은 주소 오류 — 같은 문구 · 같은 버튼(닫기 · 발급 취소)
  blocked: "이메일 주소가 유효하지 않으니 발급 취소 후 다시 만들어 주세요.",
};

/** 계정 만들기 창에서 주소 오류가 났을 때 이메일 칸 아래 안내(I2 · C2 · 휴대폰 M8) — 같은 창에서 주소를 고쳐 재발송해요. */
const FIX_ADDRESS_TEXT = "이메일 주소가 유효하지 않으니 고친 뒤 재발송해 주세요.";
/** 만들기 전 도메인 확인에 걸려 서버가 계정을 만들지 않음(MGMT-108) — 이메일 칸 아래 안내. 서버 문구 대신 이 화면 문구를 써요. */
const DOMAIN_ERROR_TEXT = "도메인을 다시 확인해 주세요.";

/** 메일 서버가 받지 않아 보내지 못한 경우(다시 누르기보다 까닭을 보여 줄 것) */
const isMailFailure = (r: ResendFailure): r is MailFailureReason | "blocked" =>
  r === "temporary" || r === "address" || r === "unknown" || r === "blocked";

/** 다시 보내기 실패 안내 — 그사이 고객이 로그인했거나 발급이 취소됐으면 그대로 알려요. */
const resendErrorText = (reason: ResendFailure) =>
  isMailFailure(reason)
    ? MAIL_FAILURE_TEXT[reason]
    : reason === "in_use"
      ? "고객이 이미 로그인해서 다시 보낼 수 없습니다. 목록에서 「사용 중」으로 바뀝니다."
      : reason === "not_found"
        ? "발급이 취소된 계정입니다. 목록을 새로 고쳐 주세요."
        : reason === "closing"
          ? "해지 처리 중인 계정이라 다시 보낼 수 없습니다."
          : "안내 메일을 보내지 못했습니다. 다시 시도해 주세요.";

/** 주소 오류(막힌 경우 포함)면 실패 창에서 바로 발급 취소로 이어 줘요. */
const offersCancel = (reason: MailFailureReason | "blocked") => reason === "address" || reason === "blocked";

/** 첫 로그인 전이고 서버가 막지 않았으면 다시 보낼 수 있어요. */
// 이메일 주소 오류(받는 도메인이 메일을 못 받음)는 다시 보내도 또 실패해요 — 처음부터 발급 취소만(올바른 주소로 새로 만들기)
const canResend = (a: Account) => a.status === "pending" && !a.resendBlocked && a.mailFailureReason !== "address";

export default function AccountsPage() {
  const router = useRouter();
  const staff = useStaff();

  const [rows, setRows] = useState<Account[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<AccountSummary | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  // 검색 칸 값(keyword · status)과 실제로 조회한 조건(applied)을 나눠요 — 검색을 눌러야 목록이 바뀌어요.
  const [keyword, setKeyword] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  // 휴대폰 상태 칩: 오른쪽에 더 있으면 끝을 흐리게(옆으로 밀 수 있다는 표시)
  const chipsRef = useRef<HTMLDivElement>(null);
  const [chipsMore, setChipsMore] = useState(false);
  const updateChipsMore = useCallback(() => {
    const el = chipsRef.current;
    if (el) setChipsMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);
  const [status, setStatus] = useState<AccountStatus | "all">("all");
  const [applied, setApplied] = useState<{ keyword: string; status: AccountStatus | "all" }>({ keyword: "", status: "all" });
  const [version, setVersion] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  // 계정 만들기 창. draft = 「작성 중」 명함을 이어서 만들 때 서버에서 받은 것(칩 · 사진 포함)
  const [creating, setCreating] = useState<{ draft: CardDraftDetail | null } | null>(null);
  // 「작성 중」 명함 목록(UG-431 기획 16864) — 그때의 조건(applied)에만 붙여요. 요약 카드 · CSV · 페이지 수에는 섞지 않아요.
  // total = 서버의 전체 장 수(한 번에 100장까지만 받아요)
  const [draftList, setDraftList] = useState<{ for: typeof applied; items: CardDraft[]; total: number } | null>(null);
  // 불러오기 실패 안내도 그때의 조건에만 — 상태 필터를 바꾸면(「작성 중」 해당 없음) 사라져요
  const [draftsErrorFor, setDraftsErrorFor] = useState<typeof applied | null>(null);
  // 이어서 만들기로 여는 중인 명함(서버에서 칩 · 사진을 받는 동안 버튼을 잠가요)
  const [resumingId, setResumingId] = useState<string | null>(null);
  const [draftDeleteTarget, setDraftDeleteTarget] = useState<CardDraft | null>(null);
  // 닫을 때 시작한 저장(명함 번호별) — 끝나기 전에 같은 명함을 다시 열거나 지우면 저장이 끝난 뒤에 해요
  const draftSaves = useRef(new Map<string, Promise<void>>());
  const [resendTarget, setResendTarget] = useState<Account | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Account | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [freshId, setFreshId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  // 내려받기 실패 안내는 그때의 조건(applied)에만 붙여요 — 검색 조건을 바꾸면 저절로 사라져요.
  const [exportError, setExportError] = useState<{ for: typeof applied; text: string } | null>(null);

  // 로그인 확인. 화면 이동용이고, 실제 권한 검사는 서버가 해요(로그인이 끊기면 서버 호출이 로그인 화면으로 보내요).
  useEffect(() => {
    if (staff === null) router.replace("/login");
  }, [staff, router]);

  // 예전 판(기기 보관)이 남긴 명함 저장소 정리 — UG-431 기획 16841 · 16864, 지워도 되는 때는 card-photo.ts 참고
  useEffect(() => {
    purgeLegacyCardPhotos();
  }, []);

  /** 지금 조건 그대로 목록 · 요약을 다시 불러와요. */
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  // 목록은 서버가 한 페이지씩 줘요. 조건 · 페이지 · 페이지 크기가 바뀌거나 reload 하면 다시 불러와요.
  useEffect(() => {
    if (!staff) return;
    let alive = true;
    // 요약이 실패해도 목록은 보여 줘요(요약은 전 값을 그대로 둬요).
    getSummary()
      .then((sum) => alive && setSummary(sum))
      .catch(() => {});
    listAccounts({ ...applied, page, size: pageSize })
      .then((list) => {
        if (!alive) return;
        // 마지막 페이지의 마지막 줄이 빠졌으면(발급 취소 · 필터) 남은 마지막 페이지로 옮겨 다시 불러요.
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

  // 「작성 중」 명함은 따로 받아 첫 페이지 맨 위에 보여 줘요. 상태 필터를 걸면(첫 로그인 전 · 사용 중 · 발급 취소) 해당 없음.
  useEffect(() => {
    if (!staff || applied.status !== "all") return;
    let alive = true;
    const query = applied;
    listCardDrafts(query.keyword)
      .then(({ items, total }) => {
        if (!alive) return;
        setDraftList({ for: query, items, total });
        setDraftsErrorFor(null);
      })
      .catch(() => {
        if (alive) setDraftsErrorFor(query);
      });
    return () => {
      alive = false;
    };
  }, [staff, applied, version]);

  // 요약을 아직 못 받았으면(실패 포함) 숫자 대신 「—」 — 0으로 보이면 「계정이 없다」로 읽혀요.
  const metrics = summary;

  const filtered = applied.keyword !== "" || applied.status !== "all";
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, pageCount);
  const visible = rows;
  const drafts = applied.status === "all" && current === 1 && draftList?.for === applied ? draftList.items : [];
  // 「작성 중」이 100장을 넘으면 최근 100장만 받아요 — 목록 위에 한 줄
  const draftsCut = drafts.length > 0 && draftList !== null && draftList.total > draftList.items.length;
  const draftsError = draftsErrorFor === applied;
  // 다른 창이 열려 있는지 — 이어서 만들기 응답이 늦게 와도 창을 겹쳐 열지 않게(응답을 버려요)
  const modalOpen = !!creating || !!resendTarget || !!cancelTarget || !!draftDeleteTarget;
  const modalOpenRef = useRef(modalOpen);
  useEffect(() => {
    modalOpenRef.current = modalOpen;
  }, [modalOpen]);
  const from = total ? (current - 1) * pageSize + 1 : 0;
  const to = Math.min(current * pageSize, total);
  const emptyText = loadError
    ? LOAD_FAILED
    : !loaded
      ? "불러오는 중…"
      : !filtered && total === 0
        ? "아직 만든 Gate 계정이 없습니다."
        : noResultText(applied);

  /** 페이지를 바꾸면 목록 맨 위부터 보여 줘요. */
  function goPage(n: number) {
    setPage(n);
    window.scrollTo({ top: 0 });
  }

  function onSearch(e?: React.FormEvent) {
    e?.preventDefault();
    setPage(1);
    setApplied({ keyword, status });
    reload();
  }

  // 검색어 지우기(✕): 이미 그 검색어로 조회한 상태면 목록도 바로 되돌려요.
  function clearKeyword() {
    setKeyword("");
    searchRef.current?.focus();
    if (applied.keyword) {
      setPage(1);
      setApplied({ keyword: "", status: applied.status });
      reload();
    }
  }

  // 휴대폰 상태 칩: 누르면 바로 걸러요(휴대폰엔 검색 버튼이 없어서).
  function pickStatus(v: AccountStatus | "all") {
    setStatus(v);
    setPage(1);
    setApplied({ keyword: keyword.trim(), status: v });
    reload();
  }

  /** 「CSV 내려받기」(N5) — 검색 칸에 쳐 둔 글자가 아니라 지금 목록에 걸린 조건(applied) 그대로 전부 내려받아요. */
  async function onExport() {
    if (exporting) return;
    const query = applied;
    setExporting(true);
    setExportError(null);
    const res = await exportAccounts(query);
    setExporting(false);
    if (!res.ok) return setExportError({ for: query, text: res.reason === "too_many" ? EXPORT_TOO_MANY : EXPORT_FAILED });
    try {
      downloadCsv(buildAccountsCsv(res.rows, { language: languageName, status: (s) => STATUS_LABEL[s] }), exportFileName(new Date()));
    } catch {
      // 파일 만들기 · 내려받기 실패(브라우저 메모리 등)도 같은 안내
      return setExportError({ for: query, text: EXPORT_FAILED });
    }
    setToast({ title: "CSV 파일을 내려받았습니다", detail: `계정 ${res.rows.length}개` });
  }

  function onReset() {
    setKeyword("");
    setStatus("all");
    setPage(1);
    setApplied({ keyword: "", status: "all" });
    reload();
  }

  /**
   * 창을 닫을 때 「작성 중」으로 남겨요(UG-431 기획 16864) — 창은 이미 닫혔고, 저장 결과로 목록을 새로 고쳐요.
   * 같은 명함의 앞 저장이 아직이면 그 뒤에 해요(차례가 바뀌어 옛 값이 남지 않게).
   * 이어서 만든 명함이 그사이 없어졌으면(MGMT-109 — 계정을 만들었거나 다른 직원이 지움) 새로 남기지 않고 목록만 새로 고쳐요.
   */
  const keepDraft = useCallback(
    (keep: DraftKeep) => {
      const run = async () => {
        if (keep.remove) {
          // 칸 · 사진을 다 비우고 닫음 — 남길 것이 없어 지워요
          if (!(await deleteCardDraft(keep.id)))
            setToast({ tone: "error", title: "작성 중인 명함을 지우지 못했습니다", detail: "목록에서 [지우기]로 다시 지워 주세요" });
          return reload();
        }
        let res = await saveCardDraft(keep.id, keep.input);
        // 칸 값을 서버가 받지 않음(PJ-101) — 칸은 상한 · 제어 문자를 이미 정리해 보냈어요. 그래도면 네 칸 없이 사진 · 칩만 한 번 더
        let kept: string | null = null;
        if (!res.ok && res.reason === "invalid") {
          const { language, chips, photo, keepPhoto } = keep.input;
          const hasPhoto = !!photo || !!keepPhoto;
          if (hasPhoto || chips) {
            res = await saveCardDraft(keep.id, {
              ...(language ? { language } : {}),
              ...(chips ? { chips } : {}),
              ...(photo ? { photo } : keepPhoto ? { keepPhoto } : {}),
            });
            kept = hasPhoto && chips ? "명함 사진과 읽은 줄만 남겼습니다" : hasPhoto ? "명함 사진만 남겼습니다" : "읽은 줄만 남겼습니다";
          }
        }
        if (res.ok) {
          setFreshId(`draft:${res.draft.id}`);
          if (kept) setToast({ tone: "error", title: "작성 중인 명함의 입력값을 남기지 못했습니다", detail: kept });
        } else if (res.reason === "not_found") setToast({ tone: "error", ...DRAFT_GONE });
        else
          setToast({
            tone: "error",
            title: DRAFT_SAVE_FAILED,
            detail: res.reason === "photo" ? "명함 사진이 너무 크거나 형식이 맞지 않아 목록에 남지 않았습니다" : "명함과 입력한 값이 목록에 남지 않았습니다",
          });
        reload();
      };
      if (!keep.id) return void run();
      const id = keep.id;
      const saving: Promise<void> = (draftSaves.current.get(id) ?? Promise.resolve())
        .then(run)
        .catch(() => undefined)
        .finally(() => {
          if (draftSaves.current.get(id) === saving) draftSaves.current.delete(id);
        });
      draftSaves.current.set(id, saving);
    },
    [reload],
  );

  /**
   * 이어서 만들기 — 닫을 때 시작한 저장이 남았으면 끝난 뒤에 칩 · 사진까지 받아 창을 열어요.
   * 받는 동안 [계정 만들기] · 그 줄의 [지우기] · 다른 줄의 [이어서 만들기]는 잠가요. 그래도 그사이 다른 창이 열렸으면 응답은 버려요.
   */
  async function resumeDraft(d: CardDraft) {
    if (resumingId || modalOpenRef.current) return;
    setResumingId(d.id);
    await draftSaves.current.get(d.id);
    const res = await getCardDraft(d.id);
    setResumingId(null);
    if (res.ok) {
      if (!modalOpenRef.current) setCreating((c) => c ?? { draft: res.detail });
      return;
    }
    reload();
    if (modalOpenRef.current) return;
    setToast(
      res.reason === "not_found"
        ? { tone: "error", title: "작성 중인 명함이 이미 지워졌습니다", detail: "다른 직원이 계정을 만들었거나 지웠습니다" }
        : { tone: "error", title: "작성 중인 명함을 열지 못했습니다", detail: "잠시 후 다시 시도해 주세요" },
    );
  }

  /** [지우기] 확인 뒤 — 닫을 때 시작한 저장이 남았으면 끝난 뒤에 지워요(지운 뒤 저장이 되살리지 않게). */
  async function removeDraft(id: string): Promise<boolean> {
    await draftSaves.current.get(id);
    return deleteCardDraft(id);
  }

  /** 이어서 만든 창에서 이미 만든 계정에 안내 메일을 다시 보냄 — 그 명함은 다 썼어요. 창은 기다리지 않고, 지운 뒤 목록을 새로 고쳐요. */
  const discardUsedDraft = useCallback(
    (id: string) => {
      void deleteCardDraft(id).then(() => reload());
    },
    [reload],
  );

  const afterDraftDeleted = useCallback(() => {
    setDraftDeleteTarget(null);
    reload();
    setToast({ title: "작성 중인 명함을 지웠습니다", detail: "명함 사진과 입력한 값을 지웠습니다" });
  }, [reload]);

  /** 새로 만든 계정이 보이도록 조건을 풀고 첫 페이지를 다시 불러와 그 줄을 잠깐 표시해요. */
  const showCreated = useCallback(
    (account: Account) => {
      setKeyword("");
      setStatus("all");
      setPage(1);
      setApplied({ keyword: "", status: "all" });
      reload();
      setFreshId(account.id);
    },
    [reload],
  );

  const afterSend = useCallback(
    (result: { kind: "created"; account: Account } | { kind: "resent" }) => {
      setCreating(null);
      setResendTarget(null);
      if (result.kind === "created") {
        showCreated(result.account);
        setToast({ title: "계정을 만들었습니다", detail: "안내 메일 발송을 요청했습니다" });
      } else {
        reload();
        setToast({ title: "안내 메일을 다시 보냈습니다", detail: "새 임시 비밀번호로 발송을 요청했습니다" });
      }
    },
    [reload, showCreated],
  );

  useEffect(() => {
    if (!freshId) return;
    const t = setTimeout(() => setFreshId(null), 4000);
    return () => clearTimeout(t);
  }, [freshId]);

  useEffect(() => {
    updateChipsMore();
    window.addEventListener("resize", updateChipsMore);
    return () => window.removeEventListener("resize", updateChipsMore);
  }, [updateChipsMore, summary]);

  const clearToast = useCallback(() => setToast(null), []);

  const afterCancel = useCallback(() => {
    setCancelTarget(null);
    reload();
    setToast({ title: "발급을 취소했습니다", detail: "같은 이메일로 다시 발급할 수 있습니다" });
  }, [reload]);

  /** 실패 창(주소 오류 · 막힘)에서 바로 발급 취소한 뒤: 그 창을 닫고 목록의 발급 취소와 같은 완료 알림 */
  const cancelledFromFailure = useCallback(() => {
    setCreating(null);
    setResendTarget(null);
    afterCancel();
  }, [afterCancel]);

  // 취소하지 못한 경우(고객이 이미 로그인)도 목록은 새로 불러와 「사용 중」으로 보여 줘요.
  const closeCancel = useCallback(() => {
    setCancelTarget(null);
    reload();
  }, [reload]);

  if (!staff) return null;

  return (
    <>
      <AppHeader
        current="accounts"
        email={staff.email}
        onLogout={() => {
          logout();
          router.replace("/login");
        }}
      />

      <div className="breadcrumb">
        <span>BACKOFFICE</span>
        <IcArrowRight size={14} className="breadcrumb-sep" />
        <span className="breadcrumb-current">계정 발급</span>
      </div>

      <main className="content">
        <div className="page-title">
          <h1 className="t-heading-300">계정 발급</h1>
          <div className="page-actions">
            {exportError?.for === applied && (
              <span className="error" role="alert">
                {exportError.text}
              </span>
            )}
            {/* 「CSV 내려받기」(N5) — 「계정 만들기」 왼쪽. PC · 아이패드만(휴대폰은 .export-button 을 숨겨요) */}
            <button
              type="button"
              className="btn btn-outline btn-sm export-button"
              onClick={onExport}
              disabled={exporting}
              aria-busy={exporting || undefined}
            >
              {exporting ? "내려받는 중…" : "CSV 내려받기"}
            </button>
            <button
              type="button"
              className="btn btn-dark btn-sm"
              onClick={() => setCreating({ draft: null })}
              // 이어서 만들기 응답을 기다리는 동안은 새 창을 열지 않아요(두 창이 겹치지 않게)
              disabled={resumingId !== null}
            >
              계정 만들기
            </button>
          </div>
        </div>

        <section className="overview" aria-label="요약">
          <Metric label="전체" value={metrics?.total} sub={metrics ? `이번 달 ${metrics.thisMonth}개` : "이번 달 —"} />
          <Metric label="첫 로그인 전" value={metrics?.pending} sub="고객이 아직 로그인하지 않음" />
          <Metric label="사용 중" value={metrics?.inUse} sub="고객이 콘솔에 로그인함" />
          <Metric label="발급 취소" value={metrics?.cancelled} sub="계정 · 데모 프로젝트 삭제됨" />
        </section>

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
                // Esc 도 ✕ 와 같이: 글자만 지우지 않고 걸러진 목록도 되돌려요.
                if (e.key === "Escape" && keyword) {
                  e.preventDefault();
                  clearKeyword();
                }
              }}
              placeholder="회사명, 이름, 고객 이메일 검색"
            />
            {keyword && (
              <button type="button" className="search-clear" onClick={clearKeyword} aria-label="검색어 지우기">
                <IcInputClose size={18} />
              </button>
            )}
          </label>
          <PopupSelect<AccountStatus | "all">
            className="select"
            label="상태"
            value={status}
            onChange={setStatus}
            options={[
              { value: "all", label: "상태 전체" },
              { value: "pending", label: "첫 로그인 전" },
              { value: "in_use", label: "사용 중" },
              { value: "closing", label: "해지 중" },
              { value: "cancelled", label: "발급 취소" },
              { value: "closed", label: "해지됨" },
            ]}
          />
          {/* 검정은 위쪽 「계정 만들기」 하나만 — 검색은 초기화와 같은 테두리 버튼(Enter 로도 검색) */}
          <button type="submit" className="btn btn-outline btn-sm">
            검색
          </button>
          <button type="button" className="btn btn-outline btn-sm" onClick={onReset}>
            초기화
          </button>
          {/* 휴대폰: 상태 칩(개수 포함) — PC 는 위 선택 상자 */}
          <div
            ref={chipsRef}
            className={`status-chips${chipsMore ? " has-more" : ""}`}
            role="group"
            aria-label="상태"
            onScroll={updateChipsMore}
          >
            {(
              [
                ["all", "전체", metrics?.total],
                ["pending", "첫 로그인 전", metrics?.pending],
                ["in_use", "사용 중", metrics?.inUse],
                ["closing", "해지 중", metrics?.closing],
                ["cancelled", "발급 취소", metrics?.cancelled],
                ["closed", "해지됨", metrics?.closed],
              ] as const
            ).map(([v, label, n]) => (
              <button
                key={v}
                type="button"
                className={`status-chip${applied.status === v ? " is-on" : ""}`}
                aria-pressed={applied.status === v}
                onClick={() => pickStatus(v)}
              >
                {label} {n !== undefined && <span className="status-chip-count">{n}</span>}
              </button>
            ))}
          </div>
          <span className="count">총 {total}개</span>
          {loadError && rows.length > 0 && (
            <span className="error" role="alert">
              {LOAD_FAILED}
            </span>
          )}
          {draftsError && (
            <span className="error" role="alert">
              {DRAFTS_LOAD_FAILED}
            </span>
          )}
          {draftsCut && <span className="help">작성 중인 명함이 많아 최근 100개만 보입니다.</span>}
        </form>

        {/* PC: 표 */}
        <div className="table" role="table" aria-label="발급한 계정">
          <div className="tr th" role="row">
            {["회사명", "고객 이메일", "메일 언어", "상태", "생성자", "생성일시", "관리"].map((h) => (
              <span key={h} role="columnheader">
                {h}
              </span>
            ))}
          </div>
          {/* 「작성 중」 명함(UG-431 기획 16864) — 첫 페이지 맨 위. 못 채운 칸 · 메일 언어는 「—」, 명함 사진은 넣지 않아요 */}
          {drafts.map((d) => (
            <div key={`draft-${d.id}`} className={`tr${freshId === `draft:${d.id}` ? " is-new" : ""}`} role="row">
              <span role="cell">{draftTitle(d) ? <Highlight text={draftTitle(d)} query={applied.keyword} /> : <span className="dash">—</span>}</span>
              <span role="cell">{d.email ? <Highlight text={d.email} query={applied.keyword} /> : <span className="dash">—</span>}</span>
              <span role="cell">{d.language ? languageName(d.language) : <span className="dash">—</span>}</span>
              <span role="cell">
                <DraftStatus />
              </span>
              <span role="cell">{d.createdBy ? handle(d.createdBy) : <span className="dash">—</span>}</span>
              <span role="cell">{d.createdAt ? fmtFull(d.createdAt) : <span className="dash">—</span>}</span>
              <span role="cell">
                <span className="row-actions">
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() => resumeDraft(d)}
                    disabled={resumingId !== null}
                    aria-busy={resumingId === d.id || undefined}
                  >
                    {resumingId === d.id ? "여는 중…" : "이어서 만들기"}
                  </button>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => setDraftDeleteTarget(d)} disabled={resumingId === d.id}>
                    지우기
                  </button>
                </span>
              </span>
            </div>
          ))}
          {visible.length === 0 && drafts.length === 0 ? (
            <div className="empty">
              <p>{emptyText}</p>
              {loaded && !loadError && filtered && (
                <button type="button" className="empty-action" onClick={onReset}>
                  검색 초기화
                </button>
              )}
            </div>
          ) : (
            visible.map((a) => (
              <div key={a.id} className={`tr${a.id === freshId ? " is-new" : ""}`} role="row">
                <span role="cell"><Highlight text={a.company} query={applied.keyword} /></span>
                <span role="cell"><Highlight text={a.email} query={applied.keyword} /></span>
                <span role="cell">{languageName(a.language)}</span>
                <span role="cell">
                  <Status account={a} />
                </span>
                <span role="cell">{handle(a.createdBy)}</span>
                <span role="cell">{fmtFull(a.createdAt)}</span>
                <span role="cell">
                  <span className="row-actions">
                    {a.status === "pending" ? (
                      <>
                        {canResend(a) && (
                          <button type="button" className="btn btn-outline btn-sm" onClick={() => setResendTarget(a)}>
                            안내 메일 다시 보내기
                          </button>
                        )}
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => setCancelTarget(a)}>
                          발급 취소
                        </button>
                      </>
                    ) : a.status === "closing" ? (
                      // 해지가 끝나거나 철회될 때까지 발급 쪽 동작을 꺼 둬요(UG-443 기획 16908) — 꺼진 버튼은 마우스를 못 받아 툴팁은 감싼 칸에
                      <span className="row-actions is-closing" title={CLOSING_TIP}>
                        {a.statusBeforeClosing === "pending" ? (
                          <>
                            {a.resendBlocked || a.mailFailureReason === "address" ? null : (
                              <button type="button" className="btn btn-outline btn-sm" disabled aria-label={`안내 메일 다시 보내기 — ${CLOSING_TIP}`}>
                                안내 메일 다시 보내기
                              </button>
                            )}
                            <button type="button" className="btn btn-outline btn-sm" disabled aria-label={`발급 취소 — ${CLOSING_TIP}`}>
                              발급 취소
                            </button>
                          </>
                        ) : (
                          <span className="dash">—</span>
                        )}
                      </span>
                    ) : isGone(a) ? (
                      <span className="cancel-note">{cancelNote(a)}</span>
                    ) : (
                      <span className="dash">—</span>
                    )}
                  </span>
                </span>
              </div>
            ))
          )}
        </div>

        {/* 휴대폰: 줄마다 카드 */}
        <ul className="cards" aria-label="발급한 계정">
          {visible.length === 0 && drafts.length === 0 && (
            <li className="empty">
              <p>{emptyText}</p>
              {loaded && !loadError && filtered && (
                <button type="button" className="empty-action" onClick={onReset}>
                  검색 초기화
                </button>
              )}
            </li>
          )}
          {drafts.map((d) => (
            <li key={`draft-${d.id}`} className={`card-row${freshId === `draft:${d.id}` ? " is-new" : ""}`}>
              <div className="card-line">
                <strong className="card-company">
                  {draftTitle(d) ? <Highlight text={draftTitle(d)} query={applied.keyword} /> : <span className="dash">—</span>}
                </strong>
                <span className="card-status">
                  <DraftStatus />
                  {/* 드물게 쓰는 「지우기」는 발급 취소처럼 더보기 안에 — 자주 쓰는 이어서 만들기만 카드에 보여요 */}
                  <CardMore label="지우기" onSelect={() => setDraftDeleteTarget(d)} disabled={resumingId === d.id} />
                </span>
              </div>
              <div className="card-line">
                <span className="card-email">
                  {d.email ? <Highlight text={d.email} query={applied.keyword} /> : <span className="dash">—</span>}
                </span>
                <button
                  type="button"
                  className="link-action"
                  onClick={() => resumeDraft(d)}
                  disabled={resumingId !== null}
                  aria-busy={resumingId === d.id || undefined}
                >
                  {resumingId === d.id ? "여는 중…" : "이어서 만들기"}
                </button>
              </div>
              <div className="card-line">
                <span className="card-meta">
                  {[d.language ? languageShort(d.language) : "—", d.createdBy ? handle(d.createdBy) : "—", d.createdAt ? fmtShort(d.createdAt) : "—"].join(" · ")}
                </span>
              </div>
            </li>
          ))}
          {visible.map((a) => (
            <li key={a.id} className={`card-row${a.id === freshId ? " is-new" : ""}${isGone(a) ? " is-cancelled" : ""}`}>
              <div className="card-line">
                <strong className="card-company"><Highlight text={a.company} query={applied.keyword} /></strong>
                <span className="card-status">
                  <Status account={a} />
                  {/* 드물게 쓰는 「발급 취소」는 더보기 안에 — 자주 쓰는 재발송만 카드에 보여요 */}
                  {a.status === "pending" && <CardMore label="발급 취소" onSelect={() => setCancelTarget(a)} />}
                </span>
              </div>
              <div className="card-line">
                <span className="card-email"><Highlight text={a.email} query={applied.keyword} /></span>
                {canResend(a) && (
                  <button type="button" className="link-action" onClick={() => setResendTarget(a)}>
                    <IcReload size={14} />
                    재발송
                  </button>
                )}
              </div>
              <div className="card-line">
                <span className="card-meta">
                  {/* 발급 취소 카드: 메일 언어 · 만든 정보 대신 누가 · 언제 취소했는지만 */}
                  {isGone(a)
                    ? cancelNote(a)
                    : `${languageShort(a.language)} · ${handle(a.createdBy)} · ${fmtShort(a.createdAt)}`}
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

      {creating && (
        <CreateDialog
          // 이어서 만든 명함 · 새 창마다 새로 그려요(앞 창의 상태가 남지 않게)
          key={creating.draft?.draft.id ?? "new"}
          draft={creating.draft}
          onDraftUsed={discardUsedDraft}
          onClose={(keep) => {
            setCreating(null);
            reload();
            if (keep) keepDraft(keep);
          }}
          onCreated={(account) => afterSend({ kind: "created", account })}
          onMailFailed={showCreated}
          onResent={() => afterSend({ kind: "resent" })}
          onResendMailFailed={reload}
          onCancelled={cancelledFromFailure}
        />
      )}

      {resendTarget && (
        <ResendDialog
          account={resendTarget}
          onClose={() => {
            setResendTarget(null);
            reload();
          }}
          onResent={() => afterSend({ kind: "resent" })}
          onMailFailed={reload}
          onCancelled={cancelledFromFailure}
        />
      )}

      {cancelTarget && <CancelDialog account={cancelTarget} onClose={closeCancel} onCancelled={afterCancel} />}

      {draftDeleteTarget && (
        <DraftDeleteDialog
          draft={draftDeleteTarget}
          onDelete={() => removeDraft(draftDeleteTarget.id)}
          onClose={() => setDraftDeleteTarget(null)}
          onDeleted={afterDraftDeleted}
        />
      )}

      {toast && <Toast title={toast.title} detail={toast.detail} tone={toast.tone} onDone={clearToast} />}
    </>
  );
}

/** 찍은 명함 작은 사진 — 누르면 크게 봐요 */
function CardPhotoThumb({ src, onOpen }: { src: string; onOpen: () => void }) {
  return (
    <button type="button" className="card-thumb" onClick={onOpen} aria-label={CARD_PHOTO_TEXT.thumbLabel} title={CARD_PHOTO_TEXT.thumbLabel}>
      {/* eslint-disable-next-line @next/next/no-img-element -- data URL(줄인 명함 사진)이라 next/image 를 쓸 수 없어요 */}
      <img src={src} alt="" />
    </button>
  );
}

/**
 * 명함 크게 보기 — 화면에 맞춰 보여 주고 「닫기」 · Esc · 바깥 누르기로 닫아요.
 * 발급 창 안에서 열려도 Esc 는 이 화면만 닫아요(창까지 닫히지 않게 먼저 받아요).
 */
function CardPhotoViewer({ src, onClose }: { src: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      // 초점은 이 화면 안에만(뒤 창 · 목록으로 빠지지 않게) — 초점 가능한 것이 「닫기」뿐이라 거기 고정
      if (e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current?.focus();
        return;
      }
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  return (
    <div
      className="photo-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={CARD_PHOTO_TEXT.viewerTitle}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- data URL(줄인 명함 사진) */}
      <img src={src} alt={CARD_PHOTO_TEXT.viewerTitle} />
      <button ref={closeRef} type="button" className="btn btn-outline" onClick={onClose}>
        {CARD_PHOTO_TEXT.close}
      </button>
    </div>
  );
}

/**
 * 명함에서 읽은 이메일 칸 아래 안내 — 위아래로 쌓아 겹치지 않게.
 * 로컬 부분(@ 앞)에 헷갈리는 글자(0 · O, 1 · l · I)가 있으면 이메일을 다시 보여 주며 그 글자만 강조하고,
 * 도메인이 있으면 「도메인 — 명함과 같은지 확인해 주세요.」(도메인만 굵게, 기획 16846 — company-a.com 을 company-a.qi 로 읽는 일).
 */
function ScannedEmailNotes({ email }: { email: string }) {
  const confusable = emailHasConfusable(email);
  const domain = emailDomain(email);
  if (!confusable && !domain) return null;
  return (
    <div className="confusable">
      {confusable && (
        <>
          <p className="confusable-email" translate="no">
            {confusableParts(email).map((p, i) =>
              p.confusable ? (
                <mark key={i} className="confusable-char">
                  {p.text}
                </mark>
              ) : (
                <span key={i}>{p.text}</span>
              ),
            )}
          </p>
          <p className="help">{CARD_PHOTO_TEXT.confusable}</p>
        </>
      )}
      {domain && (
        <p className="help">
          <strong className="domain-check" translate="no">
            {domain}
          </strong>{" "}
          — {CARD_PHOTO_TEXT.domainCheck}
        </p>
      )}
    </div>
  );
}

/** 휴대폰 카드 더보기(⋮) — 「발급 취소」 · 「작성 중」 카드의 「지우기」. 프로필 메뉴와 같은 어두운 유리. */
function CardMore({ label, onSelect, disabled = false }: { label: string; onSelect: () => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="card-more" ref={ref}>
      <button ref={buttonRef} type="button" className="card-more-button" aria-label="더보기" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} disabled={disabled}>
        <IcMoreVert size={18} />
      </button>
      {open && (
        <div className="profile-menu card-more-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            className="profile-menu-item"
            onClick={() => {
              setOpen(false);
              buttonRef.current?.focus(); // 확인 창을 닫으면 ⋮ 로 초점이 돌아오게
              onSelect();
            }}
          >
            {label}
          </button>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: number | undefined; sub: string }) {
  return (
    <div className="metric">
      <span className="metric-label">{label}</span>
      <div>
        <strong className="metric-value">{value ?? "—"}</strong>
        <span className="metric-sub">{sub}</span>
      </div>
    </div>
  );
}

function Status({ account }: { account: Account }) {
  const failure = account.status === "pending" ? account.mailFailureReason : undefined;
  return (
    <span className={`status status--${failure ? "mail-failed" : account.status}`}>
      <span className="status-dot" aria-hidden="true" />
      {failure ? MAIL_FAILURE_LABEL[failure] : STATUS_LABEL[account.status]}
    </span>
  );
}

/** 「작성 중」 명함(UG-431 기획 16864) — 회색 점 */
function DraftStatus() {
  return (
    <span className="status status--draft">
      <span className="status-dot" aria-hidden="true" />
      {DRAFT_LABEL}
    </span>
  );
}

/** 실패 안내. 문장 사이에서만 줄이 바뀌어요(PC 는 한 줄, 휴대폰은 문장마다). 주소 오류 · 막힘은 「무엇이 문제 / 무엇을 할지」 두 문장이라 PC 도 문장마다. */
function MailFailureMessage({ reason }: { reason: MailFailureReason | "blocked" }) {
  return <Sentences text={MAIL_FAILURE_TEXT[reason]} lines={offersCancel(reason)} />;
}

/** 빨간 안내를 문장 사이에서만 줄바꿈해요. lines 면 PC 도 문장마다, 아니면 휴대폰에서만. */
function Sentences({ text, lines = false, id }: { text: string; lines?: boolean; id?: string }) {
  const sentences = text.split(". ");
  return (
    <p id={id} className={`error mail-failure${lines ? " mail-failure--lines" : ""}`} role="alert">
      {sentences.map((s, i) => (
        <span key={i} className="mail-failure-sentence">
          {i > 0 && " "}
          {i < sentences.length - 1 ? `${s}.` : s}
        </span>
      ))}
    </p>
  );
}

/**
 * 안내 메일을 보내지 못했을 때 창 안에 보여 주는 결과(I · I2 · J · K).
 * 일시 오류 · 그 밖의 실패는 「닫기」만 — 다시 보내기는 목록에서 해요. 주소 오류 · 막힘은 「발급 취소」를 바로 할 수 있어요(확인 창 없이).
 */
function MailFailureResult({
  account,
  reason,
  onClose,
  onCancelled,
}: {
  account: Account;
  reason: MailFailureReason | "blocked";
  onClose: () => void;
  onCancelled: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const { cancelling, cancelError, cancelNow } = useCancelNow(onCancelled);
  // 입력 칸 · 보내기 버튼이 사라지므로 초점을 「닫기」로 옮겨요.
  useEffect(() => {
    closeRef.current?.focus();
  }, []);
  return (
    <>
      <div className="summary">
        <div className="summary-target">
          {account.company && <strong>{account.company}</strong>}
          <span>{account.email}</span>
        </div>
      </div>
      {cancelError ? (
        <p className="error" role="alert">
          {cancelErrorText(cancelError)}
        </p>
      ) : (
        <MailFailureMessage reason={reason} />
      )}
      <div className="dialog-actions">
        <button ref={closeRef} type="button" className="btn btn-outline" onClick={onClose} disabled={cancelling}>
          닫기
        </button>
        {offersCancel(reason) && cancelError !== "in_use" && cancelError !== "not_found" && cancelError !== "closing" && (
          <button type="button" className="btn btn-danger-outline" onClick={() => cancelNow(account)} disabled={cancelling} aria-busy={cancelling || undefined}>
            {cancelling ? "취소하는 중…" : "발급 취소"}
          </button>
        )}
      </div>
    </>
  );
}

const cancelErrorText = (reason: CancelFailure) =>
  reason === "closing"
    ? "해지 처리 중인 계정이라 발급을 취소할 수 없습니다."
    : reason === "in_use"
    ? "고객이 이미 로그인해서 취소할 수 없습니다. 목록에서 「사용 중」으로 바뀝니다."
    : reason === "not_found"
      ? "이미 발급 취소된 계정입니다. 목록에서 「발급 취소」로 바뀝니다."
      : "발급을 취소하지 못했습니다. 다시 시도해 주세요.";

/**
 * 실패 창(주소 오류 · 막힘)의 「발급 취소」 — 확인 창 없이 바로 취소해요.
 * 메일이 아무에게도 가지 않은 계정이라 받은 사람 · 데모 기록이 없어요. 목록의 발급 취소는 그대로 확인 창(H)을 거쳐요.
 */
function useCancelNow(onCancelled: () => void) {
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<"" | CancelFailure>("");
  async function cancelNow(account: Account) {
    setCancelling(true);
    setCancelError("");
    const res = await cancelIssue(account.id);
    setCancelling(false);
    if (res.ok) return onCancelled();
    setCancelError(res.reason);
  }
  /** 대상이 바뀌면(이메일을 고치면) 앞 기록의 취소 실패 안내를 지워요 — 다른 기록에 넘어가지 않게 */
  const resetCancelError = () => setCancelError("");
  return { cancelling, cancelError, cancelNow, resetCancelError };
}

/**
 * 「계정 만들기」 창(B · C · D). 보내기 전 확인은 이 창 하나로 해요.
 * 첫 로그인 전 이메일이면 이 창에서 다시 보내요 — 실패하면 목록의 다시 보내기 창(F)과 같은 결과(J · K)를 보여 줘요.
 * 이 창에서 만들거나 다시 보낸 결과가 주소 오류(I2 · M8)면 결과 화면으로 넘기지 않고 이 창에 남아요: 이메일이 그대로면
 * [닫기] [발급 취소], 고치면 [닫기] [재발송](I3 · M8b) — 고친 주소로 새 계정을 만들어 보내고, 만들어지면 잘못된 주소의 계정은 발급 취소해요.
 * 조회로 만난 주소 오류 기록(C2)은 [닫기] [발급 취소]만이고, 이메일을 고치면 보통 새로 만들기예요(C3, 옛 기록은 그대로 — 16687).
 * UG-431: 고객 이름(필수) · 연락처(선택) 칸과 「명함 찍어서 채우기」(N1~N4 · 칩 N3b). 명함 사진은 기기 안에서만 읽어요(card-ocr.ts).
 * 명함을 찍었거나 칸을 채운 뒤 만들지 않고 닫으면(취소 · Esc · 바깥) 「작성 중」으로 서버에 남겨요(기획 16864 — onClose 의 keep).
 * 주소를 고치는 중(fix) · 결과 화면은 계정이 이미 있어 남기지 않아요. draft = 이어서 만들기로 연 명함(칸 · 칩 · 사진 · 메일 언어를 채워 열어요).
 */
function CreateDialog({
  draft,
  onDraftUsed,
  onClose,
  onCreated,
  onMailFailed,
  onResent,
  onResendMailFailed,
  onCancelled,
}: {
  draft: CardDraftDetail | null;
  /** 이어서 만든 명함을 다 씀(이미 만든 계정에 안내 메일을 다시 보냄) — 목록이 뒤에서 지워요 */
  onDraftUsed: (id: string) => void;
  /** keep = 「작성 중」으로 남길 것(없으면 남기지 않음) — 저장은 창을 닫은 뒤 목록이 해요 */
  onClose: (keep: DraftKeep | null) => void;
  onCreated: (a: Account) => void;
  /** 계정은 만들었지만 메일은 못 보냄 — 창은 닫지 않고 결과를 보여 줘요(목록만 새로 고침) */
  onMailFailed: (a: Account) => void;
  onResent: () => void;
  /** 첫 로그인 전 계정에 다시 보냈지만 메일은 못 보냄(막힌 경우 포함) — 창은 닫지 않고 목록만 새로 고쳐요 */
  onResendMailFailed: () => void;
  /** 실패 · 막힘에서 바로 발급 취소함 */
  onCancelled: () => void;
}) {
  const [company, setCompany] = useState(draft?.draft.company ?? "");
  const [name, setName] = useState(draft?.draft.name ?? "");
  const [email, setEmail] = useState(draft?.draft.email ?? "");
  const [phone, setPhone] = useState(draft?.draft.phone ?? "");
  const [language, setLanguage] = useState<MailLanguage>(draft?.draft.language ?? "en");
  // 메일 언어를 고른 적이 있는지 — 고르지 않았으면(처음 골라 둔 English 그대로) 「작성 중」 목록에 「—」로 남겨요
  const [languageChosen, setLanguageChosen] = useState(!!draft?.draft.language);
  // 이어서 만드는 명함이 아직 서버에 있는지 — 계정을 만들면(서버가 지움) · 다시 보내기로 명함을 다 쓰면 false
  const draftAlive = useRef(!!draft);
  // 이어서 만든 명함의 사진(data URL) — 닫을 때 그대로면 다시 보내지 않고 keepPhoto 로 남겨요
  const [draftPhoto] = useState(() => photoFromDraft(draft?.photo ?? null));
  const [companyError, setCompanyError] = useState("");
  const [nameError, setNameError] = useState("");
  const [emailError, setEmailError] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [formError, setFormError] = useState("");
  const { cancelling, cancelError, cancelNow, resetCancelError } = useCancelNow(onCancelled);
  const [check, setCheck] = useState<{ email: string; result: EmailCheck } | null>(null);
  const [sending, setSending] = useState(false);
  // 이메일 미리 조회 중. 버튼은 잠그지 않아요 — 칸을 벗어나며 시작된 조회 때문에 첫 클릭이 사라졌어요.
  // 대신 보내기는 진행 중인 조회를 기다려 같은 결과를 써요(조회를 두 번 하지 않고, busy 로 두 번 만들지도 않아요).
  const [checking, setChecking] = useState(false);
  const inflight = useRef<{ key: string; result: Promise<EmailCheck | null> } | null>(null);
  const busy = useRef(false);
  // 첫 로그인 전 이메일이라 메일 언어를 자동으로 바꿨으면, 그 전 언어(다른 이메일로 고치면 되돌려요)
  const langBeforePending = useRef<MailLanguage | null>(null);
  const [mailFailure, setMailFailure] = useState<{ account: Account; reason: MailFailureReason | "blocked" } | null>(null);
  // 주소 오류로 메일이 가지 않은 계정 — 이 창에서 주소를 고쳐 재발송해요(회사명 · 메일 언어는 이 계정 그대로).
  const [fix, setFix] = useState<Account | null>(null);
  // 명함 읽기가 끝났을 때 고치는 모드인지 보려고(읽는 동안 바뀔 수 있어요)
  const fixRef = useRef<Account | null>(null);
  useEffect(() => {
    fixRef.current = fix;
  }, [fix]);
  // 사용 중 이메일일 때 「고객이 비밀번호를 잊었나요?」로 펼치는 안내(D′ · MD′). 대신 보내기는 UG-421.
  const [resetOpen, setResetOpen] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const companyRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  // 명함 읽기(UG-431). 찍은 원본(Blob)은 상태에 두지 않아요 — 읽는 함수 안에서만 쓰고 버리고, 비교용으로 줄인 사진(photo)만 둬요.
  const fileRef = useRef<HTMLInputElement>(null);
  // 읽기 도구 — 창이 열려 있는 동안 일꾼을 다시 쓰고, 창을 닫으면 닫아요
  const [reader] = useState(createCardReader);
  useEffect(() => {
    reader.open();
    return () => reader.dispose();
  }, [reader]);
  const [scanning, setScanning] = useState(false);
  const [scan, setScan] = useState<{ chips: Chip[]; links: ScanLinks } | null>(() => (draft ? scanFromDraft(draft.chips) : null));
  const [scanFailed, setScanFailed] = useState(false);
  // 명함에서 메일 주소를 찾지 못함(N4) — 이메일 칸 아래 회색 안내. 주소가 들어오면 지워요.
  const [emailMissing, setEmailMissing] = useState(false);
  // 비교용 명함 사진(줄인 JPEG data URL). 기기에는 저장하지 않아요(기획 16841). 계정을 만들면 바로 지우고,
  // 주소 오류로 고치는 동안(fix)에는 남겨 두며, 만들지 않고 닫으면 「작성 중」 명함과 함께 서버에 남겨요(기획 16864 — 계정을 만들거나 30일이면 서버가 지워요).
  const [photo, setPhoto] = useState<string | null>(draftPhoto);
  const [viewingPhoto, setViewingPhoto] = useState(false);
  // 커서가 있는 칸(칩 규칙 3). 칩을 누르면 칸에서 초점이 빠질 수 있어서(아이패드) 방금 빠진 칸도 커서로 봐요.
  const cursor = useRef<{ field: ScanField; blurredAt: number | null } | null>(null);

  /**
   * 닫을 때 「작성 중」으로 남길 것. 명함을 찍었거나 네 칸 중 하나라도 채웠을 때만(서버도 빈 명함은 받지 않아요 — PJ-101).
   * 주소를 고치는 중(fix) · 결과 화면 · 보내는 중은 계정이 만들어졌거나 만드는 중이라 남기지 않아요.
   */
  function draftToKeep(): DraftKeep | null {
    if (fix || mailFailure || sending) return null;
    const id = draft && draftAlive.current ? draft.draft.id : null;
    // 서버 상한으로 자르고 제어 문자는 공백으로(긴 칩 · 붙여 넣은 글로 저장이 통째로 실패하지 않게). 이메일은 넘으면 비워요.
    const values = {
      company: draftField(company, CARD_DRAFT_MAX.company),
      name: draftField(name, CARD_DRAFT_MAX.name),
      email: draftField(email, CARD_DRAFT_MAX.email, true),
      phone: draftField(phone, CARD_DRAFT_MAX.phone),
    };
    // 사진: 새로 찍어 다 읽은 사진만 보내요. 읽는 중(scanning) · 다시 읽기가 사진을 만들지 못한 경우는
    // 이어서 만든 창이면 원래 사진 그대로(keepPhoto), 새 창이면 사진 없이 — 원래 사진을 지우는 건 직원이 지울 때뿐(지금은 그런 버튼이 없어요)
    const newPhoto = !scanning && photo && photo !== draftPhoto ? photoForDraft(photo) : null;
    const keepPhoto = !!draftPhoto && !newPhoto;
    if (!Object.values(values).some(Boolean) && !keepPhoto && !newPhoto) return id ? { id, remove: true } : null;
    const chips = chipsForDraft(scan);
    // 첫 로그인 전 이메일이라 메일 언어를 잠깐 바꿨으면 직원이 고른 언어로
    const lang = languageChosen ? (langBeforePending.current ?? language) : null;
    const input: CardDraftInput = {
      ...Object.fromEntries(Object.entries(values).filter(([, v]) => v)),
      ...(lang ? { language: lang } : {}),
      ...(chips ? { chips } : {}),
      ...(keepPhoto ? { keepPhoto: true } : newPhoto ? { photo: newPhoto } : {}),
    };
    return { id, input };
  }
  const close = () => onClose(draftToKeep());

  /** 이어서 만든 명함을 다 썼어요(이미 만든 계정에 안내 메일을 다시 보냄) — 목록의 「작성 중」 줄 · 사진은 목록이 뒤에서 지워요. */
  function consumeDraft() {
    if (!draft || !draftAlive.current) return;
    draftAlive.current = false;
    onDraftUsed(draft.draft.id);
  }
  /** 계정 만들기 요청에 붙일 이어서 만든 명함 번호 — 계정이 만들어지면 서버가 그 명함을 지워요 */
  const draftIdInput = () => {
    const n = draft && draftAlive.current ? Number(draft.draft.id) : NaN;
    return Number.isSafeInteger(n) ? { draftId: n } : {};
  };

  const trimmed = email.trim();
  const key = trimmed.toLowerCase();
  const current = check && check.email === key ? check.result : null;
  const pending = current?.status === "pending" ? current : null;
  const inUse = current?.status === "in_use";
  // 해지 중인 계정(UG-443 기획 16908) — 사용 중처럼 막되 까닭을 다르게
  const closing = current?.status === "closing";
  // 마지막 발송이 주소 오류였거나(3번 막힘 포함) 다시 보내기를 막은 계정 — 다시 보내기 대신 발급 취소를 안내해요(목록과 같은 규칙).
  // 이 창에서 만들거나 보내다 실패한 게 아니라 조회로 알게 된 경우라, 고쳐 재발송(fix)으로 넘기지 않아요 — 다른 이메일을 치면 새로 만들기예요.
  const blocked = !!pending && (pending.resendBlocked === true || pending.mailFailureReason === "address");
  // 고치는 중인 계정의 주소 그대로인지 — 그대로면 다시 보내도 또 실패하니 발급 취소만
  const fixSame = !!fix && key === fix.email.toLowerCase();
  // 고친 주소가 다른 첫 로그인 전 계정의 것 — 그 계정과 섞이지 않게 막아요
  const fixTaken = !!fix && !fixSame && !!pending;

  useEffect(() => {
    if (!pending && langBeforePending.current) {
      setLanguage(langBeforePending.current);
      langBeforePending.current = null;
    }
  }, [pending]);

  /** 첫 로그인 전 이메일: 메일 언어를 처음 보낸 언어로 미리 골라 둬요(전 언어는 기억). */
  function pickPendingLanguage(l: MailLanguage) {
    if (langBeforePending.current === null) langBeforePending.current = language;
    setLanguage(l);
  }

  /**
   * 실패 결과 · 발급 취소 창에 넘길 대상(첫 로그인 전 발급 기록). 회사명은 기록의 것 —
   * 입력 칸 값을 쓰면 다른 이름이 그 계정 이름처럼 보여요. 서버가 아직 회사명을 주지 않으면 이메일만 보여요.
   */
  const pendingTarget = (p: Extract<EmailCheck, { status: "pending" }>): Account => ({
    id: p.id,
    company: p.company ?? "",
    email: trimmed,
    language: p.language,
    status: "pending",
    createdBy: p.createdBy,
    createdAt: p.createdAt,
    resendBlocked: p.resendBlocked,
    ...(p.mailFailureReason ? { mailFailureReason: p.mailFailureReason } : {}),
  });

  function runCheck(): Promise<EmailCheck | null> {
    if (!EMAIL_RE.test(trimmed)) return Promise.resolve(null);
    if (current) return Promise.resolve(current);
    if (inflight.current?.key === key) return inflight.current.result;
    const result = lookup();
    inflight.current = { key, result };
    void result.finally(() => {
      if (inflight.current?.result === result) inflight.current = null;
    });
    return result;
  }

  async function lookup(): Promise<EmailCheck | null> {
    const asked = key;
    let result: EmailCheck;
    setChecking(true);
    try {
      result = await checkEmail(trimmed);
    } catch {
      if (emailRef.current?.value.trim().toLowerCase() === asked) setEmailError(CHECK_FAILED);
      return null;
    } finally {
      setChecking(false);
    }
    // 조회하는 사이 이메일을 고쳤으면 버려요.
    if (emailRef.current?.value.trim().toLowerCase() !== asked) return null;
    setCheck({ email: asked, result });
    if (result.status === "pending") {
      pickPendingLanguage(result.language);
    }
    return result;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // 명함을 읽는 동안에는 보내지 않아요 — 읽은 값이 보낸 뒤에 칸을 바꾸지 않게
    if (busy.current || scanning) return;
    busy.current = true;
    try {
      await submit();
    } finally {
      busy.current = false;
    }
  }

  /** 고친 주소로 재발송(I3 · C3 · M8b): 새 계정을 만들어 보내고, 만들어지면 잘못된 주소의 계정은 발급 취소해요. */
  async function submitFix(wrong: Account) {
    if (fixSame) return; // 주소 그대로 — 버튼은 「발급 취소」라 Enter 로도 보내지 않아요
    let eError = "";
    if (!trimmed) eError = "고객 이메일을 입력해 주세요.";
    else if (!EMAIL_RE.test(trimmed)) eError = "이메일 형식을 확인해 주세요.";
    const fixCompany = wrong.company || company.trim();
    let cError = "";
    if (!fixCompany) cError = "회사명을 입력해 주세요.";
    else if (!wrong.company && fixCompany.length > COMPANY_MAX) cError = `회사명은 ${COMPANY_MAX}자까지 쓸 수 있습니다.`;
    // 고치는 계정에 이름이 있으면(이 창에서 만든 계정) 이름 · 연락처는 그 계정 것 그대로(칸이 잠겨요).
    // 없으면(조회로 만난 기록 C2 — 조회가 이름을 주지 않음 · 이름 없는 옛 기록) 칸을 열고 새로 만들 때처럼 이름은 필수.
    const fixName = wrong.name ? wrong.name : name.trim();
    const fixPhone = wrong.name ? (wrong.phone ?? "") : phone.trim();
    const nError = wrong.name ? "" : nameErrorOf(fixName, true);
    const pError = wrong.name ? "" : phoneErrorOf(fixPhone);
    setEmailError(eError);
    setCompanyError(cError);
    setNameError(nError);
    setPhoneError(pError);
    setFormError("");
    if (cError) return companyRef.current?.focus();
    if (nError) return nameRef.current?.focus();
    if (eError) return emailRef.current?.focus();
    if (pError) return phoneRef.current?.focus();
    const state = current ?? (await runCheck());
    if (!state || state.status !== "new") return emailRef.current?.focus(); // 사용 중 · 다른 발급 기록 · 조회 실패 — 칸 아래 안내

    setSending(true);
    const res = await createAccount({ company: fixCompany, email: trimmed, language: wrong.language, ...personInput(fixName, fixPhone) });
    if (!res.ok) {
      setSending(false);
      if (res.reason === "duplicate" || res.reason === "in_use") {
        // 그사이 상태가 바뀌었어요 — 서버에 다시 물어 칸 아래에 보여 줘요.
        // (runCheck 는 이 렌더의 조회 결과 「new」를 그대로 돌려줘서 다시 묻지 않아요.)
        try {
          const result = await checkEmail(trimmed);
          setCheck({ email: key, result });
          if (result.status === "pending") pickPendingLanguage(result.language);
        } catch {
          setEmailError(CHECK_FAILED);
        }
        return emailRef.current?.focus();
      }
      if (res.reason === "domain") {
        // 도메인 확인에 걸려 새 계정을 만들지 않았어요 — 잘못된 주소의 계정도 그대로 두고 이 창에서 다시 고쳐요
        setEmailError(DOMAIN_ERROR_TEXT);
        return emailRef.current?.focus();
      }
      return setFormError("계정을 만들지 못했습니다. 다시 시도해 주세요.");
    }
    // 잘못된 주소의 계정은 메일이 아무에게도 가지 않았어요 — 확인 없이 정리해요. 실패해도 목록에 「이메일 주소 오류」로 남아 직접 취소할 수 있어요.
    await cancelIssue(wrong.id).catch(() => undefined);
    setSending(false);
    if (res.mailSent) {
      setPhoto(null); // 고쳐 재발송이 끝났어요 — 명함 사진은 바로 지워요(16841)
      return onCreated(res.account);
    }
    if (res.mailFailureReason === "address") {
      // 고친 주소도 받지 않음 — 새 계정을 고치는 대상으로 바꿔 같은 창에 남아요(사진도 남겨 다시 비교)
      setFix(res.account);
      return onMailFailed(res.account);
    }
    setFix(null);
    setPhoto(null); // 계정은 만들어졌고 더 고칠 주소가 없어요(결과 화면) — 사진은 지워요
    setMailFailure({ account: res.account, reason: res.mailFailureReason });
    return onMailFailed(res.account);
  }

  async function submit() {
    if (fix) return submitFix(fix);
    let eError = "";
    if (!trimmed) eError = "고객 이메일을 입력해 주세요.";
    else if (!EMAIL_RE.test(trimmed)) eError = "이메일 형식을 확인해 주세요.";

    // 아직 조회 전이면 먼저 조회해요. 상태가 새로 드러나면 보내지 않고 칸 아래에 먼저 보여 줘요.
    // (회사명보다 먼저 — 이미 만든 이메일이면 회사명은 쓰지 않으니 「회사명을 입력해 주세요」로 막지 않아요.)
    let state = current;
    if (!eError && !state) {
      state = await runCheck();
      if (state && state.status !== "new") {
        setCompanyError("");
        setFormError("");
        return emailRef.current?.focus();
      }
    }

    let cError = "";
    let nError = "";
    let pError = "";
    // 이미 만든 계정(첫 로그인 전)이면 회사명 · 이름 · 연락처는 쓰지 않아요(다시 보내기) — 막지 않아요.
    if (state?.status !== "pending") {
      if (!company.trim()) cError = "회사명을 입력해 주세요.";
      else if (company.trim().length > COMPANY_MAX) cError = `회사명은 ${COMPANY_MAX}자까지 쓸 수 있습니다.`;
      nError = nameErrorOf(name.trim(), true);
      pError = phoneErrorOf(phone.trim());
    }
    setCompanyError(cError);
    setNameError(nError);
    setEmailError(eError);
    setPhoneError(pError);
    setFormError("");
    // 초점은 화면 순서대로: 회사명 → 이름 → 고객 이메일 → 연락처
    if (cError) return companyRef.current?.focus();
    if (nError) return nameRef.current?.focus();
    if (eError) return emailRef.current?.focus();
    if (pError) return phoneRef.current?.focus();
    if (!state) return emailRef.current?.focus(); // 조회 실패 — 칸 아래 안내

    if (state.status === "in_use" || state.status === "closing") return;
    // 막힌 계정 · 주소 오류 기록은 다시 보내지 않아요 — 창에 「닫기」 · 「발급 취소」만 있어요(Enter 로 제출해도 그대로).
    // 화면의 blocked 와 같은 규칙: 조회로 알게 된 주소 오류 기록에 다시 보내 고치는 모드로 들어가지 않게(16687)
    if (state.status === "pending" && (state.resendBlocked || state.mailFailureReason === "address")) return;

    setSending(true);
    const input = { company: company.trim(), email: trimmed, language, ...personInput(name.trim(), phone.trim()) };
    if (state.status === "pending") {
      const res = await resendGuide(state.id, language);
      // 이미 만든 계정에 메일을 보냈어요(실패 포함) — 이어서 만든 명함은 다 썼어요(주소를 고치는 중 · 결과 화면은 남기지 않아요)
      setSending(false);
      if (res.ok || isMailFailure(res.reason)) consumeDraft();
      if (res.ok) return onResent();
      if (isMailFailure(res.reason)) {
        // 주소 오류 · 막힘은 이 창에서 주소를 고쳐 재발송(C2), 그 밖의 실패는 목록의 다시 보내기 창과 같은 결과를 보여 줘요.
        if (offersCancel(res.reason)) setFix(pendingTarget(state));
        else {
          setPhoto(null);
          setMailFailure({ account: pendingTarget(state), reason: res.reason });
        }
        return onResendMailFailed();
      }
      setFormError(resendErrorText(res.reason));
      if (res.reason === "in_use" || res.reason === "not_found") setCheck(null); // 상태가 바뀌었어요 — 칸을 벗어나면 다시 조회해요
      return;
    }
    const res = await createAccount({ ...input, ...draftIdInput() });
    setSending(false);
    if (res.ok) {
      draftAlive.current = false; // 계정이 만들어졌어요(메일 실패 포함) — 서버가 이어서 만든 명함을 지웠어요
      if (res.mailSent) {
        setPhoto(null); // 계정을 만들었어요 — 명함 사진은 바로 지워요(16841)
        return onCreated(res.account);
      }
      // 주소 오류는 같은 창에서 이메일 칸에 안내하고 고쳐 재발송하게 해요(I2) — 고치는 동안 명함 사진은 남겨 비교해요
      if (res.mailFailureReason === "address") setFix(res.account);
      else {
        setPhoto(null); // 고칠 주소가 없는 실패(결과 화면) — 사진은 지워요
        setMailFailure({ account: res.account, reason: res.mailFailureReason });
      }
      return onMailFailed(res.account);
    }
    if (res.reason === "duplicate" || res.reason === "in_use") {
      // 조회와 보내기 사이에 상태가 바뀐 경우: 다시 조회해서 칸 아래에 보여 줘요.
      try {
        const result = await checkEmail(trimmed);
        setCheck({ email: key, result });
        if (result.status === "pending") pickPendingLanguage(result.language);
      } catch {
        setEmailError(CHECK_FAILED);
      }
      emailRef.current?.focus();
    } else if (res.reason === "domain") {
      // 도메인 확인에 걸려 계정을 만들지 않았어요 — 창은 닫지 않고 이메일 칸 아래에 안내해요
      setEmailError(DOMAIN_ERROR_TEXT);
      emailRef.current?.focus();
    } else setFormError("계정을 만들지 못했습니다. 다시 시도해 주세요.");
  }

  // 고치는 중이면 그 계정의 회사명(서버가 회사명을 주지 않았으면 입력), 아니면 첫 로그인 전 기록의 회사명 — 고칠 수 없어요
  const companyLocked = fix ? !!fix.company : !!pending;
  // 이름 · 연락처: 고치는 중이면 그 계정에 이름이 있을 때만 잠가요(그 계정 값). 이름이 없으면(C2 · 옛 기록) 열어서 받아요.
  // 첫 로그인 전 기록이면 잠그고 비워 둬요(조회가 주지 않고, 다시 보내기엔 쓰지 않아요).
  const personLocked = fix ? !!fix.name : !!pending;
  const nameShown = fix?.name ? fix.name : !fix && pending ? "" : name;
  const phoneShown = fix?.name ? (fix.phone ?? "") : !fix && pending ? "" : phone;
  // 칩을 넣지 않을 칸(잠긴 칸) — 그 칸에 연결된 칩은 「아직 안 씀」으로 보여요
  const lockedFields: ScanField[] = [...(companyLocked ? (["company"] as const) : []), ...(personLocked ? (["name", "phone"] as const) : [])];

  /** 이메일 칸 값 바꾸기 — 직접 칠 때와 명함 · 칩으로 넣을 때가 같은 정리를 해요(앞 기록의 안내가 남지 않게). */
  // companyNow = 지금 회사명 칸 값(명함으로 함께 채울 때는 새 값 — 옛 기록 회사명이 명함 회사명을 덮지 않게)
  function changeEmail(value: string, companyNow: string = company) {
    setEmail(value);
    // 주소 오류 기록에서 주소를 고쳐 새로 만들 때: 회사명이 비어 있으면 그 기록의 회사명을 미리 채우고,
    // 메일 언어도 그 기록의 언어로 둬요(둘 다 고칠 수 있어요)
    if (!fix && blocked && pending) {
      if (pending.company && !companyNow.trim()) setCompany(pending.company);
      langBeforePending.current = null;
    }
    if (emailError) setEmailError("");
    if (formError) setFormError("");
    if (cancelError) resetCancelError();
    setResetOpen(false);
    if (value.trim()) setEmailMissing(false);
  }

  /** 칸마다 값 넣기(명함 · 칩). 그 칸의 오류 안내는 지워요. */
  const putField: Record<ScanField, (v: string) => void> = {
    company: (v) => {
      setCompany(v);
      setCompanyError("");
    },
    name: (v) => {
      setName(v);
      setNameError("");
    },
    email: (v) => changeEmail(v),
    phone: (v) => {
      setPhone(v);
      setPhoneError("");
    },
  };
  const fieldRef: Record<ScanField, React.RefObject<HTMLInputElement | null>> = {
    company: companyRef,
    name: nameRef,
    email: emailRef,
    phone: phoneRef,
  };

  /** 직접 고치면 그 칸의 칩은 「아직 안 씀」으로(칩 규칙 6) — 고친 글자는 그대로 */
  const unlinkField = (field: ScanField) => setScan((s) => (s && s.links[field] !== undefined ? { ...s, links: unlink(s.links, field) } : s));

  const onFieldFocus = (field: ScanField) => {
    cursor.current = { field, blurredAt: null };
  };
  /** at = 이벤트 시각(e.timeStamp) */
  const onFieldBlur = (field: ScanField, at: number) => {
    if (cursor.current?.field === field) cursor.current = { field, blurredAt: at };
  };
  /** 지금(now = 이벤트 시각) 커서가 있는 칸. 칩을 눌러 방금(0.5초 안) 빠진 칸도 커서로 봐요 — 다른 곳을 눌러 빠졌으면 커서 없음. */
  function cursorField(now: number): ScanField | null {
    const c = cursor.current;
    if (!c) return null;
    return c.blurredAt === null || now - c.blurredAt < 500 ? c.field : null;
  }

  function onChip(chip: Chip, now: number) {
    if (!scan) return;
    const at = cursorField(now);
    const r = tapChip(chip, scan.links, { company, name, email, phone }, at, lockedFields);
    setScan({ ...scan, links: r.links });
    if (r.set) putField[r.set.field](r.set.value);
    // 커서는 있던 칸에 그대로(메일 · 전화 칩이 다른 칸에 들어가도) — 다음 칩도 같은 칸을 고를 수 있게
    const focus = r.focus ?? at;
    if (focus) fieldRef[focus].current?.focus();
  }

  /**
   * 명함 사진을 읽어 네 칸을 채워요(동작 규칙 1~4 · 칩 규칙 1 · 7). 원본은 이 함수 안에서만 읽고 버려요(글자 읽기는 기기 안에서).
   * 줄인 비교용 사진만 창에 두고, 만들지 않고 닫으면 「작성 중」 명함으로 서버에 남겨요(기획 16864).
   * 다시 찍으면 칩 목록을 바꾸고 네 칸을 새로 채워요(읽지 못한 칸은 비워요). 읽지 못하면 칸은 그대로 두고 안내만 해요.
   */
  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const file = input.files?.[0];
    input.value = ""; // 입력 칸이 사진을 붙잡고 있지 않게(같은 사진을 다시 골라도 다시 읽어요)
    if (!file) return;
    // 보내는 중이거나 주소를 고치는 중(fix)에 늦게 온 사진은 받지 않아요 — 고치는 동안 보던 사진을 지우거나,
    // 결과 화면 뒤에 사진이 메모리에 남지 않게
    if (sending || fix || fixRef.current) return;
    // 앞 명함 사진은 바로 비워요 — 이번 읽기가 실패해도 앞 명함 사진이 이번 고객 것처럼 남지 않게
    setPhoto(null);
    setScanning(true);
    setScanFailed(false);
    let text: string | null = null;
    let preview: string | null = null;
    try {
      ({ text, preview } = await reader.read(file));
    } catch {
      text = null;
    } finally {
      setScanning(false);
    }
    // 읽는 사이 주소를 고치는 모드로 바뀌었으면(보내기 결과) 늦게 온 결과는 버려요 — 고치는 계정의 칸을 바꾸지 않게
    if (fixRef.current) return;
    // 비교용 사진은 이번 명함으로 — 글자를 못 읽었어도(직접 입력할 때 보며 비교)
    setPhoto(preview);
    const result = text === null ? null : scanCard(text);
    if (!result || result.chips.length === 0) return setScanFailed(true);
    setScan({ chips: result.chips, links: result.links });
    // 회사명 · 이름은 비워요(처음 채우기는 이메일 · 연락처만 — 직원이 칩을 눌러 넣어요, 기획 16846)
    // 이메일은 마지막에 — 주소 오류 기록의 회사명 미리 채우기는 회사명 칸이 비었을 때만 채워요
    putField.company(result.values.company);
    putField.name(result.values.name);
    putField.phone(result.values.phone);
    changeEmail(result.values.email, result.values.company);
    cursor.current = null;
    setEmailMissing(!result.values.email);
    // 메일 주소를 못 읽었으면 이메일 칸에 커서(N4)
    if (!result.values.email) emailRef.current?.focus();
  }

  // 명함(칩)에서 들어온 이메일이면 헷갈리는 글자 · 도메인 확인 안내를 보여 줘요 — 직접 고치면(칩 연결이 풀리면) 사라져요
  const scannedEmail = scan?.links.email !== undefined;

  if (mailFailure) {
    return (
      <Dialog title="Gate 계정 만들기" onClose={close}>
        <MailFailureResult account={mailFailure.account} reason={mailFailure.reason} onClose={close} onCancelled={onCancelled} />
      </Dialog>
    );
  }

  return (
    <Dialog title="Gate 계정 만들기" onClose={close} closable={!sending} wide>
      <form className="dialog-form" onSubmit={onSubmit} noValidate>
        {/* 찍은 명함 — 읽은 줄(칩)이 있으면 칩 왼쪽(N7), 없거나 주소를 고치는 동안(fix)이면 여기. 누르면 크게 */}
        {photo && (fix || !scan) && <CardPhotoThumb src={photo} onOpen={() => setViewingPhoto(true)} />}
        {/* 명함 찍어서 채우기(N1~N4) — 주소를 고치는 중(fix)에는 다른 명함을 읽을 일이 없어 숨겨요 */}
        {!fix && (
          <div className="scan">
            {scan ? (
              <>
                <div className="scan-head">
                  <span className="scan-title">명함에서 읽은 줄 · 누르면 커서가 있는 칸에 들어갑니다</span>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() => fileRef.current?.click()}
                    disabled={scanning || sending}
                    aria-busy={scanning || undefined}
                  >
                    {scanning ? SCAN_READING : "명함 다시 찍기"}
                  </button>
                </div>
                <div className="scan-body">
                  {photo && <CardPhotoThumb src={photo} onOpen={() => setViewingPhoto(true)} />}
                  <div className="scan-chips" role="group" aria-label="명함에서 읽은 줄">
                    {scan.chips.map((chip) => {
                      const filled = isFilled(scan.links, chip.id, lockedFields);
                      return (
                        <button
                          key={chip.id}
                          type="button"
                          className={`scan-chip${filled ? " is-filled" : ""}`}
                          aria-pressed={filled}
                          title={chip.text}
                          // 누르는 동안 칸의 커서가 빠지지 않게(PC). 아이패드는 cursorField 가 방금 빠진 칸을 기억해요.
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={(e) => onChip(chip, e.timeStamp)}
                          disabled={scanning}
                        >
                          {chip.text}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {/* 다시 읽는 동안에는 지난 결과(「명함에서 읽었습니다…」) 대신 기다림 안내 — 낭독기가 읽게 같은 상태 줄에 */}
                <p className="help" role="status">
                  {scanning ? SCAN_WAIT : scanFailed ? SCAN_FAILED : SCAN_DONE}
                </p>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="btn btn-outline scan-button"
                  onClick={() => fileRef.current?.click()}
                  disabled={scanning || sending}
                  aria-busy={scanning || undefined}
                >
                  <IcCamera size={16} />
                  {scanning ? SCAN_READING : "명함 찍어서 채우기"}
                </button>
                {/* 읽는 동안(N2)은 안내 아래에 기다림 안내를 한 줄 더 — 둘 다 상태 줄 안이라 낭독기가 읽어요 */}
                <div className="scan-status" role="status">
                  <p className="help">{scanFailed ? SCAN_FAILED : SCAN_HELP}</p>
                  {scanning && <p className="help">{SCAN_WAIT}</p>}
                </div>
              </>
            )}
          </div>
        )}

        <div className="field-row">
          <div className="field">
            <label htmlFor="company" className="t-body-200-b">
              회사명
            </label>
            <div className={`input-box${companyError ? " is-error" : ""}${companyLocked ? " is-readonly" : ""}`}>
              <input
                ref={companyRef}
                id="company"
                autoComplete="organization"
                // 이미 만든 계정이면 기록의 회사명을 보여 주고 고칠 수 없어요(다시 보내기엔 쓰이지 않아요).
                readOnly={companyLocked}
                placeholder={!fix && pending ? (pending.company ? undefined : "이미 만든 계정의 회사명 그대로") : "회사명"}
                value={fix?.company ? fix.company : !fix && pending ? (pending.company ?? "") : company}
                onChange={(e) => {
                  setCompany(e.target.value);
                  if (companyError) setCompanyError("");
                  unlinkField("company");
                }}
                onFocus={() => onFieldFocus("company")}
                onBlur={(e) => onFieldBlur("company", e.timeStamp)}
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
            <label htmlFor="person-name" className="t-body-200-b">
              이름
            </label>
            <div className={`input-box${nameError ? " is-error" : ""}${personLocked ? " is-readonly" : ""}`}>
              <input
                ref={nameRef}
                id="person-name"
                autoComplete="off"
                readOnly={personLocked}
                placeholder={!fix && pending ? "이미 만든 계정 그대로" : "고객 이름"}
                value={nameShown}
                onChange={(e) => {
                  setName(e.target.value);
                  if (nameError) setNameError("");
                  unlinkField("name");
                }}
                onFocus={() => onFieldFocus("name")}
                onBlur={(e) => onFieldBlur("name", e.timeStamp)}
                aria-invalid={!!nameError}
                aria-describedby={nameError ? "name-error" : undefined}
              />
            </div>
            {nameError && (
              <p id="name-error" className="error">
                {nameError}
              </p>
            )}
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <div className="field-top">
              <div className="field-head">
                <label htmlFor="email" className="t-body-200-b">
                  고객 이메일
                </label>
                {/* 사용 중일 때만: 누르면 바로 아래에 안내가 펼쳐지고, 다시 누르면 접혀요 */}
                {inUse && (
                  <button
                    type="button"
                    className="field-link"
                    aria-expanded={resetOpen}
                    aria-controls="reset-guide"
                    onClick={() => setResetOpen((o) => !o)}
                  >
                    고객이 비밀번호를 잊었나요?
                    <IcArrowDown size={12} className={resetOpen ? "is-up" : undefined} />
                  </button>
                )}
              </div>
              {inUse && resetOpen && (
                <p id="reset-guide" className="help field-guide">
                  로그인 화면의 「비밀번호 재설정」을 안내해 주세요.
                </p>
              )}
            </div>
            <div className={`input-box${emailError || inUse || closing || fixSame || fixTaken ? " is-error" : ""}`}>
              <input
                ref={emailRef}
                id="email"
                type="email"
                inputMode="email"
                autoComplete="off"
                placeholder="name@company.com"
                value={email}
                onChange={(e) => {
                  changeEmail(e.target.value);
                  unlinkField("email");
                }}
                onFocus={() => onFieldFocus("email")}
                onBlur={(e) => {
                  onFieldBlur("email", e.timeStamp);
                  void runCheck();
                }}
                aria-invalid={!!emailError || inUse || closing || fixSame || fixTaken}
                aria-describedby="email-note"
              />
            </div>
            <div id="email-note" role="status" aria-live="polite">
              {emailError ? (
                <p className="error">{emailError}</p>
              ) : fix && cancelError ? (
                <p className="error">{cancelErrorText(cancelError)}</p>
              ) : fixSame ? (
                // 주소 오류(I2 · C2): PC 는 한 줄, 휴대폰은 문장마다
                <Sentences text={FIX_ADDRESS_TEXT} />
              ) : fixTaken ? (
                <p className="error">이미 만든 계정의 이메일입니다. 다른 주소를 입력해 주세요.</p>
              ) : closing ? (
                <p className="error">{CLOSING_TIP}. 해지가 끝나거나 철회될 때까지 보낼 수 없습니다.</p>
              ) : fix && !inUse ? null : inUse ? (
                // 정말 막힌 경우: 빨간 한 줄 + 실행 버튼 비활성
                <p className="error">이미 사용 중인 이메일입니다.</p>
              ) : blocked && pending ? (
                // 다시 보낼 수 없는 경우: 까닭은 아래 빨간 안내로, 실행 버튼은 「발급 취소」
                <p className="help">
                  이미 만든 계정입니다({handle(pending.createdBy)} · {fmtMonthDay(pending.createdAt)}).
                </p>
              ) : pending ? (
                // 오류가 아니라 할 일이 바뀐 경우: 회색 안내 + 실행 버튼이 「안내 메일 다시 보내기」
                <p className="help">
                  이미 만든 계정입니다({handle(pending.createdBy)} · {fmtMonthDay(pending.createdAt)}). 로그인 전이라 다시 보낼 수 있습니다.
                </p>
              ) : emailMissing ? (
                // 명함에서 메일 주소를 못 읽음(N4) — 막힌 게 아니라 회색(C 와 같은 모양)
                <p className="help">메일 주소를 찾지 못했습니다. 직접 입력해 주세요.</p>
              ) : (
                <p className="help">주소가 틀리면 다른 사람이 계정을 받습니다.</p>
              )}
            </div>
            {/* 명함에서 읽은 이메일의 헷갈리는 글자 · 도메인 — 위 안내(「주소가 틀리면…」 · 오류 · 주소 오류 · 이미 만든 계정) 아래에 덧붙여요 */}
            {scannedEmail && <ScannedEmailNotes email={trimmed} />}
          </div>

          <div className="field">
            <label htmlFor="person-phone" className="t-body-200-b">
              연락처<span className="field-optional">(선택)</span>
            </label>
            <div className={`input-box${phoneError ? " is-error" : ""}${personLocked ? " is-readonly" : ""}`}>
              <input
                ref={phoneRef}
                id="person-phone"
                type="tel"
                inputMode="tel"
                autoComplete="off"
                readOnly={personLocked}
                placeholder={!fix && pending ? "이미 만든 계정 그대로" : personLocked ? undefined : "+65 0000 0000"}
                value={phoneShown}
                onChange={(e) => {
                  setPhone(e.target.value);
                  if (phoneError) setPhoneError("");
                  unlinkField("phone");
                }}
                onFocus={() => onFieldFocus("phone")}
                onBlur={(e) => onFieldBlur("phone", e.timeStamp)}
                aria-invalid={!!phoneError}
                aria-describedby={phoneError ? "phone-error" : undefined}
              />
            </div>
            {phoneError && (
              <p id="phone-error" className="error">
                {phoneError}
              </p>
            )}
          </div>
        </div>

        {/* 고치는 중이면 메일 언어는 처음 만든 그대로, 사용 중 · 발급 취소만 남은 기록이면 보낼 메일이 없어요 — 줄을 숨겨요 */}
        {!fix && !inUse && !closing && !blocked && (
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
                onClick={() => {
                  langBeforePending.current = null; // 직접 고르면 되돌리지 않아요
                  setLanguage(value);
                  setLanguageChosen(true);
                }}
              >
                <Flag />
                {label}
              </button>
            ))}
          </div>
        </div>
        )}

        {!fix && pending && !blocked && <p className="help">다시 보내면 이전 임시 비밀번호는 쓸 수 없게 됩니다.</p>}
        {!fix && blocked &&
          (cancelError ? (
            <p className="error" role="alert">
              {cancelErrorText(cancelError)}
            </p>
          ) : (
            <MailFailureMessage reason="blocked" />
          ))}
        {formError && (
          <p className="error mail-failure" role="alert">
            {formError}
          </p>
        )}

        {fix ? (
          // 주소 그대로면 [닫기] [발급 취소](I2 · C2), 고치면 [닫기] [재발송](I3 · C3)
          <div className="dialog-actions">
            <button type="button" className="btn btn-outline" onClick={close} disabled={cancelling || sending}>
              닫기
            </button>
            {fixSame ? (
              cancelError !== "in_use" && cancelError !== "not_found" && cancelError !== "closing" && (
                <button type="button" className="btn btn-danger-outline" onClick={() => cancelNow(fix)} disabled={cancelling} aria-busy={cancelling || undefined}>
                  {cancelling ? "취소하는 중…" : "발급 취소"}
                </button>
              )
            ) : (
              <button type="submit" className="btn btn-dark" disabled={inUse || closing || fixTaken || sending || scanning} aria-busy={sending || checking || undefined}>
                {sending ? "보내는 중…" : "재발송"}
              </button>
            )}
          </div>
        ) : blocked && pending ? (
          // 목록 실패 창(K)과 같은 버튼: 「닫기」 · 「발급 취소」
          <div className="dialog-actions">
            <button type="button" className="btn btn-outline" onClick={close} disabled={cancelling}>
              닫기
            </button>
            {cancelError !== "in_use" && cancelError !== "not_found" && cancelError !== "closing" && (
              <button type="button" className="btn btn-danger-outline" onClick={() => cancelNow(pendingTarget(pending))} disabled={cancelling} aria-busy={cancelling || undefined}>
                {cancelling ? "취소하는 중…" : "발급 취소"}
              </button>
            )}
          </div>
        ) : (
          <div className="dialog-actions">
            <button type="button" className="btn btn-outline" onClick={close} disabled={sending}>
              취소
            </button>
            <button type="submit" className="btn btn-dark" disabled={inUse || closing || sending || scanning} aria-busy={sending || checking || undefined}>
              {sending ? "보내는 중…" : pending ? "안내 메일 다시 보내기" : "계정 만들고 메일 보내기"}
            </button>
          </div>
        )}
        {/* 아이패드 · 휴대폰은 카메라가 바로 열려요(capture). 폼 끝에 둬요 — 창이 열릴 때 초점이 회사명 칸에 가게(Dialog 는 첫 input 에 초점) */}
        <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={onPhoto} />
      </form>
      {viewingPhoto && photo && <CardPhotoViewer src={photo} onClose={() => setViewingPhoto(false)} />}
    </Dialog>
  );
}

/**
 * 목록 줄의 「안내 메일 다시 보내기」 확인 창(F).
 * 메일 서버가 받지 않았으면 까닭을 보여 주고(J · K) 목록을 새로 고쳐 줄 상태를 바꿔요 — 이 창에서 다시 누르지 않아요.
 */
function ResendDialog({
  account,
  onClose,
  onResent,
  onMailFailed,
  onCancelled,
}: {
  account: Account;
  onClose: () => void;
  onResent: () => void;
  onMailFailed: () => void;
  onCancelled: () => void;
}) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  // 그사이 고객이 로그인했거나 취소된 계정 — 더 보낼 수 없으니 「닫기」만 남겨요(발급 취소 창과 같게).
  const [final, setFinal] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [mailFailure, setMailFailure] = useState<MailFailureReason | "blocked" | null>(null);

  useEffect(() => {
    if (final) closeRef.current?.focus();
  }, [final]);

  async function send() {
    setSending(true);
    setError("");
    const res = await resendGuide(account.id, account.language);
    setSending(false);
    if (res.ok) return onResent();
    if (isMailFailure(res.reason)) {
      setMailFailure(res.reason);
      return onMailFailed();
    }
    setError(resendErrorText(res.reason));
    if (res.reason === "in_use" || res.reason === "not_found") setFinal(true);
  }

  if (mailFailure) {
    return (
      <Dialog title="안내 메일 다시 보내기" onClose={onClose}>
        <MailFailureResult account={account} reason={mailFailure} onClose={onClose} onCancelled={onCancelled} />
      </Dialog>
    );
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
        {final ? (
          <button ref={closeRef} type="button" className="btn btn-outline" onClick={onClose}>
            닫기
          </button>
        ) : (
          <>
            <button type="button" className="btn btn-outline" onClick={onClose} disabled={sending}>
              취소
            </button>
            <button type="button" className="btn btn-dark" onClick={send} disabled={sending} aria-busy={sending || undefined}>
              {sending ? "보내는 중…" : "다시 보내기"}
            </button>
          </>
        )}
      </div>
    </Dialog>
  );
}

/** 목록 줄의 「발급 취소」 확인 창(H · 휴대폰 M4). 누르는 사이 고객이 로그인했으면 취소하지 않아요(H2). */
function CancelDialog({
  account,
  onClose,
  onCancelled,
}: {
  account: Account;
  onClose: () => void;
  onCancelled: () => void;
}) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<"" | CancelFailure>("");

  async function cancel() {
    setSending(true);
    setError("");
    const res = await cancelIssue(account.id);
    setSending(false);
    if (res.ok) return onCancelled();
    setError(res.reason);
  }

  return (
    <Dialog title="발급 취소" onClose={onClose} closable={!sending}>
      <div className="summary">
        <div className="summary-target">
          <strong>{account.company}</strong>
          <span>
            {account.email} · {statusText(account)}
          </span>
        </div>
        <dl className="summary-rows">
          <div>
            <dt>삭제 대상</dt>
            <dd>
              계정 · 데모 프로젝트{account.demoRecords !== undefined && `(데모 기록 ${account.demoRecords}건)`}
            </dd>
          </div>
          <div>
            <dt>보낸 메일</dt>
            <dd>비밀번호와 체험 링크를 쓸 수 없게 됨</dd>
          </div>
          <div>
            <dt>재발급</dt>
            <dd>같은 이메일로 가능</dd>
          </div>
        </dl>
      </div>
      {error && (
        <p className="error" role="alert">
          {cancelErrorText(error)}
        </p>
      )}
      <div className="dialog-actions">
        {error === "in_use" || error === "not_found" || error === "closing" ? (
          <button type="button" className="btn btn-outline" onClick={onClose} autoFocus>
            닫기
          </button>
        ) : (
          <>
            {/* 처음 초점은 「취소」 — Enter 한 번에 지워지지 않게 */}
            <button type="button" className="btn btn-outline" onClick={onClose} disabled={sending} data-autofocus>
              취소
            </button>
            <button type="button" className="btn btn-danger-outline" onClick={cancel} disabled={sending} aria-busy={sending || undefined}>
              {sending ? "취소하는 중…" : "발급 취소"}
            </button>
          </>
        )}
      </div>
    </Dialog>
  );
}

/**
 * 「작성 중」 명함 [지우기] 확인 창(UG-431 기획 16864) — 발급 취소 확인 창과 같은 모양. 확인하면 바로 지워요(사진 · 칩 · 입력한 값 모두).
 * 이미 없으면(계정을 만들었거나 다른 직원이 지움) 지운 것으로 봐요.
 */
function DraftDeleteDialog({
  draft,
  onDelete,
  onClose,
  onDeleted,
}: {
  draft: CardDraft;
  onDelete: () => Promise<boolean>;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const target = [draft.company, draft.name].filter(Boolean).join(" · ");

  async function remove() {
    setSending(true);
    setFailed(false);
    const ok = await onDelete();
    setSending(false);
    if (ok) return onDeleted();
    setFailed(true);
  }

  return (
    <Dialog title="작성 중인 명함 지우기" onClose={onClose} closable={!sending}>
      {(target || draft.email) && (
        <div className="summary">
          <div className="summary-target">
            {target && <strong>{target}</strong>}
            {draft.email && <span>{draft.email}</span>}
          </div>
        </div>
      )}
      <p>작성 중인 명함을 지우시겠습니까? 명함 사진과 입력한 값이 모두 지워집니다.</p>
      {failed && (
        <p className="error" role="alert">
          작성 중인 명함을 지우지 못했습니다. 다시 시도해 주세요.
        </p>
      )}
      <div className="dialog-actions">
        {/* 처음 초점은 「취소」 — Enter 한 번에 지워지지 않게 */}
        <button type="button" className="btn btn-outline" onClick={onClose} disabled={sending} data-autofocus>
          취소
        </button>
        <button type="button" className="btn btn-danger-outline" onClick={remove} disabled={sending} aria-busy={sending || undefined}>
          {sending ? "지우는 중…" : "지우기"}
        </button>
      </div>
    </Dialog>
  );
}
