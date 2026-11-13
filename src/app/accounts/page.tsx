"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, useCallback, useEffect, useId, useRef, useState } from "react";
import { Dialog, PopupSelect, StatusChips, Toast, ToastStack } from "@/components/ui";
import { AppHeader } from "@/components/app-header";
import { CardPhotoViewer } from "@/components/card-photo-viewer";
import { fmtFull, fmtShort, handle, kstParts, pageItems } from "@/lib/format";
import { FlagKR, FlagUS } from "@/components/flags";
import { IcArrowLeft, IcArrowRight, IcCamera, IcInputClose, IcMoreVert, IcReload, IcSearch } from "@/components/icons";
import {
  cancelIssue,
  checkEmail,
  createAccount,
  deleteCardDraft,
  exportAccounts,
  getAccountCardPhoto,
  getCardDraft,
  getSummary,
  listAccounts,
  listCardDrafts,
  logout,
  resendGuide,
  readCardOnServer,
  saveCardDraft,
  sendPasswordResetLink,
  CARD_DRAFT_MAX,
  type Account,
  type AccountStatus,
  type AccountStatusFilter,
  type AccountSummary,
  type CancelFailure,
  type CardDraft,
  type CardDraftDetail,
  type CardDraftInput,
  type CardDraftSaveResult,
  type EmailCheck,
  type MailFailureReason,
  type MailLanguage,
  type PasswordResetFailure,
  type PasswordResetResult,
  type ResendFailure,
} from "@/lib/api";
import { useStaff } from "@/lib/session";
import { ACCOUNTS_DEFAULT, SALES_CLOSURES_HREF, parseAccountsQuery, serializeAccountsQuery, type AccountsQuery } from "@/lib/list-query";
import { useUrlQuery } from "@/lib/use-url-query";
import { isTextTruncated, tipOpensUp } from "@/lib/text-overflow";
import { isTouchPrimary } from "@/lib/pointer";
import { buildAccountsCsv, exportFileName } from "@/lib/accounts-csv";
import { createCardReader, type ReadFailure } from "@/lib/card-ocr";
import { readOnServer, serverChips, serverReadAvailable, serverScan, type ServerReading } from "@/lib/card-read";
import { ApiError } from "@/lib/http";
import { CARD_PHOTO_TEXT, cancelTargetsText, cardPhotoNotSaved, purgeLegacyCardPhotos } from "@/lib/card-photo";
import { RECREATE_TEXT, newAccountMailText, oldIssueAfterCreate, oldIssueLeft, oldIssueRevoked } from "@/lib/recreate";
import { chipsForDraft, draftField, photoForDraft, photoFromDraft, scanFromDraft } from "@/lib/card-draft";
import { retakeNote, retakeNoteText, retakePlan, retakeVerdict, type RetakeNote, type RetakeVerdict } from "@/lib/card-retake";
import { createAutosaver, draftContentKey, photoTag, type AutosaveResult, type Autosaver } from "@/lib/draft-autosave";
import {
  LOST_CLOCK_SKEW_MS,
  addLost,
  chipEmailsState,
  draftSaveGate,
  forNewDraft,
  gateAtClose,
  ownDraftToDiscard,
  photoPlan,
  recordSave,
  resolveLostDraft,
  withoutFields,
  withoutPhoto,
  type DraftMemory,
  type LostLookup,
  type LostSaves,
} from "@/lib/draft-session";
import {
  chipEmailAddresses,
  confusableNote,
  isEmailLikeChip,
  isFilled,
  isSuspectChip,
  isUnconfirmedSuspect,
  nextChipTarget,
  scanCard,
  tapChip,
  unlink,
  type Chip,
  type OcrLine,
  type ScanField,
  type ScanLinks,
  type ScanValues,
} from "@/lib/card-scan";

const COMPANY_MAX = 40;
// 고객 이메일 — 서버(CreateAccountRequest · AccountIssuance.EMAIL_MAX_LENGTH)와 같은 한도. 칸에서 그 이상은 칠 수 없어요(UG-451 기획 17073)
const EMAIL_MAX = 255;
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
/** 휴대폰은 한 줄로(UG-453 기획 6 — SE · 안드로이드에서 세 줄이었어요). 이름 · 회사명 넣는 법은 읽은 뒤 칩 위 안내에 있어요 */
const SCAN_HELP_SHORT = CARD_PHOTO_TEXT.scanHelpShort;
const SCAN_READING = "명함을 읽고 있습니다…";
// 읽는 동안만(N2) — 첫 읽기는 글자 읽기 도구(약 8MB)를 내려받아 더 걸려요
const SCAN_WAIT = "보통 몇 초 걸립니다. 처음 한 번은 글자 읽기 도구를 내려받아 조금 더 걸립니다.";
const SCAN_DONE = "명함에서 읽었습니다. 틀린 글자가 있을 수 있으니 고객과 함께 확인해 주세요.";
// 서버가 명함을 읽는 동안(UG-463) — 도구를 내려받지 않아요. 서버가 읽지 못하면(25초 · 꺼짐 · 오류) 기기 안 읽기로 넘어가며 위 SCAN_WAIT 로 바뀌어요
const SCAN_SERVER_WAIT = "명함을 읽고 있습니다. 보통 몇 초 걸립니다.";
// 읽기 도구를 받지 못했거나(첫 사용 · 인터넷 없음) 글자를 찾지 못함 — 막힌 게 아니라 직접 입력하면 돼서 회색
const SCAN_FAILED = "명함을 읽지 못했습니다. 다시 찍거나 직접 입력해 주세요.";
// 글자 읽기 도구(약 8.5MB)를 받지 못함(인터넷 없음 · 시간 초과) — 다시 찍어도 같으니 직접 입력 안내(UG-451 기획 16991)
const SCAN_TOOL_FAILED = "글자 읽기 도구를 받지 못했습니다. 직접 입력해 주세요.";
// 도구 받기를 이 페이지에서 여러 번 실패해 저절로 다시 받지 않을 때(UG-451 기획 17022 — 실패한 일꾼은 닫을 수 없어 쌓여요)
const SCAN_TOOL_RELOAD = "글자 읽기 도구를 받지 못했습니다. 페이지를 새로 고친 뒤 다시 찍어 주세요.";
// 아이폰 HEIC · HEIF 사진을 읽지 못함 — 브라우저가 열지 못하는 형식이라 다시 찍게 해요(UG-451 기획 16991)
const SCAN_FORMAT_FAILED = "이 사진 형식은 읽을 수 없습니다. 다시 찍어 주세요.";
/** HEIC · HEIF 사진인지(형식 · 확장자) */
const isHeic = (file: File) => /^image\/hei[cf](-sequence)?$/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
/** 명함 읽기가 실패한 까닭 — format = 읽을 수 없는 사진 형식(HEIC), tool · read 는 card-ocr.ts */
type ScanFailure = ReadFailure | "format";
/** 도구를 받는 동안의 기다림 안내(진행률 0~100) */
const scanDownloading = (percent: number) => `글자 읽기 도구를 받고 있습니다… ${percent}%`;
/** 찍힌 방향으로 못 읽어 돌려 다시 읽는 동안(UG-451 기획 17106-3) — 몇 번째 방향인지 보여 줘 멈춘 것처럼 보이지 않게 */
const scanRotating = (attempt: number, total: number) => `명함 방향을 바꿔 다시 읽고 있습니다… (${attempt}/${total})`;
/** 읽은 줄(칩) 펼침 글자 버튼(UG-451 기획 17100 규칙 3, M16 · M17) */
const chipsToggleText = (open: boolean, count: number) => (open ? "읽은 줄 접기" : `읽은 줄 모두 보기 (${count})`);
/** 명함 찍기 버튼 — 못 읽은 뒤에는 「명함 다시 찍기」(UG-451 기획 17106-1 — 깨진 줄은 보여 주지 않고 이 버튼만 남겨요) */
const SCAN_BUTTON = "명함 찍어서 채우기";
const SCAN_AGAIN = "명함 다시 찍기";
/** 칩 대상 칸 이름(낭독기 알림, UG-453 리뷰 m2) — 창의 칸 이름과 같게 */
const CHIP_TARGET_LABEL: Record<ScanField, string> = { company: "회사명", name: "이름", email: "고객 이메일", phone: "연락처" };

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
  // 「첫 로그인 전」 → 「로그인 전」(UG-450 기획 17007) — 요약 카드 · 칩 · 선택 상자 · 표 · 카드 · CSV 가 모두 이 이름을 따라요
  pending: "로그인 전",
  in_use: "사용 중",
  closing: "해지 중",
  cancelled: "발급 취소",
  closed: "해지됨",
};
/** 해지 중인 줄의 동작 안내(툴팁) — 해지 중인 줄은 목록에서 빠졌지만(UG-458) 서버가 바뀌기 전 · 사이에 오면 그대로 막아요 */
const CLOSING_TIP = "해지 처리 중인 계정입니다";
/** 계정 만들기 창: 해지 처리 중인 이메일(조회 closing · 만들기 실패 closing, UG-458 기획 5) — 만들기는 지금처럼 막아요 */
const CLOSING_EMAIL = "해지 처리 중인 이메일이에요. 끝난 뒤 다시 만들 수 있어요.";

/** 목록 ⋮ 「명함 보기」를 보여 줄 줄(UG-455) — 서버에 명함 사진이 있고 첫 로그인 전 · 사용 중일 때만(해지 중 · 발급 취소 · 해지됨은 숨겨요, 사용자 결정) */
const canViewCardPhoto = (a: Account) => a.hasCardPhoto === true && (a.status === "pending" || a.status === "in_use");
/** 발급 취소 · 해지됨 — 계정이 없어진 기록(고객 정보를 비웠어요). 목록 줄 · 카드가 흐리게 · 누가 · 언제만 보여요. */
const isGone = (a: Account) => a.status === "cancelled" || a.status === "closed";

/** 검색어와 맞은 글자에 바탕색 — 대소문자 구분 없이, 여러 번 나오면 모두. 비어 있는 값(null 포함)은 그냥 빈 글자(UG-443 기획 16925). */
function Highlight({ text: value, query }: { text: string | null | undefined; query: string }) {
  const text = value ?? "";
  const q = query.trim().toLowerCase();
  if (!q || !text) return text;
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
function noResultText({ keyword, status }: { keyword: string; status: AccountStatusFilter }) {
  const label = status === "all" ? "" : STATUS_LABEL[status];
  const where = status === "all" ? "" : `「${label}」에서 `;
  const k = keyword.trim();
  if (k)
    return (
      <>
        {where}
        <strong className="empty-keyword">‘{k}’</strong>에 대한 검색 결과가 없습니다.
      </>
    );
  return status === "all" ? "검색 결과가 없습니다." : `「${label}」 계정이 없습니다.`;
}

const fmtMonthDay = (iso: string) => {
  const t = kstParts(iso);
  return `${t.m}.${t.d}`;
};

/**
 * 발급 취소 · 해지됨 줄의 처리 기록 「11.05 14:51 · khj」(UG-450 기획 16965) — PC 표는 상태 아래 줄(기획 17007), 휴대폰 카드는 둘째 줄(UG-463 기획 17235).
 * 해지됨은 해지를 실행한 직원 · 파기 완료 시각. 직원이 없으면(시스템 정리) 시각만, 둘 다 없으면 "".
 */
const goneRecord = (a: Account) =>
  [a.cancelledAt ? fmtShort(a.cancelledAt) : "", handle(a.cancelledBy)].filter(Boolean).join(" · ");

/**
 * PC 표의 상태 칸(UG-450 기획 17007) — 발급 취소 · 해지됨이면 두 줄: 「● 발급 취소」 아래에 처리 기록 「11.05 14:51 · khj」.
 * 처리 기록은 점 뒤 글자 시작에 맞춰 들여 써요(13 · 회색). 휴대폰 카드는 상태가 첫 줄 오른쪽 위, 처리 기록이 둘째 줄(UG-463 기획 17235).
 */
function StatusCell({ account }: { account: Account }) {
  const record = isGone(account) ? goneRecord(account) : "";
  if (!record) return <Status account={account} />;
  return (
    <span className="status-stack">
      <Status account={account} />
      {/* 직원 이름이 길어 잘렸을 때만 마우스를 올리면 전체(F8) */}
      <ClipText className="gone-record status-stack-record" text={record} query="" />
    </span>
  );
}

/** 표의 메일 언어 — 고객 칸 이메일 뒤 「 · 영문」(UG-450 기획 17007). CSV · 계정 만들기 창은 전처럼 English · 한국어 */
const LANGUAGE_TAG: Record<MailLanguage, string> = { en: "영문", ko: "국문" };

/**
 * 한 줄 말줄임 글자. 잘렸을 때만 마우스를 올리면 전체 글자(title) — 잘렸는지는 올리는 순간 재요(표 폭 · 글꼴이 바뀌어도 맞게).
 * 말줄임은 눈에만 그래요 — 낭독기는 전체 글자를 읽어요.
 */
function ClipText({ text, query, className }: { text: string; query: string; className: string }) {
  return (
    <span
      className={className}
      onMouseEnter={(e) => {
        const el = e.currentTarget;
        if (isTextTruncated(el)) el.title = text;
        else el.removeAttribute("title");
      }}
    >
      <Highlight text={text} query={query} />
    </span>
  );
}

/**
 * 말줄임되면 눌러서 전체 글자를 작은 말풍선으로 보는 한 줄 글자(UG-450 기획 16995 · 17020) — 휴대폰 카드의 회사명, PC 표의 회사명 · 이메일.
 * 아이패드(전시장 기기) · 휴대폰은 마우스를 올릴 수 없어 title 이 보이지 않아요 — 눌러서 봐요. 마우스로는 전처럼 올리면 전체 글자(title).
 * 말줄임되지 않은 글자는 그냥 글자(누를 것이 없어요). 말줄임 여부는 상자 · 글자 폭이 바뀔 때마다 다시 재요(isTextTruncated).
 * 말풍선은 화면에 고정(position: fixed)해 표의 옆 스크롤 상자에 잘리지 않게 하고, 바깥 누르기 · Esc · 스크롤 · 창 크기 바뀜 · 화면 이동(뒤로 가기) ·
 * 다른 곳으로 초점이 가면 닫혀요. 목록을 새로 받으면(resetOn — RowMenu 와 같게) 닫고, 줄이 사라지면 말풍선도 함께 없어져요(이 컴포넌트 안에 그려요).
 * 키보드: Tab 으로 가서 Enter · Space(버튼).
 * 말풍선이 열린 채 다른 말줄임 글자를 누르면 한 번에 그 글자의 말풍선으로 바뀌어요(UG-450 기획 17028 — 전에는 닫히기만 해 두 번 눌러야 했어요).
 * 말풍선은 보기만 하는 것이라 누름을 받지 않고(pointer-events: none) 그 아래 글자가 받아요 — 회사명 말풍선이 아래 이메일 줄을 덮어도 이메일을 누를 수 있어요.
 * 다른 말줄임 글자를 누를 때는 바깥 누르기로 닫지 않고, 그 글자가 열리면서 앞 말풍선을 닫아요(openTapClip) — 누르는 도중에 화면이 바뀌지 않게.
 * text = 말풍선 · title 의 전체 글자, children = 보이는 글자(검색 강조 등), className = 말줄임 글자의 클래스, wrapClassName = 감싸는 상자의 클래스
 * dismissLayer = 말풍선이 열린 동안 화면 전체에 투명한 막을 깔아, 다음 누름은 말풍선을 닫기만 해요(UG-453 기획 7 — 휴대폰 카드).
 *   두 줄 말풍선이 이웃 카드의 「메일 재발송」 · ⋮ 를 덮어, 닫으려고 누른 곳의 버튼이 함께 눌렸어요. 막 아래가 다른 말줄임 글자면
 *   한 번에 그 말풍선으로 바꿔요(기획 17028 과 같게). PC 표(아이패드)는 막 없이 전과 같아요.
 */
/** 지금 열린 말풍선(한 번에 하나) — 다른 TapClip 이 열리면 이것을 닫아요(UG-450 기획 17028) */
let openTapClip: { id: string; close: () => void } | null = null;

function TapClip({
  text,
  children,
  className,
  wrapClassName,
  strong = false,
  dismissLayer = false,
  watch,
  resetOn,
}: {
  text: string;
  children: React.ReactNode;
  className: string;
  wrapClassName: string;
  strong?: boolean;
  dismissLayer?: boolean;
  /** 바뀌면 말줄임을 다시 재요(보이는 글자 · 검색어 — 상자 폭은 그대로인데 글자 폭만 바뀌는 경우) */
  watch: readonly unknown[];
  /** 목록이 바뀌면(새로 불러옴 · 줄이 빠지거나 옮겨짐) 열린 말풍선을 닫아요(반박 리뷰 F6) */
  resetOn: readonly unknown[];
}) {
  const [textEl, setTextEl] = useState<HTMLElement | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; maxWidth: number } | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const tipId = useId();
  const shown = pos !== null && truncated;
  const watchKey = JSON.stringify(watch);
  const [seen, setSeen] = useState(resetOn);
  if (seen.length !== resetOn.length || seen.some((v, i) => v !== resetOn[i])) {
    setSeen(resetOn);
    if (pos) setPos(null);
  }

  // 상자 폭이 바뀌면(화면 회전 · 표 칸 폭) 말줄임 여부를 다시 재요 — 처음 observe 때도 한 번 불려요.
  // 상자 폭은 그대로인데 글자 폭만 바뀌는 경우(늦게 받은 글꼴 · 글자 · 검색 강조가 바뀜)도 다시 재요(반박 리뷰).
  // 말줄임이 풀리면 열린 말풍선도 닫아요 — 다시 잘려도 저절로 열리지 않게.
  useEffect(() => {
    if (!textEl) return;
    let alive = true;
    const measure = () => {
      if (!alive) return;
      // 1px 보다 덜 넘쳐도 「…」가 그려져요 — 소수점 폭으로 재요(UG-450 기획 17003)
      const cut = isTextTruncated(textEl);
      setTruncated(cut);
      if (!cut) setPos(null);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(textEl);
    document.fonts?.ready.then(measure).catch(() => {});
    return () => {
      alive = false;
      ro.disconnect();
    };
  }, [textEl, watchKey]);

  useEffect(() => {
    if (!shown) return;
    const close = () => setPos(null);
    openTapClip = { id: tipId, close };
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (wrapRef.current?.contains(target)) return;
      // 다른 말줄임 글자를 누름 — 여기서 닫지 않아요. 그 글자의 click 이 열리면서 이 말풍선을 닫아요(toggle → openTapClip).
      // 누르기 시작(pointerdown)에 화면을 바꾸면 아이패드가 이어지는 click 을 버릴 수 있어요(기획 17028 — 두 번 눌러야 했어요)
      if (target instanceof Element && target.closest(".tap-clip-button")) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    // 화면 · 표가 밀리면 말풍선이 글자에서 떨어져 보여요 — 닫아요
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("popstate", close);
    window.addEventListener("blur", close);
    return () => {
      if (openTapClip?.id === tipId) openTapClip = null;
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("popstate", close);
      window.removeEventListener("blur", close);
    };
  }, [shown, tipId]);

  /** 글자 바로 아래(화면 아래 끝이면 위)에 띄워요 — 폭은 감싼 상자 폭(좁으면 240)까지, 화면 밖으로 나가지 않게 */
  function toggle() {
    if (pos) return setPos(null);
    const wrap = wrapRef.current;
    const r = wrap?.getBoundingClientRect();
    if (!wrap || !r) return;
    // 다른 말풍선이 열려 있으면 닫고 이것을 열어요 — 한 번 눌러 바로 바뀌어요(기획 17028)
    if (openTapClip && openTapClip.id !== tipId) openTapClip.close();
    const margin = 8;
    const left = Math.max(margin, Math.min(r.left, window.innerWidth - margin - 240));
    const maxWidth = Math.max(Math.min(Math.max(r.width, 240), window.innerWidth - left - margin), 120);
    // 말풍선 높이는 대개 한두 줄(30~48) — 아래 자리가 모자라면 위로. 아주 긴 이름은 서너 줄이라 아래로 펴면 화면 밖으로 잘려요(UG-453 기획 17101) —
    // 같은 자리 · 폭의 보이지 않는 말풍선으로 실제 높이를 재서(재고 바로 떼요) 아래에 못 들어가고 위에 들어가면 위로
    const probe = document.createElement("span");
    probe.className = "tap-tip";
    probe.textContent = text;
    Object.assign(probe.style, { left: `${left}px`, top: "0", maxWidth: `${maxWidth}px`, visibility: "hidden" });
    wrap.append(probe);
    const need = probe.getBoundingClientRect().height + 4 + margin;
    probe.remove();
    setPos(
      tipOpensUp(window.innerHeight - r.bottom, r.top, need) ? { left, bottom: window.innerHeight - r.top + 4, maxWidth } : { left, top: r.bottom + 4, maxWidth },
    );
  }

  const Tag = strong ? "strong" : "span";
  const inner = (
    <Tag ref={setTextEl} className={className}>
      {children}
    </Tag>
  );
  return (
    <span className={`tap-clip ${wrapClassName}`} ref={wrapRef}>
      {truncated ? (
        <button
          type="button"
          className="tap-clip-button"
          // 마우스로는 올리면 전체 글자(UG-450 기획 17007) — 눌러도 말풍선이 떠요
          title={text}
          aria-describedby={shown ? tipId : undefined}
          onClick={toggle}
          // Tab 으로 다른 곳에 가면 닫아요(반박 리뷰)
          onBlur={(e) => {
            if (!wrapRef.current?.contains(e.relatedTarget as Node | null)) setPos(null);
          }}
        >
          {inner}
        </button>
      ) : (
        inner
      )}
      {shown && dismissLayer && (
        // 닫기만 하는 투명한 막(UG-453 기획 7). 누르는 동안 초점이 옮겨 가지 않게(mousedown) — 초점이 빠지면 onBlur 가 말풍선과 막을
        // click 전에 지워, 그 click 이 아래 버튼(「메일 재발송」 · ⋮)으로 가요. 막 아래 다른 말줄임 글자는 한 번에 그 말풍선으로(기획 17028)
        <span
          className="tap-tip-dismiss"
          aria-hidden="true"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            setPos(null);
            const under = document
              .elementsFromPoint(e.clientX, e.clientY)
              .find((el) => !wrapRef.current?.contains(el))
              ?.closest<HTMLElement>(".tap-clip-button");
            under?.click();
          }}
        />
      )}
      {shown && (
        <span role="tooltip" id={tipId} className="tap-tip" style={{ left: pos.left, top: pos.top, bottom: pos.bottom, maxWidth: pos.maxWidth }}>
          {text}
        </span>
      )}
    </span>
  );
}

/**
 * PC 표의 고객 칸(UG-450 기획 17007) — 위 회사명(13 · 본문색), 아래 고객 이메일 + 「 · 영문」(13 · 회색).
 * 회사명 · 이메일은 따로 말줄임 — 마우스를 올리거나(title) 눌러서(말풍선 — 아이패드, 기획 17020) 전체를 봐요(TapClip).
 * 이메일이 길어도 이메일만 줄고 「 · 영문」은 늘 보여요.
 * 하나만 남았으면 그 한 줄, 둘 다 비었으면 발급 취소 · 해지됨은 「삭제됨」(13 · 회색), 그 밖은 「—」.
 * language 가 없으면(「작성 중」 명함에서 고르지 않음) 언어를 붙이지 않아요.
 */
function CustomerCell({
  company,
  email,
  language,
  gone,
  query,
  resetOn,
}: {
  company: string | null;
  email: string | null;
  language: MailLanguage | null;
  gone: boolean;
  query: string;
  resetOn: readonly unknown[];
}) {
  if (!company && !email) return gone ? <span className="gone-company">삭제됨</span> : <span className="dash">—</span>;
  return (
    <span className="customer">
      {company && (
        <TapClip text={company} className="customer-company" wrapClassName="customer-line" watch={[company, query]} resetOn={resetOn}>
          <Highlight text={company} query={query} />
        </TapClip>
      )}
      {email && (
        <span className="customer-email">
          <TapClip text={email} className="customer-email-addr" wrapClassName="customer-email-clip" watch={[email, query]} resetOn={resetOn}>
            <Highlight text={email} query={query} />
          </TapClip>
          {language && <span className="customer-email-lang">{` · ${LANGUAGE_TAG[language]}`}</span>}
        </span>
      )}
    </span>
  );
}

/** 회사명 칸 — 발급 취소 · 해지됨이라 회사명이 비워졌으면 「삭제됨」, 값이 남은 예전 줄은 그대로(UG-450 기획 16965) */
function CompanyCell({ account, query }: { account: Account; query: string }) {
  if (account.company) return <Highlight text={account.company} query={query} />;
  return isGone(account) ? <span className="gone-company">삭제됨</span> : <span className="dash">—</span>;
}

/**
 * 휴대폰 발급 취소 · 해지됨 카드의 첫 줄 왼쪽 — 회사명(또는 「삭제됨」)이 오른쪽 상태 배지를 뺀 폭을 다 써요(UG-450 기획 16995 · UG-463 기획 17235).
 * 배지는 줄지 않고(.card-status = flex: none) 회사명만 말줄임 — 말줄임되면 눌러서 전체 이름을 작은 말풍선으로 봐요(TapClip — PC 표의 회사명 · 이메일과 같은 말풍선).
 */
function GoneCardCompany({ account, query, resetOn }: { account: Account; query: string; resetOn: readonly unknown[] }) {
  return (
    <TapClip
      text={account.company || "삭제됨"}
      className="card-company card-company-line"
      wrapClassName="card-company-full"
      strong
      // 휴대폰 카드: 말풍선이 이웃 카드 버튼을 덮어요 — 닫는 누름이 버튼으로 가지 않게(UG-453 기획 7)
      dismissLayer
      watch={[account.company, query]}
      resetOn={resetOn}
    >
      <CompanyCell account={account} query={query} />
    </TapClip>
  );
}

/**
 * 휴대폰 발급 취소 · 해지됨 카드의 둘째 줄 — 처리 기록 「11.04 14:51 · staff1」(UG-463 기획 17235). 13 · 회색, 한 줄 고정 —
 * 직원 이름이 길면 말줄임(줄 높이는 다른 카드 둘째 줄과 같은 20). 기록이 없으면(예전 줄) 「—」 — 카드가 한 줄로 줄지 않게.
 */
function GoneCardRecord({ account }: { account: Account }) {
  const record = goneRecord(account);
  return (
    <span className="gone-record card-gone-record" title={record || undefined}>
      {record || "—"}
    </span>
  );
}

/**
 * 휴대폰 카드 둘째 줄의 고객 이메일(UG-453 기획 17101) — 바로 뒤에 「메일 재발송」 · 「이어서 만들기」가 붙어요.
 * 길면 이메일만 한 줄 말줄임(버튼은 줄지 않아요), 눌러서 전체 주소를 말풍선으로 봐요(회사명과 같은 TapClip). 없으면 「—」.
 */
function CardEmail({ email, query, resetOn }: { email: string | null; query: string; resetOn: readonly unknown[] }) {
  if (!email) {
    return (
      <span className="card-email">
        <span className="dash">—</span>
      </span>
    );
  }
  return (
    <TapClip text={email} className="card-email card-email-line" wrapClassName="card-email-clip" dismissLayer watch={[email, query]} resetOn={resetOn}>
      <Highlight text={email} query={query} />
    </TapClip>
  );
}

/** 상태 글자(메일 실패 까닭 포함) — 목록 줄과 확인 창이 같은 말을 써요. */
const statusText = (a: Account) =>
  a.status === "pending" && a.mailFailureReason ? MAIL_FAILURE_LABEL[a.mailFailureReason] : STATUS_LABEL[a.status];

// note = 알림 아래 줄(UG-455 기획 17099-5 — 「명함 사진은 저장하지 못했습니다」)
type ToastState = { title: string; detail: string; tone?: "error" } | null;

/** 계정을 만든 뒤 목록에 알릴 것(UG-455 기획 17099-5) — photoNotSaved = 서버가 명함 사진을 받지 않았거나 저장하지 못함 */
type CreatedNotice = { photoNotSaved?: boolean };

/**
 * 계정 만들기 창을 닫을 때 「작성 중」으로 남길 것(UG-431 기획 16864). id 가 있으면 이어서 만든 그 명함을 갱신해요.
 * remove = 이어서 만든 명함의 칸 · 사진을 모두 비우고 닫음 — 남길 것이 없어 지워요.
 */
type DraftKeep =
  | {
      id: string | null;
      input: CardDraftInput;
      remove?: false;
      /** 이 창의 자동 저장이 만든 명함을 그사이 다른 직원이 지웠으면(not_found) 이 값으로 한 번 새로 남겨요(반박 리뷰 F5) */
      recreate?: CardDraftInput;
    }
  | { id: string; remove: true };

/** 「작성 중」 상태 글자(목록 줄 · 휴대폰 카드) */
const DRAFT_LABEL = "작성 중";
/** 「작성 중」 줄의 회사명 칸(목록 줄 · 휴대폰 카드 제목) — 회사명이 비면 이름, 둘 다 없으면 ""(「—」). PC 목록에 이름 열이 없어 알아볼 값이 이것뿐이에요(UG-431 기획 16888) */
const draftTitle = (d: CardDraft) => d.company || d.name || "";
// 창은 이미 닫혔으므로 목록 위 알림으로(기존 완료 알림과 같은 자리 · 모양, 아이콘만 오류)
const DRAFT_SAVE_FAILED = "작성 중인 명함을 저장하지 못했습니다";
// 닫을 때 「작성 중」 저장이 연결 · 서버 문제로 실패 — 창에 남아 [다시 시도] [그래도 닫기](UG-451 기획 16991)
const DRAFT_KEEP_FAILED = "작성 중인 명함을 저장하지 못했습니다.";
const DRAFTS_LOAD_FAILED = "작성 중인 명함을 불러오지 못했습니다.";
const DRAFT_GONE = { title: "작성 중인 명함이 이미 지워졌습니다", detail: "다른 직원이 계정을 만들었거나 지웠습니다" };

const CHECK_FAILED = "이메일을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.";
// 이메일 칸 값이 명함에서 잘렸거나 잘못 읽었을 수 있는 주소와 똑같을 때(UG-451 반박 리뷰 F2) — 고칠 때까지 보내지 않아요
// 「고쳐 주세요」는 빼요(기획 17072-3) — 맞는 주소면 고치지 않고 아래 「명함과 같은 주소예요」로 확인해요
const SUSPECT_EMAIL = "명함에서 잘못 읽었을 수 있는 주소입니다. 명함과 한 글자씩 비교해 주세요.";
// 경고 바로 아래 버튼 — 명함과 견줘 맞는 주소면 직원이 그 값을 확인해 보내요(UG-451 기획 17030)
const SUSPECT_CONFIRM = "명함과 같은 주소예요";
// 보내기를 눌렀는데 이메일 확인이 네트워크 · 서버 문제(응답 없음 · 5xx · 시간 초과)로 실패 — 버튼 위에 남겨요(UG-451 기획 16991)
const NETWORK_FAILED = "연결이 불안정해 확인하지 못했습니다. 다시 눌러 주세요.";
// 계정 만들기 요청이 네트워크 · 서버 문제로 실패 — 서버가 만들었는지 알 수 없어요. 다시 누르면 이미 만든 계정이면 「이미 만든 계정입니다」로 보여요.
const CREATE_NETWORK_FAILED = "연결이 불안정해 계정을 만들었는지 확인하지 못했습니다. 다시 눌러 주세요.";

/** 네트워크 · 서버 문제(응답 없음 · 시간 초과 = 0, 5xx)인지 — 다시 누르면 될 수 있는 실패 */
const isNetworkError = (e: unknown) => !(e instanceof ApiError) || e.status === 0 || e.status >= 500;
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

/**
 * 새 명함의 저장을 다시 시도하기 전에, 앞 저장(응답만 잃음 — 닫을 때 저장 · 자동 저장)이 서버에 남았는지 찾아요.
 * 규칙은 draft-session.ts resolveLostDraft — 이 창을 연 뒤 생긴 내 명함 · 네 칸 · 사진 유무(사진이 있으면 사진까지)가 같고 딱 하나일 때만.
 * 목록은 검색어 없이 최근 100장. 직원 이메일을 모르면 찾지 않아요. background = 자동 저장(로그인이 끊겨도 로그인 화면으로 보내지 않음)
 */
function findLostDraft(lost: LostSaves, staffEmail: string | null | undefined, background = false): Promise<LostLookup> {
  const opts = { background };
  return resolveLostDraft({
    lost,
    me: staffEmail?.trim().toLowerCase() ?? "",
    list: async () => (await listCardDrafts("", opts)).items,
    photoOf: async (id) => {
      const r = await getCardDraft(id, opts);
      if (r.ok) return r.detail.photo;
      if (r.reason === "not_found") return null;
      throw new Error("photo");
    },
  });
}

/** 자동 저장 한 번의 결과 — sent = 실제로 남긴 값(사진 · 칸을 빼고 다시 남겼을 수 있어요), photoDropped = 사진을 받지 않아 빼고 남김 */
type AutosaveOutcome = { res: CardDraftSaveResult; sent: CardDraftInput; photoDropped: boolean };
/** 자동 저장 한 번에 남길 것 — recreate = 이 창이 만든 명함이 없어졌을 때 새로 남길 값(F5) */
type AutosaveItem = { id: string | null; input: CardDraftInput; recreate?: CardDraftInput };

/** 자동 저장 — 입력이 멈춘 뒤 기다릴 시간(UG-451 기획 17009) */
const AUTOSAVE_DELAY = 2000;
/**
 * 응답을 잃은 저장을 찾을 때 후보로 볼 명함의 시작 시각 — 창을 연 시각 − 시계 오차(F2). 창을 여는 효과 안에서만 불러요
 * (함수로 둔 까닭: React 컴파일러 검사가 효과 안의 Date.now 를 그리는 중으로 잘못 보는 일이 있어요)
 */
const lostSince = () => Date.now() - LOST_CLOCK_SKEW_MS;

/**
 * 같은 명함의 저장 · 지우기는 차례대로 — 앞 저장(닫을 때 저장 · 자동 저장)이 끝난 뒤에 해요(차례가 바뀌어 옛 값이 남거나 지운 명함이 되살아나지 않게).
 * id 가 없는 새 명함은 줄 세울 번호가 없어 바로 해요. 실패(예외)는 fallback 으로.
 */
function queueDraftSave<T>(saves: Map<string, Promise<void>>, id: string | null, task: () => Promise<T>, fallback: T): Promise<T> {
  if (!id) return task().catch(() => fallback);
  const result = (saves.get(id) ?? Promise.resolve()).then(task).catch(() => fallback);
  const saving: Promise<void> = result
    .then(() => undefined)
    .finally(() => {
      if (saves.get(id) === saving) saves.delete(id);
    });
  saves.set(id, saving);
  return result;
}

/** 거르기 조건을 주소에서 읽어요(useSearchParams) — 정적 내보내기라 Suspense 안에서 그려요(UG-458) */
export default function AccountsPage() {
  return (
    <Suspense fallback={null}>
      <AccountsScreen />
    </Suspense>
  );
}

function AccountsScreen() {
  const router = useRouter();
  const staff = useStaff();
  // 「작성 중」 새 명함을 다시 저장할 때 내가 만든 명함만 찾으려고(createdBy 와 같은 직원 이메일)
  const staffEmail = staff?.email ?? null;

  const [rows, setRows] = useState<Account[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<AccountSummary | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  // 검색 칸 값(keyword · status)과 실제로 조회한 조건(applied)을 나눠요 — 검색을 눌러야 목록이 바뀌어요.
  const [keyword, setKeyword] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<AccountStatusFilter>("all");
  const [version, setVersion] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  // 조회한 조건은 주소(?status=…&keyword=…)에 둬요(UG-458 기획 6) — 새로 고침 · 계정 해지에서 뒤로 가기에도 고른 카드 · 검색어가 남아요.
  // 주소가 밖에서 바뀌면(처음 열 때 · 뒤로 가기 · 위쪽 메뉴) 검색 칸 · 선택 상자도 맞춰요. 옛 해지 거르기 주소는 「전체」로 열어요
  const { value: applied, replace: replaceApplied } = useUrlQuery(parseAccountsQuery, serializeAccountsQuery, (q: AccountsQuery) => {
    setKeyword(q.keyword);
    setStatus(q.status);
    setPage(1);
  });
  // 계정 만들기 창. draft = 「작성 중」 명함을 이어서 만들 때 서버에서 받은 것(칩 · 사진 포함)
  const [creating, setCreating] = useState<{ draft: CardDraftDetail | null } | null>(null);
  // 「작성 중」 명함 목록(UG-431 기획 16864) — 그때의 조건(applied)에만 붙여요. 요약 카드 · CSV · 페이지 수에는 섞지 않아요.
  // total = 서버의 전체 장 수(한 번에 100장까지만 받아요)
  const [draftList, setDraftList] = useState<{ for: AccountsQuery; items: CardDraft[]; total: number } | null>(null);
  // 불러오기 실패 안내도 그때의 조건에만 — 상태 필터를 바꾸면(「작성 중」 해당 없음) 사라져요
  const [draftsErrorFor, setDraftsErrorFor] = useState<AccountsQuery | null>(null);
  // 이어서 만들기로 여는 중인 명함(서버에서 칩 · 사진을 받는 동안 버튼을 잠가요)
  const [resumingId, setResumingId] = useState<string | null>(null);
  const [draftDeleteTarget, setDraftDeleteTarget] = useState<CardDraft | null>(null);
  // 닫을 때 · 자동으로 시작한 저장(명함 번호별) — 끝나기 전에 같은 명함을 다시 열거나 지우면 저장이 끝난 뒤에 해요
  const draftSaves = useRef(new Map<string, Promise<void>>());
  const [resendTarget, setResendTarget] = useState<Account | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Account | null>(null);
  // 목록 ⋮ 「명함 보기」(UG-455) — 보기 화면을 연 동안만 사진(data URL)을 둬요. src 가 null 이면 받는 중. 닫으면 버려요(기기에 남기지 않아요)
  const [cardPhoto, setCardPhoto] = useState<{ id: string; src: string | null; email: string } | null>(null);
  // 받는 중에 닫았거나 다른 줄을 열었으면 늦게 온 응답을 버리려고
  const cardPhotoReq = useRef(0);
  const [toast, setToast] = useState<ToastState>(null);
  // 계정은 만들었는데 명함 사진만 저장하지 못함 — 완료 알림 옆에 빨간 알림으로 따로 띄워요(UG-455 기획 17120-1).
  // 0 = 없음, 1 이상 = 실패할 때마다 늘려 알림을 새로 띄우는 키 — 떠 있는 동안 또 실패해도 낭독기가 다시 읽어요(기획 17124 반박 리뷰 L1)
  const [photoToast, setPhotoToast] = useState(0);
  const showPhotoToast = useCallback(() => setPhotoToast((n) => n + 1), []);
  const [freshId, setFreshId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  // 내려받기 실패 안내는 그때의 조건(applied)에만 붙여요 — 검색 조건을 바꾸면 저절로 사라져요.
  const [exportError, setExportError] = useState<{ for: AccountsQuery; text: string } | null>(null);

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
  /** 조건을 걸어요 — 주소가 바뀌면 목록을 새로 받고, 같은 조건이면(검색을 다시 누름 등) 그대로 다시 불러와요 */
  const apply = useCallback(
    (next: AccountsQuery) => {
      if (!replaceApplied(next)) reload();
    },
    [replaceApplied, reload],
  );

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
  // 「해지 N개 보기」의 N — 요약을 못 받았으면 0(링크를 숨겨요)
  const salesClosures = summary?.salesClosures ?? 0;

  const filtered = applied.keyword !== "" || applied.status !== "all";
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, pageCount);
  const visible = rows;
  const drafts = applied.status === "all" && current === 1 && draftList?.for === applied ? draftList.items : [];
  // 「작성 중」이 100장을 넘으면 최근 100장만 받아요 — 목록 위에 한 줄
  const draftsCut = drafts.length > 0 && draftList !== null && draftList.total > draftList.items.length;
  const draftsError = draftsErrorFor === applied;
  // 표 줄의 ⋮ 메뉴는 목록(계정 줄 · 「작성 중」 줄)이 바뀌면 닫아요
  const listStamp = [rows, draftList] as const;
  // 다른 창이 열려 있는지 — 이어서 만들기 응답이 늦게 와도 창을 겹쳐 열지 않게(응답을 버려요)
  const modalOpen = !!creating || !!resendTarget || !!cancelTarget || !!draftDeleteTarget || !!cardPhoto;
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
    // 터치 기기: 키보드의 검색 · Enter 를 누르면 칸을 빠져 키보드를 내려요 — 결과 목록이 가리지 않게(UG-453 기획 3). PC 는 칸에 그대로
    if (isTouchPrimary()) searchRef.current?.blur();
    setPage(1);
    apply({ keyword, status });
  }

  // 검색어 지우기(✕): 이미 그 검색어로 조회한 상태면 목록도 바로 되돌려요.
  function clearKeyword() {
    setKeyword("");
    searchRef.current?.focus();
    if (applied.keyword) {
      setPage(1);
      apply({ keyword: "", status: applied.status });
    }
  }

  // 휴대폰 상태 칩: 누르면 바로 걸러요(휴대폰엔 검색 버튼이 없어서).
  function pickStatus(v: AccountStatusFilter) {
    setStatus(v);
    setPage(1);
    apply({ keyword: keyword.trim(), status: v });
  }

  // PC 요약 카드(UG-450 기획 16957): 칩과 같이 바로 걸러요. 이미 걸린 카드를 다시 누르면 목록은 그대로 — 선택 상자만 맞춰요.
  // 선택을 푸는 길은 「전체」 카드 · [초기화]뿐이에요.
  function pickCard(v: AccountStatusFilter) {
    if (v === applied.status) return setStatus(v);
    pickStatus(v);
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
    apply(ACCOUNTS_DEFAULT);
  }

  /**
   * 창을 닫을 때 「작성 중」으로 남겨요(UG-431 기획 16864). 창은 저장이 끝날 때까지 열려 있어요(UG-451 기획 16991).
   * 결과: true = 끝남(남김 · 지움 · 다시 해도 안 되는 실패는 알림으로 안내) → 창을 닫아요,
   * false = 연결 · 서버 문제 등으로 남기지 못함 → 창이 「작성 중인 명함을 저장하지 못했습니다」와 [다시 시도] [그래도 닫기]를 보여 줘요.
   * 같은 명함의 앞 저장(자동 저장 포함)이 아직이면 그 뒤에 해요(차례가 바뀌어 옛 값이 남지 않게).
   * 이어서 만든 명함이 그사이 없어졌으면(MGMT-109 — 계정을 만들었거나 다른 직원이 지움) 새로 남기지 않고 목록만 새로 고쳐요.
   * lost = 응답을 잃은 새 명함 저장(앞서 닫다 실패 · 자동 저장 실패) — 서버에 남았으면 그 명함에 이어 써요(중복 「작성 중」 방지)
   */
  const keepDraft = useCallback(
    (keep: DraftKeep, lost: LostSaves): Promise<boolean> => {
      const run = async (): Promise<boolean> => {
        if (keep.remove) {
          // 칸 · 사진을 다 비우고 닫음 — 남길 것이 없어 지워요
          if (!(await deleteCardDraft(keep.id)))
            setToast({ tone: "error", title: "작성 중인 명함을 지우지 못했습니다", detail: "목록에서 [지우기]로 다시 지워 주세요" });
          reload();
          return true;
        }
        // 새 명함(번호 없음)을 다시 시도할 때: 앞 저장이 서버에는 남고 응답만 잃었을 수 있어요 — 같은 값의 최근 명함이 있으면 그 명함에 이어 써요
        let id = keep.id;
        if (!id) {
          const found = await findLostDraft(lost, staffEmail);
          if (found.kind === "found") id = found.id;
        }
        let input = keep.input;
        let res = await saveCardDraft(id, input);
        // 찾은 명함이 그사이 없어졌으면(계정을 만들었거나 지움) 새로 남겨요.
        // 이 창의 자동 저장이 만든 명함을 다른 직원이 지웠으면 입력이 사라지지 않게 한 번 새로 남겨요(반박 리뷰 F5) — 이어서 만든 원래 명함은 되살리지 않아요
        if (id && !res.ok && res.reason === "not_found" && (!keep.id || keep.recreate)) {
          id = null;
          input = keep.recreate ?? keep.input;
          res = await saveCardDraft(null, input);
        }
        // 칸 값을 서버가 받지 않음(PJ-101) — 칸은 상한 · 제어 문자를 이미 정리해 보냈어요. 그래도면 네 칸 없이 사진 · 칩만 한 번 더
        let kept: string | null = null;
        if (!res.ok && res.reason === "invalid") {
          const lite = withoutFields(input);
          if (lite) {
            res = await saveCardDraft(id, lite);
            const hasPhoto = !!lite.photo || !!lite.keepPhoto;
            kept = hasPhoto && lite.chips ? "명함 사진과 읽은 줄만 남겼습니다" : hasPhoto ? "명함 사진만 남겼습니다" : "읽은 줄만 남겼습니다";
          }
        }
        if (res.ok) {
          setFreshId(`draft:${res.draft.id}`);
          if (kept) setToast({ tone: "error", title: "작성 중인 명함의 입력값을 남기지 못했습니다", detail: kept });
        } else if (res.reason === "not_found") setToast({ tone: "error", ...DRAFT_GONE });
        // 연결 · 서버 문제(오프라인 등) — 창을 닫지 않고 다시 시도하게 해요(조용히 사라지지 않게)
        else if (res.reason === "failed" || res.reason === "session") return false;
        else
          setToast({
            tone: "error",
            title: DRAFT_SAVE_FAILED,
            detail: res.reason === "photo" ? "명함 사진이 너무 크거나 형식이 맞지 않아 목록에 남지 않았습니다" : "명함과 입력한 값이 목록에 남지 않았습니다",
          });
        reload();
        return true;
      };
      return queueDraftSave(draftSaves.current, keep.id, run, false);
    },
    [reload, staffEmail],
  );

  /**
   * 「작성 중」 자동 저장(UG-451 기획 17009) — 창이 열려 있는 동안 명함 읽기 직후 · 입력이 멈출 때. 알림 · 목록 새로 고침 없이 결과만 돌려줘요.
   * 같은 명함의 앞 저장 뒤에 줄 서요. 새 명함인데 앞 저장의 응답을 잃었으면(lost) 서버에 남은 그 명함을 찾아 이어 써요.
   * 뒤쪽 요청이라 로그인이 끊겨도 로그인 화면으로 보내지 않아요(session — 자동 저장만 꺼져요, 반박 리뷰 F7).
   * 닫을 때 저장과 같은 대체(F7): 사진을 받지 않으면(너무 큼 · 형식) 사진 없이, 칸 값을 받지 않으면(PJ-101) 칸 없이 한 번 더.
   */
  const autosaveDraft = useCallback(
    (id: string | null, input: CardDraftInput, lost: LostSaves): Promise<AutosaveOutcome> =>
      queueDraftSave<AutosaveOutcome>(
        draftSaves.current,
        id,
        async () => {
          const opts = { background: true };
          let target = id;
          if (!target) {
            const found = await findLostDraft(lost, staffEmail, true);
            if (found.kind === "found") target = found.id;
          }
          let sent = input;
          let photoDropped = false;
          let res = await saveCardDraft(target, sent, opts);
          // 찾은 명함이 그사이 없어졌으면(계정을 만들었거나 지움) 새로 남겨요 — 처음부터 번호가 있던 명함은 여기서 되살리지 않아요(창이 정해요)
          if (!id && target && !res.ok && res.reason === "not_found") {
            target = null;
            res = await saveCardDraft(null, sent, opts);
          }
          if (!res.ok && res.reason === "photo" && sent.photo) {
            sent = withoutPhoto(sent);
            photoDropped = true;
            res = await saveCardDraft(target, sent, opts);
          }
          if (!res.ok && res.reason === "invalid") {
            const lite = withoutFields(sent);
            if (lite) {
              sent = lite;
              res = await saveCardDraft(target, sent, opts);
            }
          }
          return { res, sent, photoDropped };
        },
        { res: { ok: false, reason: "failed" }, sent: input, photoDropped: false },
      ),
    [staffEmail],
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
      // 뒤쪽 정리라 로그인이 끊겨도 로그인 화면으로 보내지 않아요(재검토 R5 — 자동 저장 뒤 지우기도 이 길로 와요)
      void deleteCardDraft(id, { background: true }).then(() => reload());
    },
    [reload],
  );

  const afterDraftDeleted = useCallback(() => {
    setDraftDeleteTarget(null);
    reload();
    setToast({ title: "작성 중인 명함을 지웠습니다", detail: "명함 사진과 입력한 값을 지웠습니다" });
  }, [reload]);

  /** 목록 ⋮ 「명함 보기」 — 보기 화면을 「불러오는 중」으로 먼저 열고 서버에서 사진을 받아요(UG-455) */
  const openCardPhoto = useCallback(
    async (account: Account) => {
      const req = ++cardPhotoReq.current;
      // 보기 화면 위쪽에 그 줄의 이메일을 함께 보여 줘요(기획 17099-2)
      setCardPhoto({ id: account.id, src: null, email: account.email });
      const res = await getAccountCardPhoto(account.id);
      if (req !== cardPhotoReq.current) return; // 그사이 닫았거나 다른 줄을 열었어요
      if (res.ok) return setCardPhoto({ id: account.id, src: res.src, email: account.email });
      setCardPhoto(null);
      if (res.reason === "not_found") {
        // 그사이 지워졌어요(고객 요청 삭제 · 해지 등) — 목록을 새로 받아 메뉴도 맞춰요
        reload();
        setToast({ tone: "error", title: CARD_PHOTO_TEXT.notFound, detail: CARD_PHOTO_TEXT.notFoundDetail });
      } else setToast({ tone: "error", title: CARD_PHOTO_TEXT.loadFailed, detail: CARD_PHOTO_TEXT.loadFailedDetail });
    },
    [reload],
  );

  const closeCardPhoto = useCallback(() => {
    cardPhotoReq.current++;
    setCardPhoto(null);
  }, []);

  /** 새로 만든 계정이 보이도록 조건을 풀고 첫 페이지를 다시 불러와 그 줄을 잠깐 표시해요. */
  const showCreated = useCallback(
    (account: Account) => {
      setKeyword("");
      setStatus("all");
      setPage(1);
      apply(ACCOUNTS_DEFAULT);
      setFreshId(account.id);
    },
    [apply],
  );

  const afterSend = useCallback(
    (result: { kind: "created"; account: Account; photoNotSaved?: boolean } | { kind: "resent" }) => {
      setCreating(null);
      setResendTarget(null);
      if (result.kind === "created") {
        showCreated(result.account);
        setToast({ title: "계정을 만들었습니다", detail: "안내 메일 발송을 요청했습니다" });
        // 서버가 명함 사진을 받지 않았거나 저장하지 못했으면 빨간 알림을 따로 띄워요(기획 17120-1) — 정책상 남기지 않은 경우 · 사진 없이 만든 경우는 없음.
        // 이미 떠 있는 알림은 직원이 닫을 때까지 남아요(기획 17124) — 다음 계정이 잘 만들어져도 내리지 않아요
        if (result.photoNotSaved === true) showPhotoToast();
      } else {
        reload();
        setToast({ title: "안내 메일을 다시 보냈습니다", detail: "새 비밀번호 설정 링크로 발송을 요청했습니다" });
      }
    },
    [reload, showCreated, showPhotoToast],
  );

  /** 계정은 만들었지만 메일은 못 보냄 — 창은 그대로(결과 · 주소 고치기). 명함 사진을 저장하지 못했으면 그것만 따로 알려요(기획 17099-5) */
  const afterMailFailed = useCallback(
    (account: Account, notice?: CreatedNotice) => {
      showCreated(account);
      if (notice?.photoNotSaved === true) showPhotoToast();
    },
    [showCreated, showPhotoToast],
  );

  useEffect(() => {
    if (!freshId) return;
    const t = setTimeout(() => setFreshId(null), 4000);
    return () => clearTimeout(t);
  }, [freshId]);

  const clearToast = useCallback(() => setToast(null), []);
  const clearPhotoToast = useCallback(() => setPhotoToast(0), []);

  /** 계정 만들기 창에서 비밀번호 재설정 메일을 대신 보냈어요(UG-421 D2 · MD2) — 창을 닫고 완료 알림 */
  const afterResetSent = useCallback(
    (result: Extract<PasswordResetResult, { ok: true }>) => {
      setCreating(null);
      reload();
      setToast({
        title: "비밀번호 재설정 메일을 보냈습니다.",
        // 초대를 아직 수락하지 않은 계정은 서버가 링크 대신 초대 메일 확인 안내를 보내요
        detail: result.invitationPending ? "초대를 수락하지 않은 계정이라 초대 메일 확인 안내를 보냈습니다" : "링크는 24시간 동안 한 번만 쓸 수 있습니다",
      });
    },
    [reload],
  );

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

  /**
   * 「계정 만들기」 — PC · 아이패드는 제목 줄 오른쪽, 휴대폰(≤ 640)은 검색 칸 오른쪽(UG-458 기획 17191).
   * 휴대폰은 탭 줄과 같은 말인 제목 줄을 빼서 두 자리에 그려 두고 화면 폭에 맞는 하나만 보여요(globals.css — 다른 하나는 display: none 이라 낭독기 · 탭 이동에서도 빠져요).
   */
  const createButton = (extraClass: string) => (
    <button
      type="button"
      className={`btn btn-dark btn-sm${extraClass}`}
      data-twin="create-account" // 창을 닫을 때 숨은 쪽이 연 버튼이면 보이는 짝으로 초점(Dialog)
      onClick={() => setCreating({ draft: null })}
      // 이어서 만들기 응답을 기다리는 동안은 새 창을 열지 않아요(두 창이 겹치지 않게)
      disabled={resumingId !== null}
    >
      계정 만들기
    </button>
  );

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
            {createButton("")}
          </div>
        </div>

        {/* 요약 카드 = 상태 필터(UG-450 기획 16957) — 휴대폰 칩과 같게 누르면 바로 걸러요. 숫자는 검색 · 필터와 무관한 전체 기준 */}
        <div className="overview" role="group" aria-label="상태 필터">
          <Metric
            id="all"
            label="전체"
            value={metrics?.total}
            sub={metrics ? `이번 달 ${metrics.thisMonth}개` : "이번 달 —"}
            pressed={applied.status === "all"}
            onPress={pickCard}
          />
          <Metric
            id="pending"
            label={STATUS_LABEL.pending}
            value={metrics?.pending}
            sub="고객이 아직 로그인하지 않음"
            pressed={applied.status === "pending"}
            onPress={pickCard}
          />
          <Metric id="in_use" label="사용 중" value={metrics?.inUse} sub="고객이 콘솔에 로그인함" pressed={applied.status === "in_use"} onPress={pickCard} />
          <Metric
            id="cancelled"
            label="발급 취소"
            value={metrics?.cancelled}
            sub="계정 · 데모 프로젝트 삭제됨"
            pressed={applied.status === "cancelled"}
            onPress={pickCard}
          />
          {/* 「해지」 카드는 없어요(UG-458 기획 1) — 해지는 목록 위 「해지 N개 보기」로 계정 해지 화면에서 봐요 */}
        </div>

        <form className="toolbar" onSubmit={onSearch} role="search">
          <label className="search">
            <IcSearch size={16} className="search-icon" />
            <span className="visually-hidden">검색어</span>
            <input
              ref={searchRef}
              type="search"
              enterKeyHint="search"
              // 회사명 · 이메일 검색이라 첫 글자 대문자 · 자동 고침 · 맞춤법 밑줄을 꺼요(UG-453 기획 3)
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => {
                // Esc 도 ✕ 와 같이: 글자만 지우지 않고 걸러진 목록도 되돌려요.
                if (e.key === "Escape" && keyword) {
                  e.preventDefault();
                  clearKeyword();
                }
              }}
              placeholder="회사명, 고객 이메일 검색"
            />
            {keyword && (
              <button type="button" className="search-clear" onClick={clearKeyword} aria-label="검색어 지우기">
                <IcInputClose size={18} />
              </button>
            )}
          </label>
          {/* 휴대폰: 「계정 만들기」는 검색 칸 오른쪽(UG-458 기획 17191 — 제목 줄을 뺐어요). PC · 아이패드는 숨기고 위 제목 줄의 것을 써요 */}
          {createButton(" search-row-action")}
          <PopupSelect<AccountStatusFilter>
            className="select"
            label="상태"
            value={status}
            onChange={setStatus}
            options={[
              // 요약 카드와 같은 차례(UG-450 기획 16957). 해지 거르기는 없어요(UG-458 기획 1)
              { value: "all", label: "상태 전체" },
              { value: "pending", label: STATUS_LABEL.pending },
              { value: "in_use", label: "사용 중" },
              { value: "cancelled", label: "발급 취소" },
            ]}
          />
          {/* 검정은 위쪽 「계정 만들기」 하나만 — 검색은 초기화와 같은 테두리 버튼(Enter 로도 검색) */}
          <button type="submit" className="btn btn-outline btn-sm">
            검색
          </button>
          <button type="button" className="btn btn-outline btn-sm" onClick={onReset}>
            초기화
          </button>
          {/* 휴대폰: 상태 칩(개수 포함) — PC 는 위 선택 상자. 넘치면 오른쪽 끝을 흐리게(StatusChips) */}
          <StatusChips label="상태 필터">
            {(
              [
                ["all", "전체", metrics?.total],
                ["pending", STATUS_LABEL.pending, metrics?.pending],
                ["in_use", "사용 중", metrics?.inUse],
                ["cancelled", "발급 취소", metrics?.cancelled],
                // 「해지」 칩은 없어요(UG-458 기획 1) — 「해지 N개 보기」로
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
          </StatusChips>
          {/* 목록을 받지 못했으면(처음 불러오는 중 포함) 「총 N개」를 가려요 — 요약 칩은 「전체 42」인데 목록 위가 「총 0개」로 읽혔어요(UG-451 기획 17005).
              자리는 남겨(visibility) 옆 안내 · 아래 목록이 움직이지 않게 해요. 다시 받으면 보여요. */}
          <span className={`count${loaded && !loadError ? "" : " is-hidden"}`} aria-hidden={loaded && !loadError ? undefined : true}>
            총 {total}개
            {/* 「· 해지 N개 보기」(UG-458 기획 4) — N 은 요약(검색 · 거르기와 무관한 전체 기준)의 영업 발급 해지(철회 제외). 0 이면 숨겨요.
                계정 해지 화면을 영업 발급 · 철회 제외로 열어 줄 수가 N 과 같아요. 보통 이동(뒤로 가기로 이 화면 · 조건으로 돌아와요) */}
            {salesClosures > 0 && (
              <>
                {" · "}
                <Link className="count-link" href={SALES_CLOSURES_HREF}>
                  해지 {salesClosures}개 보기
                </Link>
              </>
            )}
          </span>
          {draftsCut && <span className="help">작성 중인 명함이 많아 최근 100개만 보입니다.</span>}
        </form>

        {/* 목록 불러오기 실패 — 검색 줄 오른쪽 좁은 자리에서 두 줄로 꺾이지 않게 목록 위 한 줄씩(UG-451 기획 16991, PC · 휴대폰) */}
        {((loadError && rows.length > 0) || draftsError) && (
          <div className="list-errors" role="alert">
            {loadError && rows.length > 0 && <p className="error">{LOAD_FAILED}</p>}
            {draftsError && <p className="error">{DRAFTS_LOAD_FAILED}</p>}
          </div>
        )}

        {/* PC: 표 — 5칸(UG-450 기획 17007): 회사명 · 고객 이메일 · 메일 언어를 「고객」 한 칸에 두 줄로. 칸 폭은 globals.css .table--accounts */}
        <div className="table table--accounts" role="table" aria-label="발급한 계정">
          <div className="tr th" role="row">
            {["고객", "상태", "생성자", "생성일시", "관리"].map((h) => (
              <span key={h} role="columnheader">
                {h}
              </span>
            ))}
          </div>
          {/* 「작성 중」 명함(UG-431 기획 16864) — 첫 페이지 맨 위. 못 채운 칸 · 메일 언어는 「—」, 명함 사진은 넣지 않아요 */}
          {drafts.map((d) => (
            <div key={`draft-${d.id}`} className={`tr${freshId === `draft:${d.id}` ? " is-new" : ""}`} role="row">
              <span role="cell">
                <CustomerCell company={draftTitle(d) || null} email={d.email} language={d.language} gone={false} query={applied.keyword} resetOn={listStamp} />
              </span>
              <span role="cell">
                <DraftStatus />
              </span>
              <span role="cell">{d.createdBy ? handle(d.createdBy) : <span className="dash">—</span>}</span>
              <span role="cell">{d.createdAt ? fmtFull(d.createdAt) : <span className="dash">—</span>}</span>
              <span role="cell">
                {/* 계정 줄과 같은 모양: 자주 쓰는 「이어서 만들기」만 보이고 「지우기」는 ⋮ 안에(휴대폰 카드와 같게) — ⋮ 는 칸 오른쪽 끝(기획 17020) */}
                <span className="row-actions">
                  <button
                    type="button"
                    className="btn btn-outline btn-xs"
                    onClick={() => resumeDraft(d)}
                    disabled={resumingId !== null}
                    aria-busy={resumingId === d.id || undefined}
                  >
                    {resumingId === d.id ? "여는 중…" : "이어서 만들기"}
                  </button>
                  <RowMenu
                    items={[{ label: "지우기", danger: true, onSelect: () => setDraftDeleteTarget(d) }]}
                    disabled={resumingId === d.id}
                    resetOn={listStamp}
                  />
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
                <span role="cell">
                  <CustomerCell company={a.company || null} email={a.email || null} language={a.language} gone={isGone(a)} query={applied.keyword} resetOn={listStamp} />
                </span>
                <span role="cell">
                  <StatusCell account={a} />
                </span>
                <span role="cell">{a.createdBy ? handle(a.createdBy) : <span className="dash">—</span>}</span>
                <span role="cell">{fmtFull(a.createdAt)}</span>
                <span role="cell">
                  {a.status === "pending" ? (
                    // 「메일 재발송」 + ⋮(명함 보기 · 발급 취소) — UG-450 기획 17007. 1024 폭에서 「발급 취소」 버튼이 잘려 드물게 쓰는 발급 취소는 메뉴 안으로.
                    // ⋮ 는 칸 오른쪽 끝 같은 자리, 글자 버튼은 그 왼쪽(기획 17020) — 버튼이 없는 줄(주소 오류 · 막힘)도 ⋮ 는 같은 자리
                    <span className="row-actions">
                      {canResend(a) && (
                        <button type="button" className="btn btn-outline btn-xs" onClick={() => setResendTarget(a)}>
                          메일 재발송
                        </button>
                      )}
                      <RowMenu
                        items={[
                          ...(canViewCardPhoto(a) ? [{ label: CARD_PHOTO_TEXT.listView, onSelect: () => void openCardPhoto(a) }] : []),
                          { label: "발급 취소", danger: true, onSelect: () => setCancelTarget(a) },
                        ]}
                        resetOn={listStamp}
                      />
                    </span>
                  ) : canViewCardPhoto(a) ? (
                    // 사용 중이고 명함 사진이 있으면 ⋮ 에 「명함 보기」만(UG-455) — 첫 로그인 전 줄의 ⋮ 와 같은 자리
                    <span className="row-actions">
                      <RowMenu items={[{ label: CARD_PHOTO_TEXT.listView, onSelect: () => void openCardPhoto(a) }]} resetOn={listStamp} />
                    </span>
                  ) : a.status === "closing" ? (
                    // 해지 중(UG-443 기획 16908) — 원래 로그인 전이던 줄도 꺼진 버튼 없이 「—」(기획 17020). 마우스를 올리면 까닭
                    <span className="dash" title={CLOSING_TIP}>
                      —
                    </span>
                  ) : (
                    // 버튼이 없는 줄(명함 사진이 없는 사용 중 · 발급 취소 · 해지됨) — 처리 기록은 상태 칸으로 옮겼어요(UG-450 기획 16965)
                    <span className="dash">—</span>
                  )}
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
                </span>
              </div>
              <div className="card-line">
                {/* 「이어서 만들기」는 이메일(없으면 「—」) 바로 뒤, ⋮ 는 오른쪽 끝(UG-453 기획 2 · 17101) — 계정 카드의 「메일 재발송」과 같은 자리.
                    드물게 쓰는 「지우기」는 발급 취소처럼 더보기 안에 — 자주 쓰는 이어서 만들기만 카드에 보여요 */}
                <span className="card-contact">
                  <CardEmail email={d.email} query={applied.keyword} resetOn={listStamp} />
                  <button
                    type="button"
                    className="link-action link-action--muted"
                    onClick={() => resumeDraft(d)}
                    disabled={resumingId !== null}
                    aria-busy={resumingId === d.id || undefined}
                  >
                    {resumingId === d.id ? "여는 중…" : "이어서 만들기"}
                  </button>
                </span>
                <span className="card-actions">
                  <CardMore items={[{ label: "지우기", onSelect: () => setDraftDeleteTarget(d) }]} disabled={resumingId === d.id} />
                </span>
              </div>
              <div className="card-line">
                <span className="card-meta">
                  {[d.language ? languageShort(d.language) : "—", d.createdBy ? handle(d.createdBy) : "—", d.createdAt ? fmtShort(d.createdAt) : "—"].join(" · ")}
                </span>
              </div>
            </li>
          ))}
          {visible.map((a) =>
            isGone(a) ? (
              // 발급 취소 · 해지됨 카드(UG-463 기획 17235): 상태 배지는 다른 카드처럼 첫 줄 오른쪽 위 — 목록을 내려도 상태 자리가 왔다 갔다 하지 않게.
              // 첫 줄 = 회사명(「삭제됨」, 길면 말줄임 — UG-450 기획 16995) + 「● 발급 취소」, 둘째 줄 = 처리 기록 「11.04 14:51 · staff1」.
              // 두 줄 그대로(카드 높이 같음), 메일 언어 · 만든 정보 줄은 전처럼 없어요
              <li key={a.id} className={`card-row is-cancelled${a.id === freshId ? " is-new" : ""}`}>
                <div className="card-line">
                  <GoneCardCompany account={a} query={applied.keyword} resetOn={listStamp} />
                  <span className="card-status">
                    <Status account={a} />
                  </span>
                </div>
                <div className="card-line">
                  <GoneCardRecord account={a} />
                </div>
              </li>
            ) : (
              <li key={a.id} className={`card-row${a.id === freshId ? " is-new" : ""}`}>
                <div className="card-line">
                  <strong className="card-company">
                    <CompanyCell account={a} query={applied.keyword} />
                  </strong>
                  <span className="card-status">
                    <Status account={a} />
                  </span>
                </div>
                <div className="card-line">
                  {/* 「메일 재발송」은 이메일 바로 뒤(UG-453 기획 17101 — ⋮ 바로 옆이라 둘이 붙어 보였어요). 이메일이 길면 이메일만 줄어요 */}
                  <span className="card-contact">
                    <CardEmail email={a.email || null} query={applied.keyword} resetOn={listStamp} />
                    {canResend(a) && (
                      <button type="button" className="link-action link-action--muted" onClick={() => setResendTarget(a)}>
                        <IcReload size={14} />
                        메일 재발송
                      </button>
                    )}
                  </span>
                  {/* 둘째 줄 오른쪽 끝에 ⋮(UG-453 기획 2) — 전에는 ⋮(윗줄)와 재발송(아랫줄) 누르는 영역이 3px 떨어져 재발송을 누르면 ⋮ 메뉴가 열리곤 했어요.
                      드물게 쓰는 「발급 취소」는 더보기 안에 — 자주 쓰는 재발송만 카드에 보여요 */}
                  {a.status === "pending" ? (
                    <span className="card-actions">
                      <CardMore
                        items={[
                          ...(canViewCardPhoto(a) ? [{ label: CARD_PHOTO_TEXT.listView, onSelect: () => void openCardPhoto(a) }] : []),
                          { label: "발급 취소", onSelect: () => setCancelTarget(a) },
                        ]}
                      />
                    </span>
                  ) : (
                    // 사용 중이고 명함 사진이 있으면 같은 자리에 ⋮(「명함 보기」만, UG-455)
                    canViewCardPhoto(a) && (
                      <span className="card-actions">
                        <CardMore items={[{ label: CARD_PHOTO_TEXT.listView, onSelect: () => void openCardPhoto(a) }]} />
                      </span>
                    )
                  )}
                </div>
                <div className="card-line">
                  <span className="card-meta">{`${languageShort(a.language)} · ${handle(a.createdBy) || "—"} · ${fmtShort(a.createdAt)}`}</span>
                </div>
              </li>
            ),
          )}
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
          staffEmail={staffEmail}
          onDraftUsed={discardUsedDraft}
          onKeepDraft={keepDraft}
          onAutosave={autosaveDraft}
          onAutosaveSettled={reload}
          onClose={() => {
            setCreating(null);
            reload();
          }}
          onCreated={(account, notice) => afterSend({ kind: "created", account, photoNotSaved: notice?.photoNotSaved })}
          onMailFailed={afterMailFailed}
          onResent={() => afterSend({ kind: "resent" })}
          onResendMailFailed={reload}
          onCancelled={cancelledFromFailure}
          onResetSent={afterResetSent}
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

      {cardPhoto && <CardPhotoViewer src={cardPhoto.src} email={cardPhoto.email} onClose={closeCardPhoto} />}

      {(toast || photoToast > 0) && (
        <ToastStack>
          {toast && <Toast title={toast.title} detail={toast.detail} tone={toast.tone} onDone={clearToast} />}
          {/* 명함 사진을 저장하지 못한 알림은 직원이 닫을 때까지 남겨요(기획 17124) — 완료 알림은 전처럼 4초 */}
          {photoToast > 0 && (
            <Toast
              key={photoToast}
              title={CARD_PHOTO_TEXT.notSaved}
              detail={CARD_PHOTO_TEXT.notSavedDetail}
              tone="error"
              persist
              closeLabel={CARD_PHOTO_TEXT.notSavedClose}
              onDone={clearPhotoToast}
            />
          )}
        </ToastStack>
      )}
    </>
  );
}

/** 찍은 명함 작은 사진 — 누르면 크게 봐요. 오른쪽 아래 돋보기로 눌러 볼 수 있음을 알려요(기획 17099-3 — 흰 명함은 사진인지 알기 어려워요) */
function CardPhotoThumb({ src, onOpen }: { src: string; onOpen: () => void }) {
  return (
    <button type="button" className="card-thumb" onClick={onOpen} aria-label={CARD_PHOTO_TEXT.thumbLabel} title={CARD_PHOTO_TEXT.thumbLabel}>
      {/* eslint-disable-next-line @next/next/no-img-element -- data URL(줄인 명함 사진)이라 next/image 를 쓸 수 없어요 */}
      <img src={src} alt="" />
      <span className="card-thumb-zoom">
        <IcSearch size={14} />
      </span>
    </button>
  );
}

/**
 * 명함에서 읽은 이메일 칸 아래 안내 — 위아래로 쌓아 겹치지 않게.
 * 로컬 부분(@ 앞)에 숫자 · 로마자가 섞이고 헷갈리는 글자(0 · O, 1 · l · I)가 있으면 이메일을 다시 보여 주며 그 글자만 강조하고,
 * 「이메일 전체 — 명함과 같은지 확인해 주세요.」(이메일 전체 굵게, UG-451 — 도메인만 보이면 잘린 앞부분(jung@ ← daeun.jung@)을 놓쳐요.
 * 기획 16846 — company-a.com 을 company-a.qi 로 읽는 일도 그대로 보여요).
 */
function ScannedEmailNotes({ email, read }: { email: string; read: string | null }) {
  // 헷갈리는 글자는 칩이 읽은 그대로(소문자로 바꾸기 전)로 판단해요(UG-451 반박 리뷰 M1, confusableNote)
  const { confusable, parts } = confusableNote(email, read);
  if (!email) return null;
  return (
    <div className="confusable">
      {confusable && (
        <>
          <p className="confusable-email" translate="no">
            {parts.map((p, i) =>
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
      <p className="help">
        <strong className="email-check" translate="no">
          {email}
        </strong>{" "}
        — {CARD_PHOTO_TEXT.emailCheck}
      </p>
    </div>
  );
}

/**
 * 휴대폰 카드 더보기(⋮) — 「명함 보기」(UG-455) · 「발급 취소」 · 「작성 중」 카드의 「지우기」. 프로필 메뉴와 같은 어두운 유리.
 * 항목은 여러 개 — 위에서부터 차례로(드물게 쓰는 되돌릴 수 없는 동작은 맨 아래).
 */
function CardMore({ items, disabled = false }: { items: { label: string; onSelect: () => void }[]; disabled?: boolean }) {
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
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className="profile-menu-item"
              onClick={() => {
                setOpen(false);
                buttonRef.current?.focus(); // 확인 창 · 보기 화면을 닫으면 ⋮ 로 초점이 돌아오게
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type RowMenuItem = { label: string; onSelect: () => void; danger?: boolean };

/**
 * PC 표 줄의 더보기(⋮) — 「발급 취소」 · 「작성 중」의 「지우기」(UG-450 기획 17007). 테두리 없는 28px 버튼.
 * 메뉴는 화면에 고정(position: fixed)해 표의 옆 스크롤 상자에 잘리지 않게 하고, 그래서 스크롤 · 창 크기 바뀜이면 닫아요.
 * 바깥 누르기 · Esc · 화면 이동(뒤로 가기)에도 닫혀요. 키보드: 열면 첫 항목에 초점, ↑↓ · Home · End 로 이동, Enter · Space 로 고르기,
 * Esc 면 닫고 ⋮ 로 초점이 돌아와요. 항목을 고르면 ⋮ 에 초점을 둔 뒤 확인 창을 열어요(창을 닫으면 ⋮ 로 돌아와요).
 * 빨간 글씨(되돌릴 수 없는 동작)가 어두운 유리 위에서는 잘 안 읽혀 이 메뉴는 흰 바탕이에요.
 */
function RowMenu({
  items,
  disabled = false,
  resetOn,
}: {
  items: RowMenuItem[];
  disabled?: boolean;
  /** 목록이 바뀌면(새로 불러옴 · 줄이 빠지거나 옮겨짐) 닫아요 — 메뉴가 다른 줄 옆에 떠 있지 않게(반박 리뷰 F8) */
  resetOn: readonly unknown[];
}) {
  const [pos, setPos] = useState<{ top?: number; bottom?: number; right: number } | null>(null);
  const open = pos !== null;
  const [seen, setSeen] = useState(resetOn);
  if (seen.length !== resetOn.length || seen.some((v, i) => v !== resetOn[i])) {
    setSeen(resetOn);
    if (pos) setPos(null);
  }
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  function openMenu() {
    const r = buttonRef.current?.getBoundingClientRect();
    if (!r) return;
    const right = Math.max(8, window.innerWidth - r.right);
    // 아래 자리가 모자라면(마지막 줄 · 화면 아래 끝) 위로 열어요 — 항목 32 + 위아래 여백
    const need = items.length * 32 + 16;
    setPos(window.innerHeight - r.bottom < need ? { bottom: window.innerHeight - r.top + 4, right } : { top: r.bottom + 4, right });
  }

  function close(refocus: boolean) {
    setPos(null);
    if (refocus) buttonRef.current?.focus({ preventScroll: true });
  }

  // 열리면 첫 항목에 초점(마우스로 열어도 — 이어서 키보드로 고를 수 있게)
  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }, [open]);

  // 줄이 꺼지면(「작성 중」 줄을 여는 중) 열린 메뉴를 닫아요 — 렌더 중에 바로 맞춰요
  if (open && disabled) setPos(null);

  useEffect(() => {
    if (!open) return;
    const inside = (t: EventTarget | null) => !!t && (menuRef.current?.contains(t as Node) || buttonRef.current?.contains(t as Node));
    const onDown = (e: PointerEvent) => {
      if (!inside(e.target)) setPos(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setPos(null);
      buttonRef.current?.focus({ preventScroll: true });
    };
    // 화면 · 표가 밀리면 메뉴가 ⋮ 에서 떨어져 보여요 — 닫아요
    const onScroll = (e: Event) => {
      if (!inside(e.target)) setPos(null);
    };
    const onLeave = () => setPos(null);
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onLeave);
    window.addEventListener("popstate", onLeave);
    window.addEventListener("blur", onLeave);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onLeave);
      window.removeEventListener("popstate", onLeave);
      window.removeEventListener("blur", onLeave);
    };
  }, [open]);

  /** 메뉴 안 화살표 이동 */
  function onMenuKey(e: React.KeyboardEvent<HTMLDivElement>) {
    const list = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    if (list.length === 0) return;
    const at = list.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (e.key === "ArrowDown") next = (at + 1) % list.length;
    else if (e.key === "ArrowUp") next = (at - 1 + list.length) % list.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = list.length - 1;
    else if (e.key === "Tab") return close(false); // 초점은 다음 칸으로 그대로 넘어가요
    if (next < 0) return;
    e.preventDefault();
    list[next].focus({ preventScroll: true });
  }

  return (
    <span className="row-more">
      <button
        ref={buttonRef}
        type="button"
        className="row-more-button"
        aria-label="더보기"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => (open ? close(false) : openMenu())}
        onKeyDown={(e) => {
          // ↓ · ↑ 로도 열어요(메뉴 버튼 관례) — 열리면 첫 항목에 초점
          if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !open) {
            e.preventDefault();
            openMenu();
          }
        }}
      >
        <IcMoreVert size={18} />
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          className="row-menu"
          role="menu"
          aria-label="더보기"
          style={{ top: pos.top, bottom: pos.bottom, right: pos.right }}
          onKeyDown={onMenuKey}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={`row-menu-item${item.danger ? " is-danger" : ""}`}
              onClick={() => {
                close(true); // 확인 창을 닫으면 ⋮ 로 초점이 돌아오게(창이 연 버튼을 기억해요)
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

/**
 * 요약 카드 겸 상태 필터 버튼(UG-450 기획 16957). 읽어 주는 이름은 짧게 「첫 로그인 전 3개」(숫자를 모르면 이름만), 설명 문장은 aria-describedby 로.
 * 버튼 안이라 div 대신 span(블록 표시)을 써요.
 */
function Metric({
  id,
  label,
  value,
  sub,
  pressed,
  onPress,
}: {
  id: AccountStatusFilter;
  label: string;
  value: number | undefined;
  sub: string;
  pressed: boolean;
  onPress: (v: AccountStatusFilter) => void;
}) {
  const descId = `metric-desc-${id}`;
  return (
    <button
      type="button"
      className={`metric${pressed ? " is-on" : ""}`}
      aria-pressed={pressed}
      aria-label={value === undefined ? label : `${label} ${value}개`}
      aria-describedby={descId}
      onClick={() => onPress(id)}
    >
      <span className="metric-label">{label}</span>
      <span className="metric-body">
        <strong className="metric-value">{value ?? "—"}</strong>
        <span className="metric-sub" id={descId}>
          {sub}
        </span>
      </span>
    </button>
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
 * 일시 오류 · 그 밖의 실패는 「닫기」 · 「다시 보내기」(UG-451 기획 16991 — 목록의 다시 보내기와 같은 요청). 주소 오류 · 막힘은 「발급 취소」를 바로 할 수 있어요(확인 창 없이).
 */
function MailFailureResult({
  account,
  reason: firstReason,
  onClose,
  onCancelled,
  onResent,
  onMailFailed,
  onBusyChange,
}: {
  account: Account;
  reason: MailFailureReason | "blocked";
  onClose: () => void;
  onCancelled: () => void;
  /** 다시 보내기가 성공함 — 목록의 다시 보내기 성공과 같게 */
  onResent: () => void;
  /** 다시 보냈지만 또 메일이 가지 않음 — 목록만 새로 고쳐요(창은 그대로) */
  onMailFailed: () => void;
  /** 보내는 중 · 취소하는 중 — 감싼 창이 Esc · 바깥 클릭으로 닫히지 않게(closable) */
  onBusyChange: (busy: boolean) => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const { cancelling, cancelError, cancelNow } = useCancelNow(onCancelled);
  // 다시 보내기 — 또 메일이 가지 않으면 그 까닭으로 바꿔 보여요(주소 오류 · 막힘이면 「발급 취소」로 바뀌어요)
  const [reason, setReason] = useState(firstReason);
  const [resending, setResending] = useState(false);
  const [resendError, setResendError] = useState("");
  // 그사이 고객이 로그인 · 발급 취소 · 해지 시작 — 더 보낼 수 없어요
  const [resendDone, setResendDone] = useState(false);
  async function resend() {
    setResending(true);
    setResendError("");
    const res = await resendGuide(account.id, account.language);
    setResending(false);
    if (res.ok) return onResent();
    if (isMailFailure(res.reason)) {
      setReason(res.reason);
      return onMailFailed();
    }
    setResendError(resendErrorText(res.reason));
    if (res.reason === "in_use" || res.reason === "not_found" || res.reason === "closing") setResendDone(true);
  }
  const busy = cancelling || resending;
  useEffect(() => {
    onBusyChange(busy);
  }, [busy, onBusyChange]);
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
      ) : resendError ? (
        <p className="error" role="alert">
          {resendError}
        </p>
      ) : (
        <MailFailureMessage reason={reason} />
      )}
      <div className="dialog-actions">
        <button ref={closeRef} type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>
          닫기
        </button>
        {offersCancel(reason) && cancelError !== "in_use" && cancelError !== "not_found" && cancelError !== "closing" && (
          <button type="button" className="btn btn-danger-outline" onClick={() => cancelNow(account)} disabled={busy} aria-busy={cancelling || undefined}>
            {cancelling ? "취소하는 중…" : "발급 취소"}
          </button>
        )}
        {!offersCancel(reason) && !resendDone && (
          <button type="button" className="btn btn-dark" onClick={resend} disabled={busy} aria-busy={resending || undefined}>
            {resending ? "보내는 중…" : "다시 보내기"}
          </button>
        )}
      </div>
    </>
  );
}

/**
 * 주소를 고쳐 새 계정은 만들었는데 잘못된 주소의 옛 발급을 취소하지 못했을 때(UG-455 기획 17099-7) — 「계정을 만들었습니다」로만 끝내지 않고
 * 창 안에서 알리고 [다시 시도]로 바로 다시 취소하게 해요. 그래도 안 되면 목록 ⋮ 「발급 취소」로 취소할 수 있어요.
 * 이미 취소된 줄(not_found)은 취소된 것으로 보고 닫아요. 고객이 이미 로그인 · 해지 중이면 더 취소할 수 없어 [닫기]만 남겨요.
 */
function OldIssueLeftResult({
  account,
  fresh,
  mailSent,
  onDone,
  onBusyChange,
}: {
  /** 취소하지 못한 옛 발급(잘못된 주소의 계정) */
  account: Account;
  /** 새로 만든 계정 — 위쪽에 「새 계정」 줄로 보여 줘요(기획 17120-2) */
  fresh: Account;
  /** 새 계정에 안내 메일을 보냈는지 */
  mailSent: boolean;
  /** 다시 취소했거나 [닫기] — 감싼 창이 다음 화면(완료 알림 · 메일 실패 결과)으로 넘어가요 */
  onDone: () => void;
  /** 취소하는 중 — 감싼 창이 Esc · 바깥 클릭으로 닫히지 않게(closable) */
  onBusyChange: (busy: boolean) => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<"" | CancelFailure>("");
  async function retry() {
    setRetrying(true);
    setError("");
    const res = await cancelIssue(account.id);
    setRetrying(false);
    if (!oldIssueLeft(res)) return onDone();
    if (!res.ok) setError(res.reason);
  }
  useEffect(() => {
    onBusyChange(retrying);
  }, [retrying, onBusyChange]);
  // 입력 칸 · 보내기 버튼이 사라지므로 초점을 「닫기」로 옮겨요.
  useEffect(() => {
    closeRef.current?.focus();
  }, []);
  return (
    <>
      <div className="summary">
        <div className="summary-target">
          {account.company && <strong>{account.company}</strong>}
          <span className="summary-line">
            <span className="summary-label">{RECREATE_TEXT.newAccountLabel}</span> {fresh.email} {newAccountMailText(mailSent)}
          </span>
          <span className="summary-line">
            <span className="summary-label">{RECREATE_TEXT.leftOldLabel}</span> {account.email}
          </span>
        </div>
      </div>
      {error ? (
        <p className="error" role="alert">
          {cancelErrorText(error)}
        </p>
      ) : (
        <Sentences text={RECREATE_TEXT.oldCancelFailed} lines />
      )}
      <div className="dialog-actions">
        <button ref={closeRef} type="button" className="btn btn-outline" onClick={onDone} disabled={retrying}>
          닫기
        </button>
        {error !== "in_use" && error !== "closing" && (
          <button type="button" className="btn btn-dark" onClick={retry} disabled={retrying} aria-busy={retrying || undefined}>
            {retrying ? RECREATE_TEXT.retrying : RECREATE_TEXT.retry}
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
 * UG-431: 고객 이름(필수) · 연락처(선택) 칸과 「명함 찍어서 채우기」(N1~N4 · 칩 N3b). 명함 사진은 서버가 먼저 읽고(UG-463 card-read.ts), 못 읽으면 기기 안에서 읽어요(card-ocr.ts).
 * 명함을 찍었거나 칸을 채운 뒤 만들지 않고 닫으면(취소 · Esc · 바깥) 「작성 중」으로 서버에 남겨요(기획 16864 — onClose 의 keep).
 * 주소를 고치는 중(fix) · 결과 화면은 계정이 이미 있어 남기지 않아요. draft = 이어서 만들기로 연 명함(칸 · 칩 · 사진 · 메일 언어를 채워 열어요).
 */
function CreateDialog({
  draft,
  staffEmail,
  onDraftUsed,
  onKeepDraft,
  onAutosave,
  onAutosaveSettled,
  onClose,
  onCreated,
  onMailFailed,
  onResent,
  onResendMailFailed,
  onCancelled,
  onResetSent,
}: {
  draft: CardDraftDetail | null;
  /** 지금 로그인한 직원 이메일 — 응답을 잃은 새 명함을 찾을 때 내가 만든 명함만 봐요 */
  staffEmail: string | null;
  /** 이어서 만든 · 자동 저장한 명함을 다 씀(이미 만든 계정에 안내 메일을 다시 보냄) — 목록이 뒤에서 지워요 */
  onDraftUsed: (id: string) => void;
  /**
   * 닫을 때 「작성 중」으로 남겨요(목록이 저장) — false 면 남기지 못해 창이 다시 시도 · 그래도 닫기를 보여 줘요.
   * lost = 응답을 잃은 새 명함 저장들(서버에 남았으면 그 명함에 이어 써요)
   */
  onKeepDraft: (keep: DraftKeep, lost: LostSaves) => Promise<boolean>;
  /** 「작성 중」 자동 저장(UG-451 기획 17009) — 목록이 같은 명함의 저장 차례를 지켜요 */
  onAutosave: (id: string | null, input: CardDraftInput, lost: LostSaves) => Promise<AutosaveOutcome>;
  /** 창이 닫힌 뒤에 끝난 자동 저장 — 목록을 새로 고쳐요(그 명함이 목록에 보이게) */
  onAutosaveSettled: () => void;
  /** 창을 닫아요(남길 것은 이미 남겼어요) */
  onClose: () => void;
  onCreated: (a: Account, notice?: CreatedNotice) => void;
  /** 계정은 만들었지만 메일은 못 보냄 — 창은 닫지 않고 결과를 보여 줘요(목록만 새로 고침) */
  onMailFailed: (a: Account, notice?: CreatedNotice) => void;
  onResent: () => void;
  /** 첫 로그인 전 계정에 다시 보냈지만 메일은 못 보냄(막힌 경우 포함) — 창은 닫지 않고 목록만 새로 고쳐요 */
  onResendMailFailed: () => void;
  /** 실패 · 막힘에서 바로 발급 취소함 */
  onCancelled: () => void;
  /** 사용 중 계정에 비밀번호 재설정 메일을 대신 보냄(UG-421) — 창을 닫고 알림 */
  onResetSent: (result: Extract<PasswordResetResult, { ok: true }>) => void;
}) {
  const [company, setCompany] = useState(draft?.draft.company ?? "");
  const [name, setName] = useState(draft?.draft.name ?? "");
  const [email, setEmail] = useState(draft?.draft.email ?? "");
  const [phone, setPhone] = useState(draft?.draft.phone ?? "");
  const [language, setLanguage] = useState<MailLanguage>(draft?.draft.language ?? "en");
  // 메일 언어를 고른 적이 있는지 — 고르지 않았으면(처음 골라 둔 English 그대로) 「작성 중」 목록에 「—」로 남겨요
  const [languageChosen, setLanguageChosen] = useState(!!draft?.draft.language);
  // 한글 명함이라 메일 언어를 「한국어」로 골라 둔 상태인지(UG-451 기획 17100 규칙 6) — 직원이 직접 고르면 풀려요(그 뒤로는 자동으로 바꾸지 않아요).
  // 「작성 중」에는 이 언어도 남겨요 — 이어서 열면 저장된 언어를 직원이 고른 것처럼 지켜요
  const [languageAuto, setLanguageAuto] = useState(false);
  // 이어서 만든 명함의 사진(data URL)
  const [draftPhoto] = useState(() => photoFromDraft(draft?.photo ?? null));
  // 창이 기억하는 「작성 중」 명함(UG-451 기획 17009) — id = 서버 명함 번호(이어서 만든 명함 또는 자동 저장이 새로 남긴 명함),
  // serverPhoto = 그 명함의 사진(data URL — 화면 사진이 이것과 같으면 다시 올리지 않고 keepPhoto),
  // ended = 계정을 만들었거나(서버가 지움) 다시 보내기로 다 씀 — 그 뒤로는 남기지 않아요(자동 저장이 되살리지 않게)
  const memRef = useRef<DraftMemory>({ id: draft?.draft.id ?? null, serverPhoto: draftPhoto, ended: false });
  // 응답을 잃은 새 명함 저장(서버엔 남았을 수 있어요) — 다음 저장 · 계정 만들기 · 다 쓰기 때 찾아 이어 써요(중복 「작성 중」 방지).
  // since = 이 창을 연 시각 − 시계 오차(그 전 명함은 후보가 아니에요, 반박 리뷰 F2)
  const lostRef = useRef<LostSaves>({ since: 0, inputs: [] });
  // 이 창의 자동 저장이 새로 만든 명함 번호들 — 다른 직원이 지웠으면 한 번 새로 남겨요(F5). 이어서 만든 원래 명함은 들지 않아요
  const ownIdsRef = useRef(new Set<string>());
  const recreatedRef = useRef(false);
  // 서버가 받지 않은 사진(너무 큼 · 형식)의 표 — 자동 저장이 같은 사진을 되풀이해 올리지 않게(F7)
  const rejectedPhotoRef = useRef<string | null>(null);
  // 보내기(계정 만들기 · 다시 보내기) 동안의 자동 저장 멈춤 — 끝나면 풀어요
  const submitHold = useRef<(() => void) | null>(null);
  // 「작성 중」 자동 저장 일정표(아래 「자동 저장」) — 창이 열려 있는 동안만 있어요
  const autosaveRef = useRef<Autosaver | null>(null);
  // 창이 열려 있는지 — 닫힌 뒤에 끝난 자동 저장은 목록을 새로 고쳐요
  const openRef = useRef(false);
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
  const inflight = useRef<{ key: string; result: Promise<EmailCheck | null>; quiet: boolean } | null>(null);
  // 마지막 이메일 확인이 실패한 까닭 — network = 응답 없음 · 5xx · 시간 초과(버튼 위에 「연결이 불안정해…」), other = 그 밖
  const checkFailure = useRef<"network" | "other" | null>(null);
  const busy = useRef(false);
  // 첫 로그인 전 이메일이라 메일 언어를 자동으로 바꿨으면, 그 전 언어(다른 이메일로 고치면 되돌려요)
  const langBeforePending = useRef<MailLanguage | null>(null);
  const [mailFailure, setMailFailure] = useState<{ account: Account; reason: MailFailureReason | "blocked" } | null>(null);
  // 실패 결과에서 다시 보내는 중 · 취소하는 중 — 창이 Esc · 바깥 클릭으로 닫히지 않게
  const [resultBusy, setResultBusy] = useState(false);
  // 주소 고쳐 새로 만든 뒤 옛 발급을 취소하지 못함(기획 17099-7) — 창에 남아 알리고 다시 취소하게 해요.
  // created = 메일까지 보낸 새 계정(안내를 닫으면 완료 알림과 함께 창을 닫아요). 메일을 못 보냈으면 null — 안내를 닫으면 그 결과 화면 · 주소 고치기로 가요
  const [staleIssue, setStaleIssue] = useState<{ old: Account; fresh: Account; created: Account | null; notice: CreatedNotice } | null>(null);
  // 새 계정은 만들지 못했는데 옛 발급의 계정 · 링크는 이미 지워짐(서버 sourceCancel = revoked, 반박 리뷰 M1) — 그 옛 발급의 번호.
  // 고치는 대상이 그 발급인 동안 버튼 위에 알리고 [발급 취소]를 함께 둬요(목록에는 「첫 로그인 전」으로 남아 있어 직원이 알 수 없어요)
  const [revokedOldId, setRevokedOldId] = useState<string | null>(null);
  // 이 창에서 만든 계정의 명함 사진 저장이 실패했어요(화면 반박 리뷰 3) — 주소를 고쳐 재발송하면 옮길 사진이 없어 서버가 none 으로
  // 답하지만 새 계정에도 사진은 없으니, 그 완료 알림에도 「명함 사진은 저장하지 못했습니다」를 붙여요
  const photoLostRef = useRef(false);
  // 주소 오류로 메일이 가지 않은 계정 — 이 창에서 주소를 고쳐 재발송해요(회사명 · 메일 언어는 이 계정 그대로).
  const [fix, setFix] = useState<Account | null>(null);
  // 명함 읽기가 끝났을 때 고치는 모드인지 보려고(읽는 동안 바뀔 수 있어요)
  const fixRef = useRef<Account | null>(null);
  useEffect(() => {
    fixRef.current = fix;
  }, [fix]);
  // 사용 중 이메일에서 「고객이 비밀번호를 잊었나요?」를 누르면 이 창 대신 재설정 메일 확인 창(UG-421 D2 · MD2)을 띄워요.
  // 창을 겹치지 않고 바꿔 그려요 — 이 컴포넌트는 그대로라 [취소]로 돌아오면 입력값이 그대로예요.
  const [resetConfirm, setResetConfirm] = useState(false);
  // 확인 창에서 [취소]로 돌아왔는지 — 돌아오면 초점을 「고객이 비밀번호를 잊었나요?」에 둬요
  const [resetReturned, setResetReturned] = useState(false);
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
  // 읽지 못함 — tool = 글자 읽기 도구를 받지 못함, read = 읽었지만 글자를 찾지 못함 · 읽다가 실패
  const [scanFailed, setScanFailed] = useState<ScanFailure | null>(null);
  // 글자 읽기 도구를 받는 중의 진행률(받지 않으면 null)
  const [scanProgress, setScanProgress] = useState<number | null>(null);
  // 찍힌 방향으로 못 읽어 돌려 다시 읽는 중(UG-451 기획 17106-3) — 몇 번째 방향인지(아니면 null)
  const [scanRetry, setScanRetry] = useState<{ attempt: number; total: number } | null>(null);
  // 명함 읽기 차례 번호(UG-451 반박 리뷰 4) — 돌려 읽는 동안에는 「명함 다시 찍기」를 누를 수 있어요. 새 사진을 읽기 시작하면 번호가 올라가고,
  // 늦게 끝난 앞 읽기는 번호가 달라 결과를 버려요(앞 명함 값이 새 명함 칸 · 칩 · 사진을 덮지 않게). 처음 읽는 동안은 전처럼 버튼이 잠겨 있어요
  const scanGen = useRef(0);
  // 서버가 명함을 읽는 중(UG-463, card-read.ts) — 기다림 안내만 달라요. 이 동안에도 「명함 다시 찍기」는 잠겨요(scanLocked)
  const [scanServer, setScanServer] = useState(false);
  // 서버가 읽어 채운 명함(UG-463) — 칩이 없어 scan 은 비어 있어요. email = 서버가 채운 이메일(칸이 그대로인 동안 「명함과 같은지 확인」 안내를 띄워요)
  // 기기 안에서 다시 읽거나 못 읽으면 지워요
  const [serverRead, setServerRead] = useState<{ email: string | null } | null>(null);
  // 서버 읽기를 끊는 신호 — 창을 닫으면 끊어요
  const serverAbort = useRef<AbortController | null>(null);
  useEffect(() => () => serverAbort.current?.abort(), []);
  // 「명함 다시 찍기」를 누를 수 없는 동안 — 처음 방향을 읽는 중(돌려 읽는 중에는 풀려요)
  const scanLocked = scanning && !scanRetry;
  const scanFailedText =
    scanFailed === "tool" ? SCAN_TOOL_FAILED : scanFailed === "tool_reload" ? SCAN_TOOL_RELOAD : scanFailed === "format" ? SCAN_FORMAT_FAILED : SCAN_FAILED;
  const scanWaitText = scanServer
    ? SCAN_SERVER_WAIT
    : scanRetry
      ? scanRotating(scanRetry.attempt, scanRetry.total)
      : scanProgress !== null && scanProgress < 100
        ? scanDownloading(scanProgress)
        : SCAN_WAIT;
  // 읽은 줄(칩)을 펼쳤는지(UG-451 기획 17100 규칙 3 · 7) — 접어 두고 「읽은 줄 모두 보기 (n)」로 펼쳐요. 창을 닫았다 열면 접힌 채로 시작해요.
  // 이메일 칸이 빈 「작성 중」 명함만 펼친 채로 열어요(규칙 4 — 메일 주소를 읽은 줄에서 골라야 할 수 있어요)
  const [chipsOpen, setChipsOpen] = useState(() => !!draft && !draft.draft.email?.trim() && scanFromDraft(draft.chips) !== null);
  // 명함에서 메일 주소를 채우지 못함(N4) — 이메일 칸 아래 회색 안내. 주소가 들어오면 지워요(UG-451 기획 17022).
  // none = 메일 모양 글자를 하나도 읽지 못함, unsure = 메일 칩은 있지만 잘렸을 수 있어 채우지 않음(읽은 줄에서 고르거나 직접 입력)
  const [emailMissing, setEmailMissing] = useState<"none" | "unsure" | null>(null);
  // 비교용 명함 사진(줄인 JPEG data URL). 기기에는 저장하지 않아요(기획 16841). 계정을 만들 때 함께 보내 서버가 계정과 함께 남기고(UG-455 — 목록 「명함 보기」),
  // 창은 계정을 만들고 나면 이 사진을 비워요. 주소 오류로 고치는 동안(fix)에는 남겨 두며(고친 주소로 새로 만들 때도 함께 보내요),
  // 만들지 않고 닫으면 「작성 중」 명함과 함께 서버에 남겨요(기획 16864 — 계정을 만들거나 30일이면 서버가 그 「작성 중」 명함을 지워요).
  const [photo, setPhoto] = useState<string | null>(draftPhoto);
  const [viewingPhoto, setViewingPhoto] = useState(false);
  // 커서가 있는 칸(칩 규칙 3). 칩을 누르면 칸에서 초점이 빠질 수 있어서(아이패드) 방금 빠진 칸도 커서로 봐요.
  // virtual = 초점 없이 정한 대상 칸(UG-453 기획 5) — 터치 기기에서 칩을 넣은 뒤 · 명함을 읽은 뒤 다음 빈 칸. 키보드를 올리지 않으려고 초점은 주지 않아요.
  //   칸을 직접 누르면(초점) 그 칸으로 바뀌어요. 화면에는 chipTarget 으로 그 칸을 진하게 보여 줘요(.input-box.is-target)
  //   읽은 줄이 접혀 있으면 대상 칸도 없어요(UG-451 기획 17100) — 펼칠 때 정해요(toggleChips)
  const [chipTarget, setChipTarget] = useState<ScanField | null>(() =>
    chipsOpen && isTouchPrimary() ? nextChipTarget(null, null, { company, name, email, phone }) : null,
  );
  const cursor = useRef<{ field: ScanField; blurredAt: number | null; virtual?: boolean } | null>(
    chipTarget ? { field: chipTarget, blurredAt: null, virtual: true } : null,
  );
  // 명함 읽기가 끝났을 때의 칸 값 — 읽는 동안(수 초) 직원이 친 값을 보려고 늘 최신으로 둬요(onPhoto 는 누를 때의 값만 알아요)
  const latestValues = useRef<ScanValues>({ company, name, email, phone });
  // 메일 언어도 — 읽는 동안 직원이 고른 언어 · 명함이 방금 골라 둔 언어를 보려고(규칙 6)
  const latestLanguage = useRef({ language, chosen: languageChosen, auto: languageAuto });
  useEffect(() => {
    latestValues.current = { company, name, email, phone };
    latestLanguage.current = { language, chosen: languageChosen, auto: languageAuto };
  });
  // 명함 읽기가 자동으로 채운 값(칸별). 칸 값이 이것과 같으면 직원이 손대지 않은 것으로 보고 다시 찍을 때 바꿔요(UG-451 기획 16991)
  const autoFilled = useRef<Partial<Record<ScanField, string>>>({});
  // 지금 칸 값이 기대는 명함에서 읽은 이메일(UG-451 기획 17118-1) — 다시 찍은 명함의 이메일과 견줘 다른 사람이면 직원이 넣은 값도 비워요(card-retake.ts).
  // 직원이 그 뒤 이메일 칸을 고쳐도 · 다음 명함을 읽지 못해도 그대로 둬요. 「이어서 만들기」로 연 명함은 읽은 주소를 몰라 비어 있어요(칸 값으로 견줘요)
  const cardEmail = useRef("");
  // 다시 찍은 뒤의 안내 — 다른 사람이라 직원이 넣은 값을 지웠거나, 같은 사람인지 알 수 없어 남긴 값이 있을 때. 그 칸을 직원이 고치면 내려가요
  const [retakeNoted, setRetakeNoted] = useState<RetakeNote | null>(null);

  const trimmed = email.trim();
  // 조회 결과는 적힌 그대로(대소문자 구분)의 이메일로 맞춰요 — auth 가 대소문자를 가르므로 대소문자만 고쳐도 다른 계정이에요(UG-421)
  const key = trimmed;
  const current = check && check.email === key ? check.result : null;
  // 이 창에서 확인한 이메일(적힌 그대로) → 결과 — 칸 이메일 · 명함 칩의 메일 주소 모두(UG-451 반박 리뷰 F3)
  const [known, setKnown] = useState<Record<string, EmailCheck["status"]>>({});
  const remember = (address: string, status: EmailCheck["status"] | null) =>
    setKnown((k) => {
      if ((k[address] ?? null) === status) return k;
      const next = { ...k };
      if (status === null) delete next[address];
      else next[address] = status;
      return next;
    });
  /** 칸 이메일의 확인 결과를 바꿔요(칸 아래 안내) — 확인한 이메일 기억(known)도 함께. result = null 이면 다시 확인할 것으로 */
  function setChecked(address: string, result: EmailCheck | null) {
    setCheck(result ? { email: address, result } : null);
    remember(address, result?.status ?? null);
  }
  // 명함 칩의 메일 주소들(잘렸을 수 있는 칩은 뽑은 꼬리 주소) — 이미 있는 계정이면 이 명함은 「작성 중」으로 남기지 않아요(F3)
  const chipEmails = scan ? chipEmailAddresses(scan.chips) : [];
  // 「작성 중」으로 남겨도 되는지(UG-451 기획 17022 · 반박 리뷰 F3 · F4, draftSaveGate) — 칸 이메일이 「새 계정」으로 확인됐거나,
  // 칸이 비었거나 형식이 아니면 명함 칩의 메일 주소가 모두 새 주소일 때만. 확인 전이면 wait, 있는 계정이면 existing
  // 칸 값이 잘렸을 수 있는 메일 칩의 값 · 그 칩에서 뽑은 잘린 주소와 같음 — 경고하고 보내기를 막아요(반박 리뷰 F2 · 최종 리뷰 R3, 고치면 풀려요)
  // 직원이 「명함과 같은 주소예요」로 확인한 칸 값(UG-451 기획 17030) — 맞는 주소인데 의심으로 막히는 경우(「Sales · kim@acme.com」 등)를 풀어요.
  // 확인한 그 값 그대로일 때만 풀리고, 칸이 조금이라도 바뀌거나(changeEmail) 명함을 다시 찍으면 지워요. 서버 · 「작성 중」에는 남기지 않아요(이어서 열면 다시 경고)
  const [confirmedEmail, setConfirmedEmail] = useState<string | null>(null);
  // 경고하고 보내기 · 재설정을 막는지 — 의심 값이고 직원이 확인하지 않았을 때.
  // 「작성 중」 저장 판단도 같아요 — 확인한 값은 의심이 아닌 주소처럼 「새 계정」으로 확인되면 남겨요(기획 17030 결정)
  const suspectBlocked = !!scan && isUnconfirmedSuspect(trimmed, scan.chips, confirmedEmail);
  // 「명함과 같은 주소예요」를 눌러 버튼이 사라진 뒤(그린 다음) 초점을 이메일 칸으로 돌려요(confirmSuspect — PC · 터치 기기 모두, 기획 17100)
  const focusAfterConfirm = useRef(false);
  useEffect(() => {
    if (!focusAfterConfirm.current) return;
    focusAfterConfirm.current = false;
    emailRef.current?.focus();
  }, [confirmedEmail]);
  // 의심 주소 경고와 「명함과 같은 주소예요」가 나타나면 그 버튼까지 보이게 스크롤해요(UG-451 기획 17100 — 누르는 범위 겹침).
  // 휴대폰은 맨 아래 버튼 줄(취소 · 실행)이 창 위에 붙어 있어, 칩을 눌러 주소를 넣으면(칸에 초점 없음 — 창이 따로 맞춰 주지 않아요) 새로 생긴 버튼이
  // 그 줄 밑에 몇 px 걸쳐 눌리는 범위가 겹칠 수 있었어요. 가장 가까운 자리로만 움직이고(이미 다 보이면 그대로), 휴대폰은 버튼 줄 높이 + 8 을 비워요(.scrim scroll-padding-bottom)
  const suspectConfirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (suspectBlocked) suspectConfirmRef.current?.scrollIntoView({ block: "nearest" });
  }, [suspectBlocked]);
  const emailGate = draftSaveGate({
    email: trimmed,
    checkable: EMAIL_RE.test(trimmed),
    fieldStatus: current?.status ?? null,
    chipEmails,
    known,
    suspectChips: !!scan && scan.chips.some(isSuspectChip),
    fieldSuspect: suspectBlocked,
  });

  /** 첫 로그인 전 이메일: 메일 언어를 처음 보낸 언어로 미리 골라 둬요(전 언어는 기억). */
  function pickPendingLanguage(l: MailLanguage) {
    // 최신 언어로 기억해요 — 명함이 방금 「한국어」로 골라 둔 뒤 이어진 조회는 그 전 그림의 language 를 들고 있어요(UG-451 기획 17100 규칙 6)
    if (langBeforePending.current === null) langBeforePending.current = latestLanguage.current.language;
    setLanguage(l);
  }

  /**
   * 이메일 확인 — target = 확인할 이메일(기본은 칸 값, 명함이 방금 채운 값은 아직 이 그림에 없어 따로 받아요).
   * quiet = 직원이 부르지 않은 확인(명함이 채움 · 「작성 중」 저장 전 확인, UG-451 기획 17022) — 실패해도 칸 아래 안내를 띄우지 않아요.
   * 같은 이메일을 확인하는 중이면 그 결과를 같이 기다려요 — 직원이 부른 쪽(칸을 벗어남)이면 실패 안내는 띄워요.
   */
  function runCheck(target: string = trimmed, quiet = false): Promise<EmailCheck | null> {
    if (!EMAIL_RE.test(target)) return Promise.resolve(null);
    if (check && check.email === target) return Promise.resolve(check.result);
    if (inflight.current?.key === target) {
      const joined = inflight.current.result;
      if (!quiet && inflight.current.quiet) {
        void joined.then((r) => {
          if (r === null && checkFailure.current && emailRef.current?.value.trim() === target) setEmailError(CHECK_FAILED);
        });
      }
      return joined;
    }
    const result = lookup(target, quiet);
    inflight.current = { key: target, result, quiet };
    void result.finally(() => {
      if (inflight.current?.result === result) inflight.current = null;
    });
    return result;
  }

  async function lookup(asked: string, quiet: boolean): Promise<EmailCheck | null> {
    let result: EmailCheck;
    setChecking(true);
    try {
      result = await checkEmail(asked);
      checkFailure.current = null;
    } catch (e) {
      checkFailure.current = isNetworkError(e) ? "network" : "other";
      if (!quiet && emailRef.current?.value.trim() === asked) setEmailError(CHECK_FAILED);
      return null;
    } finally {
      setChecking(false);
    }
    // 확인한 결과는 기억해요(명함 칩 주소 판정에도 써요) — 조회하는 사이 이메일을 고쳤으면 칸 아래 안내에는 쓰지 않아요.
    remember(asked, result.status);
    if (emailRef.current?.value.trim() !== asked) return null;
    setChecked(asked, result);
    if (result.status === "pending") {
      pickPendingLanguage(result.language);
    }
    return result;
  }

  // 명함 칩 메일 주소 확인 중인 것 — 같은 주소를 두 번 묻지 않게(닫을 때는 이 결과를 같이 기다려요)
  const chipChecks = useRef(new Map<string, Promise<EmailCheck["status"] | null>>());
  /**
   * 명함 칩의 메일 주소를 조용히 확인해요(UG-451 반박 리뷰 F3) — 칸에 들어가지 않은 주소(잘렸을 수 있어 채우지 않음 등)도
   * 이미 있는 계정이면 이 명함은 「작성 중」으로 남기지 않아요. 실패한 주소는 모름으로 두고 다음 변경 · 닫을 때 다시 물어요.
   * 결과(주소 → 상태, 실패는 빠짐)를 돌려줘요 — 닫을 때는 아직 이 그림에 없는 결과로 다시 정해요.
   */
  async function checkChipEmails(addresses: readonly string[]): Promise<Record<string, EmailCheck["status"]>> {
    const out: Record<string, EmailCheck["status"]> = {};
    await Promise.all(
      addresses.map(async (address) => {
        let pending = chipChecks.current.get(address);
        if (!pending) {
          // 칸 이메일로 확인 중이면 그 결과를 같이 기다려요
          const field = inflight.current?.key === address ? inflight.current.result : null;
          pending = field
            ? field.then((r) => r?.status ?? null)
            : checkEmail(address).then(
                (r) => {
                  remember(address, r.status);
                  return r.status;
                },
                () => null,
              );
          chipChecks.current.set(address, pending);
          void pending.finally(() => chipChecks.current.delete(address));
        }
        const status = await pending;
        if (status) out[address] = status;
      }),
    );
    return out;
  }

  /**
   * 닫을 때 「작성 중」으로 남길 것. 명함을 찍었거나 네 칸 중 하나라도 채웠을 때만(서버도 빈 명함은 받지 않아요 — PJ-101).
   * 주소를 고치는 중(fix) · 결과 화면 · 보내는 중은 계정이 만들어졌거나 만드는 중이라 남기지 않아요.
   */
  function draftToKeep(): DraftKeep | null {
    const mem = memRef.current;
    if (fix || mailFailure || sending || mem.ended) return null;
    const id = mem.id;
    // 서버 상한으로 자르고 제어 문자는 공백으로(긴 칩 · 붙여 넣은 글로 저장이 통째로 실패하지 않게). 이메일은 넘으면 비워요.
    const values = {
      company: draftField(company, CARD_DRAFT_MAX.company),
      name: draftField(name, CARD_DRAFT_MAX.name),
      email: draftField(email, CARD_DRAFT_MAX.email, true),
      phone: draftField(phone, CARD_DRAFT_MAX.phone),
    };
    // 사진(draft-session.ts photoPlan): 화면 사진이 서버 명함의 사진과 같으면 keepPhoto(다시 올리지 않음), 새로 찍은 사진이면 그 사진,
    // 읽는 중 · 다시 찍기가 사진을 만들지 못했으면 사진 없이 — 앞 명함 사진이 새 명함 칸과 함께 남지 않게(반박 리뷰 F4)
    const plan = photoPlan(photo, mem.serverPhoto, scanning);
    // 비었으면 지울 것 — 단, 다시 찍어 읽는 중에는 비어 보여도 지우지 않아요(결과를 기다리는 중이에요, 재검토 R1). 그때는 그냥 남기지 않아요
    if (!Object.values(values).some(Boolean) && !plan.photo && !plan.keepPhoto) return id && !scanning ? { id, remove: true } : null;
    const chips = chipsForDraft(scan);
    // 첫 로그인 전 이메일이라 메일 언어를 잠깐 바꿨으면 직원이 고른 언어로
    // 한글 명함이라 골라 둔 「한국어」도 남겨요(규칙 6)
    const lang = languageChosen || languageAuto ? (langBeforePending.current ?? language) : null;
    const input: CardDraftInput = {
      ...Object.fromEntries(Object.entries(values).filter(([, v]) => v)),
      ...(lang ? { language: lang } : {}),
      ...(chips ? { chips } : {}),
      ...plan,
    };
    // 이 창의 자동 저장이 만든 명함이면, 그사이 다른 직원이 지웠을 때 한 번 새로 남길 값(F5) — 서버에 있던 사진은 다시 올려요
    const recreate = id && ownIdsRef.current.has(id) && !recreatedRef.current ? forNewDraft(input, mem.serverPhoto) : undefined;
    return { id, input, ...(recreate ? { recreate } : {}) };
  }
  // 닫을 때 「작성 중」 저장 — 끝날 때까지 창을 열어 두고, 연결 문제로 실패하면 [다시 시도] [그래도 닫기](UG-451 기획 16991)
  const [keepingDraft, setKeepingDraft] = useState(false);
  const [keepFailed, setKeepFailed] = useState(false);
  // 잠금은 ref 로 — Esc 와 클릭이 같은 틈에 겹쳐도 저장을 한 번만 해요(상태는 다음 렌더에야 바뀌어요)
  const keepLock = useRef(false);
  async function close() {
    if (keepLock.current) return;
    keepLock.current = true;
    // 자동 저장을 멈추고, 보내는 중이면 끝난 뒤에 남겨요 — 자동 저장이 새로 남긴 명함 번호 · 올린 사진을 이어 쓰고, 두 저장이 겹치지 않게.
    // 멈춤은 센 수라 그사이 보내기가 끝나 풀어도 이 멈춤은 남아요(반박 리뷰 F3). 기다려야 할 때만 「저장하는 중」으로 잠가요
    const autosave = autosaveRef.current;
    if (autosave?.saving) setKeepingDraft(true);
    const release = await autosave?.suspend();
    const keep = draftToKeep();
    if (!keep) {
      keepLock.current = false;
      setKeepingDraft(false);
      return onClose();
    }
    // 다시 시도하는 동안에는 실패 안내 · 버튼(「저장하는 중…」)을 그대로 둬요
    setKeepingDraft(true);
    // 이미 있는 계정(사용 중 · 해지 중 · 첫 로그인 전)의 이메일이면 — 칸이든 명함 칩이든 — 남기지 않아요(UG-451 기획 17022 · 반박 리뷰 F3).
    // 확인 전 · 확인 실패였으면 한 번 더 확인해 다시 정하고, 그래도 모르면 전처럼 남겨요(gateAtClose).
    // 이 창의 자동 저장이 이미 남긴 명함은 지워요 — 이어서 만든 원래 명함은 그대로(ownDraftToDiscard)
    if (!keep.remove) {
      let gate = emailGate;
      if (gate === "wait") {
        const field = EMAIL_RE.test(trimmed) && !current ? await runCheck(trimmed, true) : null;
        const chips = await checkChipEmails(chipEmails.filter((address) => known[address] === undefined));
        gate = draftSaveGate({
          email: trimmed,
          checkable: EMAIL_RE.test(trimmed),
          fieldStatus: field?.status ?? current?.status ?? null,
          chipEmails,
          known: { ...known, ...chips },
          suspectChips: !!scan && scan.chips.some(isSuspectChip),
          fieldSuspect: suspectBlocked,
        });
      }
      if (gateAtClose(gate) === "existing") {
        keepLock.current = false;
        setKeepingDraft(false);
        consumeDraft(true);
        return onClose();
      }
    }
    // 새 명함인데 앞 저장(닫기 · 자동 저장)의 응답을 잃었으면 목록이 서버에 남은 그 명함을 찾아 이어 써요(중복 「작성 중」 방지)
    const ok = await onKeepDraft(keep, lostRef.current);
    keepLock.current = false;
    setKeepingDraft(false);
    if (ok) return onClose();
    if (!keep.remove && !keep.id) lostRef.current = addLost(lostRef.current, keep.input);
    setKeepFailed(true);
    // 창에 남아 계속 고칠 수 있어요 — 자동 저장도 다시 켜요(바뀐 것이 있을 때만 다시 남겨요)
    release?.();
  }
  /** [그래도 닫기] — 지금 값은 남기지 않고 닫아요(직원이 고른 경우만). 자동 저장이 이미 남긴 앞 값은 그대로 「작성 중」에 남아요 */
  const closeWithoutKeeping = () => {
    void autosaveRef.current?.stop();
    onClose();
  };

  // 칸에 내용이 있거나 명함 사진이 있는 동안 새로고침 · 탭 닫기 · 주소 이동이면 브라우저 확인 창(UG-451 기획 16991).
  // 계정을 만든 뒤 결과 화면(mailFailure)은 남길 것이 없어 묻지 않아요. 세션 만료로 로그인 화면에 갈 때도 떠요 — [머무르기]면 값을 보고 옮겨 적을 수 있어요.
  const unsaved = !mailFailure && !staleIssue && (!!photo || [company, name, email, phone].some((v) => v.trim() !== ""));
  useEffect(() => {
    if (!unsaved) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // 옛 브라우저(Safari 일부)는 returnValue 를 채워야 물어요
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [unsaved]);

  // ── 「작성 중」 자동 저장(UG-451 기획 17009) ──
  // 아이패드 Safari 는 새로고침 · 탭 닫기 때 위 확인 창을 띄우지 않아요. 그래서 명함 읽기 직후 · 입력이 멈출 때(2초) 서버의 「작성 중」 명함에 남겨 두고,
  // 새로고침 뒤에는 목록의 「작성 중」 줄에서 이어서 만들어요. 화면에는 아무것도 띄우지 않아요(칸도 잠그지 않아요) —
  // 실패하면 다음 변경 때 다시 하고, 닫을 때 저장(실패하면 「저장하지 못했습니다」)이 그대로 마지막 안전망이에요.
  // 남길 것은 닫을 때와 같은 draftToKeep — 주소를 고치는 중 · 결과 화면 · 보내는 중 · 계정을 만든 뒤에는 남기지 않고, 칸을 다 비우면(지울 것) 건너뛰어요.
  /**
   * 지금 남길 것과 내용 열쇠. anyEmail = 이메일 확인과 상관없이(이어서 만든 명함을 연 그대로인지 볼 때만)
   * 남겨도 되는지는 emailGate(draftSaveGate)가 open 일 때만이에요(반박 리뷰 F6 · UG-451 기획 17022 · 반박 리뷰 F3 · F4):
   * 칸 이메일 확인이 「새 계정」으로 끝나기 전 · 이미 있는 계정이면 남기지 않고, 칸이 비었거나 형식이 아니어도 명함 칩의 메일 주소를
   * 아직 확인하지 못했거나 그중 하나가 이미 있는 계정이면 남기지 않아요(명함을 읽은 바로 뒤 사진만 먼저 남던 것 포함).
   * 이어서 만든 명함도 그동안은 고쳐 쓰지 않아요(PUT 없음). 막히기 전에 이미 고쳐 쓴 이어서 만든 명함은 그대로 둬요 — 직원이 목록에서 정해요.
   * 이 창의 자동 저장이 만든 명함은 명함 칩 주소가 있는 계정으로 드러나면 바로(discardOwnDrafts), 칸 이메일만 있는 계정이면 닫을 때(close) 지워요.
   */
  function autosaveSnapshot(anyEmail = false) {
    const keep = draftToKeep();
    if (!keep || keep.remove) return null;
    if (!anyEmail && emailGate !== "open") return null;
    const key = draftContentKey(keep.input, memRef.current.serverPhoto);
    // 서버가 받지 않은 사진(너무 큼 · 형식)은 다시 올리지 않아요 — 바뀔 때마다 같은 큰 사진을 되풀이해 보내지 않게(F7)
    const input = keep.input.photo && photoTag(keep.input.photo) === rejectedPhotoRef.current ? withoutPhoto(keep.input) : keep.input;
    return { value: { id: keep.id, input, recreate: keep.recreate }, key };
  }
  /** 한 번 남기기 — 새로 남긴 명함 번호 · 올린 사진을 기억해 다음 저장이 같은 명함을 갱신하고 사진은 keepPhoto 로 보내요 */
  async function autosaveRun(keep: AutosaveItem): Promise<AutosaveResult> {
    const { id, input } = keep;
    let posted = !id;
    let out = await onAutosave(id, input, lostRef.current);
    // 이 창의 자동 저장이 만든 명함을 그사이 다른 직원이 지움 — 입력이 사라지지 않게 한 번 새로 남겨요(F5).
    // 이어서 만든 원래 명함이면 되살리지 않아요(계정을 만들었을 수 있어요).
    // 받아들인 한계(재검토 R4): 다른 직원이 그 명함으로 계정을 만들어 지워진 경우에도 한 번은 새로 남겨요(직원이 목록에서 지우면 돼요)
    if (id && keep.recreate && !out.res.ok && out.res.reason === "not_found" && !recreatedRef.current && !memRef.current.ended) {
      recreatedRef.current = true;
      posted = true;
      out = await onAutosave(null, keep.recreate, { since: lostRef.current.since, inputs: [] });
    }
    if (!openRef.current) onAutosaveSettled();
    if (out.photoDropped && out.sent !== input && input.photo) rejectedPhotoRef.current = photoTag(input.photo);
    // 번호부터 챙겨요(F1) — 그사이 명함이 끝났으면(계정을 만듦 · 다 씀) 방금 남긴 명함은 지워요
    const { result, orphan } = recordSave(memRef.current, out.sent, out.res);
    if (orphan) onDraftUsed(orphan);
    if (out.res.ok && result === "saved") {
      if (posted) ownIdsRef.current.add(out.res.draft.id);
      lostRef.current = { ...lostRef.current, inputs: [] };
    }
    // 새 명함 저장이 연결 · 서버 문제로 실패 — 서버엔 남았을 수 있어요(응답만 잃음). 다음 저장 때 찾아 이어 써요
    if (posted && !out.res.ok && out.res.reason === "failed") lostRef.current = addLost(lostRef.current, out.sent);
    return result;
  }
  /**
   * 명함 칩의 메일 주소가 이미 있는 계정이라 이 창의 자동 저장이 남긴 명함을 바로 지워요(UG-451 반박 리뷰 F3) — 창은 그대로 쓰고,
   * 나중에 칸 이메일이 「새 계정」으로 확인되면 새 명함으로 다시 남겨요. 이어서 만든 원래 명함은 지우지 않아요(ownDraftToDiscard).
   * 보내는 중인 자동 저장이 끝난 뒤에 지워요(지운 뒤 그 저장이 되살리지 않게). 응답을 잃은 새 명함도 찾아 지워요.
   */
  async function discardOwnDrafts() {
    const autosave = autosaveRef.current;
    if (!autosave || autosave.stopped) return;
    const release = await autosave.suspend();
    try {
      const mem = memRef.current;
      if (mem.ended) return;
      let id = ownDraftToDiscard(mem.id, ownIdsRef.current);
      if (!mem.id && lostRef.current.inputs.length > 0) {
        const found = await findLostDraft(lostRef.current, staffEmail, true);
        if (found.kind === "found") id = found.id;
        if (found.kind === "found" || found.kind === "none") lostRef.current = { ...lostRef.current, inputs: [] };
      }
      if (!id) return;
      if (mem.id === id) {
        mem.id = null;
        mem.serverPhoto = null;
      }
      autosave.forget(); // 지운 명함의 내용 — 다시 남길 때 같은 내용이어도 새로 남겨요
      onDraftUsed(id);
    } finally {
      release();
    }
  }

  // 일정표는 늘 마지막 그림의 값으로 남겨요
  const autosaveSnapshotRef = useRef(autosaveSnapshot);
  const autosaveRunRef = useRef(autosaveRun);
  const runCheckRef = useRef(runCheck);
  const checkChipEmailsRef = useRef(checkChipEmails);
  const discardOwnDraftsRef = useRef(discardOwnDrafts);
  useEffect(() => {
    autosaveSnapshotRef.current = autosaveSnapshot;
    autosaveRunRef.current = autosaveRun;
    runCheckRef.current = runCheck;
    checkChipEmailsRef.current = checkChipEmails;
    discardOwnDraftsRef.current = discardOwnDrafts;
  });
  useEffect(() => {
    const autosave = createAutosaver<AutosaveItem>({
      delayMs: AUTOSAVE_DELAY,
      snapshot: () => autosaveSnapshotRef.current(),
      save: (keep) => autosaveRunRef.current(keep),
    });
    // 응답을 잃은 저장은 이 창을 연 뒤 생긴 명함에서만 찾아요(F2)
    lostRef.current = { since: lostSince(), inputs: [] };
    // 이어서 만든 명함을 연 그대로면 다시 보내지 않아요 — 이메일 확인 전이라도(확인이 끝난 뒤 같은 값을 다시 보내지 않게)
    const first = autosaveSnapshotRef.current(true);
    if (first && memRef.current.id) autosave.markSaved(first.key);
    autosaveRef.current = autosave;
    openRef.current = true;
    return () => {
      openRef.current = false;
      autosaveRef.current = null;
      void autosave.stop();
    };
  }, []);
  // 칸 · 메일 언어 · 칩 연결 · 이메일 확인 결과가 바뀌면 — 2초 동안 더 바뀌지 않으면 남겨요(같은 내용이면 보내지 않아요).
  // 이메일 확인을 기다리는 중(확인 전 · 실패)이면 같은 때 확인도 다시 해요(조용히) — 확인이 끝나면(check) 다시 여기로 와 남겨요(UG-451 기획 17022).
  // 확인이 실패해도 check · 칸이 그대로라 저절로 되풀이하지 않아요 — 다음 변경 · 칸을 벗어날 때 · 닫을 때 다시 해요
  // 명함 칩의 메일 주소 중 아직 모르는 것(확인 실패 포함)도 같은 때 다시 물어요(반박 리뷰 F3)
  const unknownChipEmails = chipEmails.filter((address) => known[address] === undefined).join("\n");
  useEffect(() => {
    autosaveRef.current?.schedule();
    if (emailGate !== "wait" || fix || mailFailure) return;
    const timer = setTimeout(() => {
      if (EMAIL_RE.test(trimmed)) void runCheckRef.current(trimmed, true);
      if (unknownChipEmails) void checkChipEmailsRef.current(unknownChipEmails.split("\n"));
    }, AUTOSAVE_DELAY);
    return () => clearTimeout(timer);
  }, [company, name, email, phone, language, languageChosen, languageAuto, scan, check, known, emailGate, trimmed, unknownChipEmails, fix, mailFailure]);
  // 명함 칩의 메일 주소가 이미 있는 계정으로 드러나면(칸을 지워도 사진 · 칩에 남아요) 이 창의 자동 저장이 만든 명함을 바로 지워요(반박 리뷰 F3).
  // 칸 이메일이 「새 계정」으로 확인되면 다시 남겨요(draftSaveGate) — 지운 뒤에는 새 명함으로
  const chipsExisting = emailGate !== "open" && chipEmailsState(chipEmails, known) === "existing";
  useEffect(() => {
    if (chipsExisting) void discardOwnDraftsRef.current();
  }, [chipsExisting]);
  // 명함 읽기가 끝나면(읽지 못해도 사진은 남아요) 바로 — 사진은 이때 한 번 올리고 다음부터는 keepPhoto
  const [scanDone, setScanDone] = useState(0);
  useEffect(() => {
    if (scanDone > 0) autosaveRef.current?.saveNow();
  }, [scanDone]);
  // 재설정 메일 확인 창(UG-421)이 떠 있는 동안은 멈춰 둬요 — 보내면 명함을 다 써서 지워요(consumeDraft, F1)
  useEffect(() => {
    if (!resetConfirm) return;
    return autosaveRef.current?.hold();
  }, [resetConfirm]);

  /** 명함이 끝났어요(계정을 만듦 — 서버가 draftId 의 명함을 지웠어요) — 자동 저장을 끄고 더 남기지 않아요 */
  function endDraft() {
    const mem = memRef.current;
    mem.ended = true;
    mem.id = null;
    mem.serverPhoto = null;
    void autosaveRef.current?.stop();
  }

  /**
   * 이어서 만든 · 자동 저장한 명함을 다 썼어요(이미 만든 계정에 안내 메일 · 재설정 메일을 보냄) — 목록의 「작성 중」 줄 · 사진은 목록이 뒤에서 지워요.
   * 자동 저장을 먼저 끄고(보내는 중이면 끝난 뒤 — 그 저장이 남긴 명함은 recordSave 가 지울 것으로 돌려줘요) 지워요.
   * 응답을 잃은 새 명함도 찾아 지워요(F1 — 이미 있는 고객의 개인정보가 「작성 중」에 30일 남지 않게).
   * ownOnly = 이미 있는 계정의 이메일이라 남기지 않고 닫음(UG-451 기획 17022) — 이 창의 자동 저장이 만든 명함만 지우고 이어서 만든 원래 명함은 그대로
   */
  function consumeDraft(ownOnly = false) {
    const mem = memRef.current;
    if (mem.ended) return;
    mem.ended = true;
    const autosave = autosaveRef.current;
    void (async () => {
      await autosave?.stop();
      let id = ownOnly ? ownDraftToDiscard(mem.id, ownIdsRef.current) : mem.id;
      if (!mem.id) {
        const found = await findLostDraft(lostRef.current, staffEmail, true);
        if (found.kind === "found") id = found.id;
      }
      mem.id = null;
      mem.serverPhoto = null;
      if (id) onDraftUsed(id);
    })();
  }

  /**
   * 계정 만들기 요청에 붙일 「작성 중」 명함 번호 — 계정이 만들어지면 서버가 그 명함을 지워요(이어서 만든 명함 · 자동 저장이 남긴 명함).
   * 자동 저장을 멈춘 뒤에 불러요. 새 명함 저장의 응답을 잃었으면 서버에 남은 그 명함을 찾아 붙여요(계정을 만든 뒤 「작성 중」이 남지 않게) —
   * 하나로 정해질 때만(F2). 찾지 못했거나 목록을 받지 못했으면 기억은 그대로 둬요(받지 못함 ≠ 없음).
   */
  async function draftIdInput(): Promise<{ draftId?: number }> {
    const mem = memRef.current;
    if (mem.ended) return {};
    if (!mem.id && lostRef.current.inputs.length > 0) {
      const found = await findLostDraft(lostRef.current, staffEmail);
      if (found.kind === "found") {
        mem.id = found.id;
        mem.serverPhoto = null; // 찾은 명함의 사진은 모르니 다음 저장은 사진을 다시 올려요
        lostRef.current = { ...lostRef.current, inputs: [] };
      }
    }
    const n = mem.id ? Number(mem.id) : NaN;
    return Number.isSafeInteger(n) ? { draftId: n } : {};
  }

  const pending = current?.status === "pending" ? current : null;
  const inUse = current?.status === "in_use";
  // 해지 중인 계정(UG-443 기획 16908) — 사용 중처럼 막되 까닭을 다르게
  const closing = current?.status === "closing";
  // 마지막 발송이 주소 오류였거나(3번 막힘 포함) 다시 보내기를 막은 계정 — 다시 보내기 대신 발급 취소를 안내해요(목록과 같은 규칙).
  // 이 창에서 만들거나 보내다 실패한 게 아니라 조회로 알게 된 경우라, 고쳐 재발송(fix)으로 넘기지 않아요 — 다른 이메일을 치면 새로 만들기예요.
  const blocked = !!pending && (pending.resendBlocked === true || pending.mailFailureReason === "address");
  // 고치는 중인 계정의 주소 그대로인지 — 그대로면 다시 보내도 또 실패하니 발급 취소만
  const fixSame = !!fix && key.toLowerCase() === fix.email.toLowerCase();
  // 고친 주소가 다른 첫 로그인 전 계정의 것 — 그 계정과 섞이지 않게 막아요
  const fixTaken = !!fix && !fixSame && !!pending;
  // 고치는 중인 옛 발급의 링크가 이미 막혔어요(반박 리뷰 M1) — 고치는 대상이 새 계정으로 바뀌면 사라져요
  const oldRevoked = !!fix && revokedOldId === fix.id;

  useEffect(() => {
    if (!pending && langBeforePending.current) {
      setLanguage(langBeforePending.current);
      langBeforePending.current = null;
    }
  }, [pending]);

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

  /** 만들기 · 재발송이 「이미 있음」으로 막힌 뒤 다시 조회해 칸 아래에 보여 줘요. 네트워크 · 서버 문제면 버튼 위 안내. */
  async function recheck() {
    try {
      const result = await checkEmail(trimmed);
      setChecked(key, result);
      if (result.status === "pending") pickPendingLanguage(result.language);
    } catch (e) {
      if (isNetworkError(e)) setFormError(NETWORK_FAILED);
      else setEmailError(CHECK_FAILED);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // 명함을 읽는 동안에는 보내지 않아요 — 읽은 값이 보낸 뒤에 칸을 바꾸지 않게
    // 「작성 중」 저장을 기다리는 동안에도 보내지 않아요(Enter 포함)
    if (busy.current || scanning || keepingDraft) return;
    busy.current = true;
    try {
      await submit();
    } finally {
      busy.current = false;
      // 보내기 전에 멈춘 자동 저장을 풀어요 — 닫을 때 저장 등 다른 멈춤이 남아 있으면 그대로 멈춰 있어요(F3).
      // 계정을 만들었거나 명함을 다 썼으면 이미 꺼져 아무것도 하지 않아요
      submitHold.current?.();
      submitHold.current = null;
    }
  }

  /**
   * 계정 만들기에 함께 보낼 명함 사진(UG-455) — 창에 있는 사진(JPEG)을 data: 접두사 없이. 서버가 한 번 받지 않은 사진(rejectedPhotoRef)은 빼요
   */
  function photoInput(): { photo?: string } {
    const b64 = photoForDraft(photo);
    return b64 && photoTag(b64) !== rejectedPhotoRef.current ? { photo: b64 } : {};
  }

  /**
   * 주소 고쳐 새로 만들기에 붙일 원래 기록 번호(UG-455) — 서버가 그 기록의 명함 사진을 새 계정으로 옮기고, 같은 요청에서 그 기록을
   * 발급 취소해요(cancelSource, 기획 17099-7 — 요청은 한 번만 보내고 순서는 서버가 책임져요). 번호를 읽지 못하면 빼요(그때는 전처럼 화면이 따로 취소)
   */
  function sourceIssuanceInput(wrong: Account): { sourceIssuanceId?: number; cancelSource?: true } {
    const n = Number(wrong.id);
    return Number.isSafeInteger(n) && n > 0 ? { sourceIssuanceId: n, cancelSource: true } : {};
  }

  /** 고친 주소로 재발송(I3 · C3 · M8b): 한 요청으로 새 계정을 만들어 보내고 잘못된 주소의 계정은 발급 취소해요(서버가 함께 처리 — recreate.ts). */
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
    if (!state && checkFailure.current === "network") {
      // 네트워크 · 서버 문제 — 칸 아래 대신 버튼 위에 「다시 눌러 주세요」(UG-451 기획 16991)
      setEmailError("");
      setFormError(NETWORK_FAILED);
    }
    if (!state || state.status !== "new") return emailRef.current?.focus(); // 사용 중 · 다른 발급 기록 · 조회 실패 — 칸 아래 안내

    setSending(true);
    // 명함 사진은 다시 보내지 않아요(UG-455 반박 리뷰 M1) — 잘못된 계정에 남은 사진이 있으면 서버가 처음 받은 시각 그대로 새 계정에 옮겨요.
    // 다시 보낸 사진은 받은 시각이 「지금」이 되어 보관 기간이 밀려요. 사진이 없는 기록(조회로 만난 기록 포함)은 아무것도 남기지 않아요
    const res = await createAccount({
      company: fixCompany,
      email: trimmed,
      language: wrong.language,
      ...personInput(fixName, fixPhone),
      ...sourceIssuanceInput(wrong),
    });
    if (!res.ok) {
      setSending(false);
      // 옛 발급의 링크는 이미 막혔다고 서버가 알려 왔어요(반박 리뷰 M1) — 아래 실패 안내에 더해 알리고 [발급 취소]를 둬요
      if (oldIssueRevoked(res)) setRevokedOldId(wrong.id);
      if (res.reason === "duplicate" || res.reason === "in_use") {
        // 그사이 상태가 바뀌었어요 — 서버에 다시 물어 칸 아래에 보여 줘요.
        // (runCheck 는 이 렌더의 조회 결과 「new」를 그대로 돌려줘서 다시 묻지 않아요.)
        await recheck();
        return emailRef.current?.focus();
      }
      if (res.reason === "closing") {
        // 해지 처리 중인 이메일(UG-458 기획 5) — 칸 아래 「해지 처리 중인 이메일이에요…」, 보내기 버튼은 꺼요
        setChecked(key, { status: "closing" });
        return emailRef.current?.focus();
      }
      if (res.reason === "domain") {
        // 도메인 확인에 걸려 새 계정을 만들지 않았어요 — 잘못된 주소의 계정도 그대로 두고 이 창에서 다시 고쳐요
        setEmailError(DOMAIN_ERROR_TEXT);
        return emailRef.current?.focus();
      }
      // 옛 발급을 취소할 수 없어(고객이 이미 로그인 · 해지 중) 서버가 새 계정을 만들지 않았어요(기획 17099-7)
      if (res.reason === "source_blocked") return setFormError(RECREATE_TEXT.sourceBlocked);
      return setFormError(res.reason === "network" ? CREATE_NETWORK_FAILED : "계정을 만들지 못했습니다. 다시 시도해 주세요.");
    }
    // 잘못된 주소의 옛 발급은 서버가 같은 요청에서 취소했어요(기획 17099-7). 예전 서버(결과를 주지 않음)면 전처럼 화면이 따로 취소해요.
    // 어느 쪽이든 옛 발급이 남았으면 「계정을 만들었습니다」로만 끝내지 않고 알려요 — 창에 남아 다시 취소할 수 있게
    const old = oldIssueAfterCreate(res.sourceCancel);
    const left =
      old === "left" ||
      (old === "legacy" && oldIssueLeft(await cancelIssue(wrong.id).catch(() => ({ ok: false as const, reason: "failed" as const }))));
    setSending(false);
    // 앞서 만든 계정의 사진 저장이 실패했으면 새 계정에도 사진이 없어요 — 같은 줄을 보여 줘요(화면 반박 리뷰 3)
    const notice: CreatedNotice = { photoNotSaved: cardPhotoNotSaved(res, photoLostRef.current) };
    photoLostRef.current = notice.photoNotSaved === true;
    if (res.mailSent) {
      setPhoto(null); // 고쳐 재발송이 끝났어요 — 창의 명함 사진은 비워요(잘못된 계정에 남은 사진은 서버가 새 계정으로 옮겨요, UG-455)
      if (left) return setStaleIssue({ old: wrong, fresh: res.account, created: res.account, notice });
      return onCreated(res.account, notice);
    }
    if (left) setStaleIssue({ old: wrong, fresh: res.account, created: null, notice: {} });
    if (res.mailFailureReason === "address") {
      // 고친 주소도 받지 않음 — 새 계정을 고치는 대상으로 바꿔 같은 창에 남아요(사진도 남겨 다시 비교)
      setFix(res.account);
      return onMailFailed(res.account, notice);
    }
    setFix(null);
    setPhoto(null); // 계정은 만들어졌고 더 고칠 주소가 없어요(결과 화면) — 창의 사진은 비워요(잘못된 계정에 남은 사진은 서버가 새 계정으로 옮겨요)
    setMailFailure({ account: res.account, reason: res.mailFailureReason });
    return onMailFailed(res.account, notice);
  }

  /** 옛 발급 취소 안내를 닫아요(다시 취소했거나 [닫기]) — 메일까지 보낸 새 계정이면 완료 알림과 함께 창을 닫고, 아니면 그 결과 화면 · 주소 고치기로 */
  function finishStale() {
    const stale = staleIssue;
    setStaleIssue(null);
    if (stale?.created) onCreated(stale.created, stale.notice);
  }

  async function submit() {
    // 명함에서 잘못 읽었을 수 있는 주소 그대로면 보내지 않아요 — 칸 아래 경고가 이미 떠 있어요(반박 리뷰 F2)
    if (suspectBlocked) return emailRef.current?.focus();
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
    // 조회가 실패했으면(state 없음) 그 안내를 남겨요 — 예전에는 lookup 이 띄운 「이메일을 확인하지 못했습니다」를
    // 바로 아래 setEmailError("") 가 지워, 버튼을 눌러도 아무 안내 없이 끝났어요(UG-451 기획 16991).
    // 네트워크 · 서버 문제면 버튼 위에 「연결이 불안정해…」, 그 밖이면 칸 아래 「이메일을 확인하지 못했습니다」.
    const checkFailed = !eError && !state;
    const networkFailed = checkFailed && checkFailure.current === "network";
    if (checkFailed && !networkFailed) eError = CHECK_FAILED;
    setCompanyError(cError);
    setNameError(nError);
    setEmailError(eError);
    setPhoneError(pError);
    setFormError(networkFailed ? NETWORK_FAILED : "");
    // 초점은 화면 순서대로: 회사명 → 이름 → 고객 이메일 → 연락처
    if (cError) return companyRef.current?.focus();
    if (nError) return nameRef.current?.focus();
    if (eError) return emailRef.current?.focus();
    if (pError) return phoneRef.current?.focus();
    if (!state) return emailRef.current?.focus(); // 조회 실패 — 칸 아래 · 버튼 위 안내

    if (state.status === "in_use" || state.status === "closing") return;
    // 막힌 계정 · 주소 오류 기록은 다시 보내지 않아요 — 창에 「닫기」 · 「발급 취소」만 있어요(Enter 로 제출해도 그대로).
    // 화면의 blocked 와 같은 규칙: 조회로 알게 된 주소 오류 기록에 다시 보내 고치는 모드로 들어가지 않게(16687)
    if (state.status === "pending" && (state.resendBlocked || state.mailFailureReason === "address")) return;

    setSending(true);
    // 자동 저장을 멈추고 보내는 중이면 끝날 때까지 기다려요 — 자동 저장이 새로 남긴 명함 번호까지 계정 만들기에 붙여 서버가 지우게 하고,
    // 계정을 만드는 사이에 새 「작성 중」이 생기지 않게(UG-451 기획 17009)
    submitHold.current = (await autosaveRef.current?.suspend()) ?? null;
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
      if (res.reason === "in_use" || res.reason === "not_found") setChecked(key, null); // 상태가 바뀌었어요 — 칸을 벗어나면 다시 조회해요
      // 그사이 해지가 시작됐어요(UG-443) — 이 이메일을 해지 중으로 바꿔 보내기 버튼을 꺼요
      if (res.reason === "closing") setChecked(key, { status: "closing" });
      return;
    }
    const sentPhoto = photoInput();
    const res = await createAccount({ ...input, ...(await draftIdInput()), ...sentPhoto });
    if (res.ok && res.photoRejected && sentPhoto.photo) rejectedPhotoRef.current = photoTag(sentPhoto.photo);
    setSending(false);
    if (res.ok) {
      endDraft(); // 계정이 만들어졌어요(메일 실패 포함) — 서버가 「작성 중」 명함을 지웠어요
      // 서버가 명함 사진을 받지 않았거나 저장하지 못했으면 알려요(기획 17099-5) — 정책상 남기지 않은 경우 · 사진 없이 만든 경우는 아무 표시 없음
      const notice: CreatedNotice = { photoNotSaved: cardPhotoNotSaved(res) };
      photoLostRef.current = notice.photoNotSaved === true; // 주소를 고쳐 재발송한 완료 알림에도 이어서 알려요(화면 반박 리뷰 3)
      if (res.mailSent) {
        setPhoto(null); // 계정을 만들었어요 — 창의 명함 사진은 비워요(사진은 계정과 함께 서버에 남아요, UG-455)
        return onCreated(res.account, notice);
      }
      // 주소 오류는 같은 창에서 이메일 칸에 안내하고 고쳐 재발송하게 해요(I2) — 고치는 동안 명함 사진은 남겨 비교해요
      if (res.mailFailureReason === "address") setFix(res.account);
      else {
        setPhoto(null); // 고칠 주소가 없는 실패(결과 화면) — 창의 사진은 비워요(서버에는 계정과 함께 남아요)
        setMailFailure({ account: res.account, reason: res.mailFailureReason });
      }
      return onMailFailed(res.account, notice);
    }
    if (res.reason === "duplicate" || res.reason === "in_use") {
      // 조회와 보내기 사이에 상태가 바뀐 경우: 다시 조회해서 칸 아래에 보여 줘요.
      await recheck();
      emailRef.current?.focus();
    } else if (res.reason === "closing") {
      // 조회와 보내기 사이에 해지가 시작됐어요(UG-458 기획 5) — 칸 아래 「해지 처리 중인 이메일이에요…」, 보내기 버튼은 꺼요
      setChecked(key, { status: "closing" });
      emailRef.current?.focus();
    } else if (res.reason === "domain") {
      // 도메인 확인에 걸려 계정을 만들지 않았어요 — 창은 닫지 않고 이메일 칸 아래에 안내해요
      setEmailError(DOMAIN_ERROR_TEXT);
      emailRef.current?.focus();
    } else setFormError(res.reason === "network" ? CREATE_NETWORK_FAILED : "계정을 만들지 못했습니다. 다시 시도해 주세요.");
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
  /** 다음 칩이 들어갈 칸을 진하게(UG-453 기획 5) — 터치 기기에서 초점 없이 정한 대상 칸. 읽은 줄(칩)이 보일 때만 */
  // 읽은 줄을 보여 주는지(UG-451 기획 17100) — 펼쳤을 때. 메일 주소를 채우지 못하면 펼친 채로 시작하고(규칙 4),
  // 직원이 주소를 직접 넣은 뒤 접을 수 있게 「읽은 줄 접기」를 늘 보여 줘요(UG-463 기획 요청 5 — 전에는 메일을 못 읽으면 접을 수 없었어요)
  const chipsShown = !!scan && chipsOpen;
  const targetClass = (field: ScanField) =>
    scan && !fix && chipsShown && chipTarget === field && !lockedFields.includes(field) ? " is-target" : "";
  // 터치 기기 — 칩 안내 문구 · 낭독기 대상 칸 알림(UG-453 리뷰 m2 · nit)
  const touchPrimary = isTouchPrimary();
  const targetLabel = chipTarget && targetClass(chipTarget) ? CHIP_TARGET_LABEL[chipTarget] : null;

  /** 이메일 칸 값 바꾸기 — 직접 칠 때와 명함 · 칩으로 넣을 때가 같은 정리를 해요(앞 기록의 안내가 남지 않게). */
  // companyNow = 지금 회사명 칸 값(명함으로 함께 채울 때는 새 값 — 옛 기록 회사명이 명함 회사명을 덮지 않게)
  function changeEmail(value: string, companyNow: string = company) {
    setEmail(value);
    // 칸이 바뀌면 「명함과 같은 주소예요」 확인은 풀려요 — 아직 의심 값이면 경고가 다시 떠요(UG-451 기획 17030)
    setConfirmedEmail(null);
    // 주소 오류 기록에서 주소를 고쳐 새로 만들 때: 회사명이 비어 있으면 그 기록의 회사명을 미리 채우고,
    // 메일 언어도 그 기록의 언어로 둬요(둘 다 고칠 수 있어요)
    if (!fix && blocked && pending) {
      if (pending.company && !companyNow.trim()) setCompany(pending.company);
      langBeforePending.current = null;
    }
    if (emailError) setEmailError("");
    if (formError) setFormError("");
    if (cancelError) resetCancelError();
    // 이메일이 바뀌면 재설정 확인 창의 전제(그 이메일이 사용 중)가 깨져요 — 직원이 다시 누를 때까지 열지 않아요
    setResetConfirm(false);
    setResetReturned(false);
    if (value.trim()) setEmailMissing(null);
  }

  /**
   * 「명함과 같은 주소예요」(UG-451 기획 17030) — 지금 칸 값을 직원이 명함과 견줘 맞다고 확인했어요. 그 값 그대로인 동안 경고 · 막음을 풀어요.
   * 버튼이 사라지니 초점은 이메일 칸으로 돌려요(기획 17072-2) — 실행 버튼으로 옮기면 Enter 두 번에 바로 메일이 나가요.
   * 휴대폰 · 아이패드도 커서를 이메일 칸에 둬요(기획 17100 — 키보드가 올라와요). 누른 그 자리에서 바로 초점을 줘요 — 아이폰은 누른 동작 안에서 준
   * 초점에만 키보드를 올려요 — 버튼이 사라진 뒤(그린 다음)에도 한 번 더 맞춰요(focusAfterConfirm).
   * 이메일 칸에 커서가 있어도 확인한 주소는 다음 글자 칩이 덮지 않아요(UG-453 리뷰 m3 의 사고) — onChip 이 그 칩을 이메일 칸에 넣지 않아요.
   */
  function confirmSuspect() {
    setConfirmedEmail(email);
    emailRef.current?.focus();
    focusAfterConfirm.current = true;
  }

  /**
   * 칸에서 Enter 로는 메일을 보내지 않아요(UG-451 기획 17073-5) — 메일은 실행 버튼으로만. 폼의 Enter 보내기(implicit submit)를 막고
   * 회사명 → 이름 → 이메일 → 연락처 순으로 다음 칸에 초점(고칠 수 없는 칸은 건너뛰어요), 연락처(마지막)에서는 칸을 빠져 키보드를 닫아요.
   * 한글 조합 중 Enter(조합 끝내기)는 건드리지 않아요.
   */
  function onFormKeyDown(e: React.KeyboardEvent<HTMLFormElement>) {
    if (e.key !== "Enter" || !(e.target instanceof HTMLInputElement)) return;
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    const order = [companyRef.current, nameRef.current, emailRef.current, phoneRef.current];
    const at = order.indexOf(e.target);
    const next = at === -1 ? undefined : order.slice(at + 1).find((el) => el && el.isConnected && !el.readOnly && !el.disabled);
    if (next) next.focus();
    else e.target.blur();
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
    setChipTarget(null); // 초점이 간 칸은 칸 테두리(초점)로 보여요
  };
  /** at = 이벤트 시각(e.timeStamp) */
  const onFieldBlur = (field: ScanField, at: number) => {
    if (cursor.current?.field === field && !cursor.current.virtual) cursor.current = { field, blurredAt: at };
  };
  /** 지금(now = 이벤트 시각) 커서가 있는 칸. 칩을 눌러 방금(0.5초 안) 빠진 칸도 커서로 봐요 — 다른 곳을 눌러 빠졌으면 커서 없음. */
  function cursorField(now: number): ScanField | null {
    const c = cursor.current;
    if (!c) return null;
    // 초점 없이 정한 대상 칸은 그 칸이 잠기지 않았으면 그대로(잠긴 칸이면 칩 규칙의 빈 칸 고르기로)
    if (c.virtual) return lockedFields.includes(c.field) ? null : c.field;
    return c.blurredAt === null || now - c.blurredAt < 500 ? c.field : null;
  }

  /**
   * 다음 칩이 들어갈 칸으로 커서를 옮겨요(UG-453 기획 5). PC 는 그 칸에 초점(전처럼 커서가 보여요).
   * 터치 기기는 키보드가 올라와 칩을 가리지 않게 초점을 주지 않고 그 칸만 진하게 보여 줘요 — 다른 칸에 키보드가 올라와 있었으면 내려요(두 칸이 함께 진해 보이지 않게).
   * field = null(다 참)이면 PC 는 초점을 그대로 두고, 터치 기기는 진하게 보인 칸을 지워요.
   */
  function moveChipTarget(field: ScanField | null) {
    if (!isTouchPrimary()) {
      if (field) fieldRef[field].current?.focus();
      return;
    }
    const active = document.activeElement;
    const target = field ? fieldRef[field].current : null;
    if (active instanceof HTMLInputElement && active !== target && Object.values(fieldRef).some((r) => r.current === active)) active.blur();
    if (field) cursor.current = { field, blurredAt: null, virtual: true };
    else if (cursor.current?.virtual) cursor.current = null;
    setChipTarget(field);
  }
  /** 명함을 다시 읽으면 커서 · 진하게 보인 칸을 지워요 */
  function clearChipTarget() {
    cursor.current = null;
    setChipTarget(null);
  }

  /**
   * 「읽은 줄 모두 보기 (n)」 · 「읽은 줄 접기」(UG-451 기획 17100 규칙 3). 터치 기기는 펼칠 때 다음 칩이 들어갈 칸을 정해 진하게 보여 주고
   * (칸에 키보드가 올라와 있으면 그 칸이 대상이라 그대로), 접으면 초점 없이 정한 대상 칸을 지워요. PC 는 커서가 있는 칸 그대로예요.
   */
  function toggleChips() {
    const open = !chipsOpen;
    setChipsOpen(open);
    if (!isTouchPrimary()) return;
    if (!open) {
      if (cursor.current?.virtual) clearChipTarget();
      return;
    }
    const active = document.activeElement;
    if (Object.values(fieldRef).some((r) => r.current === active)) return;
    const next = nextChipTarget(null, null, { company, name, email, phone }, lockedFields);
    if (next) cursor.current = { field: next, blurredAt: null, virtual: true };
    setChipTarget(next);
  }

  function onChip(chip: Chip, now: number) {
    if (!scan) return;
    let at = cursorField(now);
    // 「명함과 같은 주소예요」로 확인한 주소가 그대로 있는 이메일 칸에는 글자 칩을 넣지 않아요(UG-451 기획 17100) — 확인 뒤 커서가 이메일 칸에 남아도
    // 다음 글자 칩이 확인한 주소를 덮지 않게, 커서가 없을 때처럼 회사명 → 이름 중 빈 칸으로 가요. 메일 칩은 전처럼 이메일 칸을 바꿔요(직원이 고른 주소)
    const confirmedHere = confirmedEmail !== null && trimmed !== "" && confirmedEmail.trim().toLowerCase() === trimmed.toLowerCase();
    if (at === "email" && chip.kind === "other" && confirmedHere) at = null;
    const values = { company, name, email, phone };
    const r = tapChip(chip, scan.links, values, at, lockedFields);
    setScan({ ...scan, links: r.links });
    if (r.set) putField[r.set.field](r.set.value);
    // 넣었으면 다음 빈 칸으로(UG-453 기획 5 — 전에는 커서가 있던 칸에 남아 이름 칸에 회사명이 들어갔어요).
    // 메일 · 전화 칩이 제 칸에 들어갔으면 비어 있는 커서 칸은 그대로. 넣지 않았으면 칩 규칙이 정한 칸(없으면 있던 칸)
    const next = r.set ? nextChipTarget(r.set, at, { ...values, [r.set.field]: r.set.value }, lockedFields) : (r.focus ?? at);
    moveChipTarget(next);
  }

  /**
   * 명함 사진을 읽어 네 칸을 채워요(동작 규칙 1~4 · 칩 규칙 1 · 7 · 자동 채움 규칙 M16 · M17). 원본은 이 함수 안에서만 읽고 버려요(서버로는 줄인 사진만 보내고, 못 읽으면 기기 안에서 읽어요 — UG-463).
   * 줄인 비교용 사진만 창에 두고, 만들지 않고 닫으면 「작성 중」 명함으로 서버에 남겨요(기획 16864).
   * 이메일 · 연락처는 모양이 맞으면, 회사명 · 이름은 확실할 때만 채워요(UG-451 기획 17100 — card-scan.ts scanCard). 애매하면 비워 둬요.
   * 읽은 값은 비어 있는 칸 · 앞 명함이 자동으로 채우고 직원이 손대지 않은 칸에만 넣어요(UG-451 기획 16991 · 17100 규칙 5) —
   * 읽는 동안 직원이 친 값 · 직원이 고친 값 · 칩을 눌러 넣은 값은 그대로 둬요. 다시 찍으면 칩 목록은 늘 바꿔요.
   * 찍힌 방향으로 이메일 · 연락처를 하나도 못 찾으면 돌려서 다시 읽어요(기획 17106-3 — card-ocr.ts). 그래도 못 찾으면 「명함을 읽지 못했습니다」 —
   * 깨진 줄(칩)은 보여 주지도 남기지도 않고, 칸은 그대로 두고 안내만 해요(기획 17106-1 · 2).
   */
  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const file = input.files?.[0];
    input.value = ""; // 입력 칸이 사진을 붙잡고 있지 않게(같은 사진을 다시 골라도 다시 읽어요)
    if (!file) return;
    // 보내는 중이거나 주소를 고치는 중(fix)에 늦게 온 사진은 받지 않아요 — 고치는 동안 보던 사진을 지우거나,
    // 결과 화면 뒤에 사진이 메모리에 남지 않게
    if (sending || fix || fixRef.current || keepingDraft) return;
    // 이 읽기의 차례 번호 — 돌려 읽는 동안 다시 찍으면 앞 읽기(card-ocr 가 끊어요)의 늦은 결과 · 상태 정리는 아래에서 버려요
    const gen = ++scanGen.current;
    const live = () => gen === scanGen.current;
    // 다시 찍기인지(앞 명함의 사진 · 읽은 줄 · 못 읽음 안내가 있음)와 앞 명함의 칩 — 다른 사람 명함인지 볼 때 써요(UG-451 기획 17118-1)
    const retake = photo !== null || scan !== null || scanFailed !== null;
    const prevChips = scan?.chips ?? [];
    // 앞 명함 사진은 바로 비워요 — 이번 읽기가 실패해도 앞 명함 사진이 이번 고객 것처럼 남지 않게
    setPhoto(null);
    setScanning(true);
    setScanFailed(null);
    setScanProgress(null);
    setScanRetry(null);
    let text: string | null = null;
    let lines: OcrLine[] | null = null;
    let preview: string | null = null;
    let failure: ReadFailure | null = null;
    // 「바로 놓인 명함인지 모르는데 연락처만 찾은」 읽기의 번호를 믿을지 — 돌려 읽기가 정해 줘요(반박 리뷰 후속 1)
    let lonePhone = true;
    // 서버가 먼저 읽어요(UG-463, card-read.ts) — 줄인 사진을 보내 네 칸 값만 받아요. 서버가 읽지 못하면(꺼짐 503 · 404 · 오류 · 네트워크 · 25초)
    // null 이고 아래 기기 안 읽기를 전과 똑같이 해요. 25초가 지나 넘어간 뒤 늦게 온 서버 답은 card-read 가 버려요(한 번만 채워요).
    // 서버가 「없음」(503 · 404)이라 답했으면 이 페이지에서는 묻지 않고 바로 기기 안에서 읽어요
    let server: ServerReading | null = null;
    if (serverReadAvailable()) {
      const ctrl = new AbortController();
      serverAbort.current = ctrl;
      setScanServer(true);
      try {
        server = await readOnServer(file, readCardOnServer, ctrl.signal);
      } catch {
        server = null;
      } finally {
        if (serverAbort.current === ctrl) serverAbort.current = null;
        if (live()) setScanServer(false);
      }
      // 창을 닫았거나 주소를 고치는 모드로 바뀌었으면 여기서 끝 — 기기 안 읽기도 하지 않아요
      if (!live() || !openRef.current || fixRef.current) {
        if (live()) setScanning(false);
        return;
      }
    }
    if (server) {
      setScanning(false);
      preview = server.preview;
    } else {
      try {
        ({ text, lines, preview, failure, lonePhone } = await reader.read(file, (percent) => live() && setScanProgress(percent), {
          // 한 방향으로 읽은 결과의 점수 — 이메일 · 연락처를 하나도 못 찾았고 바로 놓인 명함으로 보이지도 않으면 다른 방향으로 다시 읽어요.
          // 바로 놓인 명함인지 모르는데 연락처만 찾은 것(weak — 거꾸로 읽힌 번호일 수 있어요)도 다른 방향을 읽어 봐요.
          // 글자가 거의 없는 사진(뒷면 · 빈 사진)은 돌리지 않아요(card-rotate.ts needsRetry)
          judge: (readText, readLines) => {
            const r = scanCard(readText, readLines);
            return { found: r.found, candidate: r.outcome === "unsure" || r.upright, confidence: r.confidence, sparse: r.sparse, weak: r.weak };
          },
          onRetry: (attempt, total) => live() && setScanRetry({ attempt, total }),
        }));
      } catch {
        text = null;
        failure = "read";
      } finally {
        // 새 읽기가 시작됐으면 그 읽기의 「읽는 중」 표시를 건드리지 않아요
        if (live()) {
          setScanning(false);
          setScanProgress(null);
          setScanRetry(null);
        }
      }
    }
    // 돌려 읽는 동안 다시 찍어 새 읽기가 시작됐거나 창을 닫았으면 이 결과는 버려요(반박 리뷰 4)
    if (!live() || !openRef.current) return;
    // 읽는 사이 주소를 고치는 모드로 바뀌었으면(보내기 결과) 늦게 온 결과는 버려요 — 고치는 계정의 칸을 바꾸지 않게
    if (fixRef.current) return;
    // 비교용 사진은 이번 명함으로 — 글자를 못 읽었어도(직접 입력할 때 보며 비교). 돌려 읽은 방향이 이겼으면 바로 세운 사진이에요
    // (서버가 읽었으면 찍힌 방향 그대로예요 — 서버는 돌아간 명함도 읽어요)
    setPhoto(preview);
    // 서버가 읽은 값은 기기 안 읽기의 결과 모양으로 바꿔 아래 같은 채우기 규칙을 써요(칩 없음 — 네 칸이 다 비면 「명함을 읽지 못했습니다」)
    const result = server ? serverScan(server.values) : text === null ? null : scanCard(text, lines, { lonePhone });
    const now = latestValues.current;
    // 비어 있거나 앞 명함이 자동으로 채운 그대로인 칸
    const untouched = (field: ScanField) => !now[field].trim() || autoFilled.current[field] === now[field];
    // 다시 찍은 명함이 다른 사람 것인지(UG-451 기획 17118-1, card-retake.ts) — 이메일이 앞 명함과 다르거나, 앞 명함에서 이메일을 읽었는데 새 명함에
    // 메일 모양 글자가 없으면(반박 리뷰 1) 직원이 넣은 값(회사명 · 이름 · 이메일 · 연락처)도 새 명함에 그대로 적혀 있지 않은 한 비우고 새 명함 값으로 채워요.
    // 같은 사람인지 알 수 없으면(새 사진에서 읽은 줄이 없음 · 앞 명함의 이메일을 모름) 그대로 두고 안내해요.
    // 처음 찍는 명함은 전 규칙 그대로예요(찍기 전 · 읽는 동안 직원이 친 값은 그대로)
    const staff: Partial<ScanValues> = {};
    for (const field of ["company", "name", "email", "phone"] as const) if (!untouched(field)) staff[field] = now[field];
    // 읽은 줄(칩)이 있는지 — 못 읽은 명함이어도 바로 놓인 명함의 또렷한 줄은 남아요(scanCard). 빈 사진 · 거꾸로 찍혀 깨진 줄뿐이면 없어요
    // 서버가 읽었으면 보여 줄 칩이 없어, 같은 사람인지 견줄 때만 네 칸 값으로 만든 칩을 써요(card-read.ts serverChips — 보여 주지도 남기지도 않아요)
    const nextChips = server ? serverChips(server.values) : (result?.chips ?? []);
    const verdict: RetakeVerdict = !retake
      ? "same"
      : retakeVerdict(
          { read: cardEmail.current, field: now.email, chips: prevChips },
          { email: result?.values.email ?? "", chips: nextChips, readable: nextChips.length > 0 },
        );
    const plan = retakePlan(verdict, staff, nextChips);
    const replaceable = (field: ScanField) => untouched(field) || plan.release.includes(field);
    // 메일 언어(규칙 6): 직원이 고르지 않았을 때만 — 한글 명함이면 「한국어」, 아니면 앞 명함이 골라 둔 「한국어」를 처음 값(English)으로 되돌려요.
    // 첫 로그인 전 이메일이라 언어를 잠깐 바꿔 둔 동안이면 되돌아갈 언어(langBeforePending)를 바꿔요.
    // reset = 다른 사람 명함으로 다시 찍음(기획 17118) — 직원이 앞 사람에게 맞춰 고른 언어 · 「작성 중」에 저장된 언어도 풀고 새 명함으로 다시 골라요
    const autoLanguage = (korean: boolean, reset = false) => {
      const lang = latestLanguage.current;
      if (!reset && (lang.chosen || (!korean && !lang.auto))) return;
      const next: MailLanguage = korean ? "ko" : "en";
      if (langBeforePending.current !== null) langBeforePending.current = next;
      else setLanguage(next);
      if (reset) setLanguageChosen(false);
      setLanguageAuto(korean);
      latestLanguage.current = {
        language: langBeforePending.current !== null ? lang.language : next,
        chosen: reset ? false : lang.chosen,
        auto: korean,
      };
    };
    // 서버가 읽은 결과는 칩이 없어도 읽은 것이에요 — 네 칸이 다 빈 것(unreadable)만 못 읽은 것
    if (!result || (!server && result.chips.length === 0) || result.outcome === "unreadable") {
      // 다시 찍은 명함(B)을 읽지 못함 — 사진은 B 인데 앞 명함(A)이 자동으로 채운 값으로 보내지지 않게(UG-451 반박 리뷰)
      // A 가 채우고 직원이 손대지 않은 칸은 비우고 A 의 칩도 지워요. 직원이 친 · 고친 값 · 칩을 눌러 넣은 값은 그대로예요.
      // 이메일 · 연락처를 하나도 못 찾은 명함(unreadable — 거꾸로 · 옆으로 찍힘, 명함이 아닌 사진)의 깨진 줄도 같아요(기획 17106-1):
      // 칩을 보여 주지 않고(scan = null — 「작성 중」에도 남지 않아요) 회사명 · 이름 · 메일 언어도 채우지 않아요. 「명함 다시 찍기」만 남아요.
      // 다만 바로 놓인 명함에서 이메일 · 연락처 모양만 못 찾은 것이면 scanCard 가 또렷이 읽은 줄의 칩만 돌려줘요(반박 리뷰 3) — 그 칩은 펼쳐 보여 주고
      // (직원이 눌러 넣어요) 안내는 같은 「명함을 읽지 못했습니다…」예요.
      // 또렷한 줄만 읽힌 다른 사람 명함(반박 리뷰 1)이면 직원이 넣은 값도 비워요(plan.release)
      let companyNow = now.company;
      const after = { ...now };
      for (const field of ["company", "name", "phone", "email"] as const) {
        const release = plan.release.includes(field);
        if (!release && (autoFilled.current[field] === undefined || !untouched(field))) continue;
        delete autoFilled.current[field];
        if (field === "email") changeEmail("", companyNow);
        else putField[field]("");
        if (field === "company") companyNow = "";
        after[field] = "";
      }
      // 앞 명함이 골라 둔 「한국어」는 처음 값(English)으로 되돌려요 — 직원이 고른 언어는 그대로, 다른 사람이면 그것도 풀어요
      autoLanguage(false, plan.verdict === "different");
      if (plan.verdict === "different") cardEmail.current = "";
      const kept = result && result.chips.length > 0 ? result.chips : null;
      setScan(kept ? { chips: kept, links: {} } : null);
      setServerRead(null);
      setChipsOpen(kept !== null);
      setConfirmedEmail(null);
      clearChipTarget();
      setEmailMissing(null);
      // 알 수 없으면 직원이 넣은 값은 그대로 남아요 — 이 명함의 것인지 확인해 달라고 알려요(기획 17118-1). 또렷이 읽은 줄에 그대로 있는 값은 빼요.
      // 다른 사람이면 지운 칸을 알려요
      setRetakeNoted(retakeNote(plan, after));
      setScanDone((n) => n + 1); // 읽지 못했어도 사진 · 비운 칸은 바로 남겨요(UG-451 기획 17009)
      // HEIC 는 도구 문제가 아니라 형식 문제 — 다시 찍게 안내해요(도구를 받지 못한 경우는 그 안내가 먼저).
      // 글자를 읽었으면 사진은 열린 것이라 HEIC 라도 형식 안내가 아니라 「읽지 못했습니다」(반박 리뷰). 서버가 읽었으면 사진은 열린 것이에요
      const opened = server !== null || (text !== null && /\S/.test(text));
      return setScanFailed(failure === "tool" || failure === "tool_reload" ? failure : !opened && isHeic(file) ? "format" : (failure ?? "read"));
    }
    // 처음 채우기 — 이메일 · 연락처와, 확실한 회사명 · 이름(기획 17100 규칙 1). 확실하지 않은 칸은 값이 ""라, 앞 명함이 채운 그대로인 칸은 비워져요
    const links: ScanLinks = {};
    const fill = (field: ScanField, put: (value: string) => void) => {
      if (!replaceable(field)) return false;
      const value = result.values[field];
      if (result.links[field] !== undefined) links[field] = result.links[field];
      if (value) autoFilled.current[field] = value;
      else delete autoFilled.current[field];
      put(value);
      return true;
    };
    const companyFilled = fill("company", putField.company);
    fill("name", putField.name);
    fill("phone", putField.phone);
    // 이메일은 마지막에 — 주소 오류 기록의 회사명 미리 채우기는 회사명 칸이 비었을 때만 채워요(명함이 방금 채운 회사명을 덮지 않게)
    const companyNow = companyFilled ? result.values.company : now.company;
    const emailFilled = fill("email", (value) => changeEmail(value, companyNow));
    autoLanguage(result.korean, plan.verdict === "different");
    // 이 명함에서 읽은 이메일을 기억해요(다음에 다시 찍을 때 견줘요). 못 채웠으면(잘렸을 수 있음) 앞 주소를 그대로 — 다른 사람으로 본 경우만 지워요
    if (result.values.email) cardEmail.current = result.values.email;
    else if (plan.verdict === "different") cardEmail.current = "";
    const after = { ...now };
    for (const field of plan.release) after[field] = result.values[field];
    setRetakeNoted(retakeNote(plan, after));
    // 칸에 남긴 값(직원 것)은 앞 명함 칩과의 연결만 풀려요 — 새 칩 목록에는 그 칩이 없어요.
    // 서버가 읽었으면 칩이 없어요(앞 명함의 칩도 지워요) — 서버가 채운 이메일은 기억해 「명함과 같은지 확인」 안내를 띄워요(칩에서 넣은 이메일과 같게)
    setScan(server ? null : { chips: result.chips, links });
    setServerRead(server ? { email: emailFilled && result.values.email ? result.values.email : null } : null);
    // 앞 명함과 견줘 한 「명함과 같은 주소예요」 확인은 새 명함에는 쓰지 않아요
    setConfirmedEmail(null);
    clearChipTarget();
    // 이메일 칸을 채우지 못함(N4 · M15) — 칸 아래 안내를 띄우고 읽은 줄을 펼쳐 둬요(규칙 4). 여기까지 왔으면 이메일 · 연락처 가운데 하나는 찾았거나
    // 또렷한 메일 모양 글자가 있어요(scanCard 의 outcome — 하나도 없으면 위에서 「명함을 읽지 못했습니다」).
    // 메일 칩(또는 @ 가 든 줄)은 있는데 채우지 않음 = 잘렸을 수 있어 확인하지 못함, 메일 모양 글자가 하나도 없음 = 찾지 못함(UG-451 기획 17022).
    // 형식이 깨져 메일 칩이 되지 못한 메일 모양 글자(「lena@koh sg」 — @ 양옆에 글자)도 확인하지 못한 것으로 봐요(기획 17030)
    const missing = emailFilled && !result.values.email;
    const emailLike = result.chips.some((c) => isEmailLikeChip(c) || c.text.includes("@"));
    setEmailMissing(missing ? (emailLike ? "unsure" : "none") : null);
    // 새 명함은 접힌 채로(규칙 3 · 7) — 메일 주소를 채우지 못했을 때만 펼쳐요(읽은 줄에서 골라야 해요)
    setChipsOpen(missing);
    // 명함이 채운 이메일은 바로 확인해요 — 이미 있는 계정이면 직원이 일찍 알고, 확인이 「새 계정」으로 끝나기 전에는 「작성 중」으로 남기지 않아요(기획 17022)
    if (emailFilled && result.values.email && EMAIL_RE.test(result.values.email)) void runCheck(result.values.email, true);
    // 칸에 넣지 않은 칩 메일 주소(잘렸을 수 있어 채우지 않음 · 두 번째 주소)도 한 번 조용히 확인해요 — 끝나기 전에는 사진도 남기지 않아요(반박 리뷰 F3)
    const others = chipEmailAddresses(result.chips).filter((address) => address !== result.values.email);
    if (others.length > 0) void checkChipEmails(others);
    setScanDone((n) => n + 1); // 읽은 값 · 사진을 바로 「작성 중」에 남겨요(UG-451 기획 17009)
    // 메일 주소를 못 읽었으면 이메일 칸에 커서(N4). 터치 기기는 초점 없이(키보드가 칩 · 사진을 가리지 않게) 이메일 칸만 진하게(UG-453 기획 4 · 5).
    // 메일을 채웠으면 읽은 줄이 접혀 있어 대상 칸을 두지 않아요 — 펼칠 때 정해요(toggleChips)
    // 서버가 읽었으면 칩이 없어 진하게 보일 대상 칸도 없어요 — 터치 기기는 그대로(키보드를 올리지 않아요), PC 는 이메일 칸에 커서
    if (!missing) return;
    if (isTouchPrimary()) {
      if (!server) moveChipTarget("email");
    } else emailRef.current?.focus();
  }

  // 다시 찍은 뒤의 안내(UG-451 기획 17118-1) — 다른 사람이라 지운 값은 주황(Warning, 기획 17132 — 「명함에서 읽었습니다…」 회색과 갈리게),
  // 같은 사람인지 몰라 남긴 값은 빨간색(확인해야 해요). 그 칸을 직원이 고치면 그 칸 이름이 빠지고, 모두 고치면 내려가요. 읽는 동안에는 띄우지 않아요
  const retakeText = scanning ? null : retakeNoteText(retakeNoted, { company, name, email, phone }, CHIP_TARGET_LABEL);
  const retakeLine = retakeText && (
    <p className={retakeNoted?.kind === "stale" ? "error" : "warning"} role="status">
      {retakeText}
    </p>
  );

  // 명함(칩)에서 들어온 이메일이면 헷갈리는 글자 · 도메인 확인 안내를 보여 줘요 — 직접 고치면(칩 연결이 풀리면) 사라져요
  // 서버가 읽어 채운 이메일(UG-463)도 칸이 그대로인 동안은 같아요 — 직접 고치면 사라져요
  const scannedEmail = scan?.links.email !== undefined || (!!serverRead?.email && email === serverRead.email);
  // 칸 이메일을 넣은 메일 칩이 읽은 그대로의 주소(소문자로 바꾸기 전) — 칸을 직접 고치면 연결이 풀려 없어요(헷갈리는 글자 판단, 반박 리뷰 M1)
  const scannedChip = scannedEmail ? scan?.chips.find((c) => c.id === scan.links.email) : undefined;
  const scannedRead = scannedChip?.kind === "email" ? scannedChip.value : null;
  // 칸 아래 안내가 「이미 사용 중인 계정입니다」일 때만(다른 오류 · 해지 중 · 주소 고치는 중이 아닐 때) 재설정 메일 링크를 보여 줘요
  const offerReset = inUse && !fix && !emailError && !closing && !suspectBlocked;

  // 확인 창의 전제(사용 중 이메일 · 링크를 보일 수 있는 상태)가 깨지면 닫힌 것으로 되돌려요 — 조건이 다시 맞아도 저절로 열리지 않게.
  // 렌더 중에 바로 맞춰요(React 의 「렌더 중 상태 조정」 방식) — 깨진 상태로 한 번도 그리지 않아요.
  if (resetConfirm && !offerReset) setResetConfirm(false);

  if (resetConfirm && offerReset && current?.status === "in_use") {
    return (
      <ResetLinkDialog
        email={trimmed}
        // 발급 기록이 있으면 그때 고른 언어(고정), 없으면(직접 가입 등) 확인 창에서 고르게 해요(기본 English) — 서버는 기록 언어가 이겨요
        issuanceLanguage={current.language ?? null}
        onBack={(reason) => {
          setResetConfirm(false);
          setResetReturned(true);
          // 그사이 계정이 없어졌거나 해지가 시작됐어요 — 칸 아래 안내를 바꿔요(없어졌으면 다시 조회해 새로 만들 수 있게)
          if (reason === "not_found") setChecked(key, null);
          if (reason === "closing") setChecked(key, { status: "closing" });
        }}
        onSent={(result) => {
          // 이미 있는 계정에 메일을 보냈어요 — 이어서 만든 명함은 다 썼고, 명함 사진은 지워요(다시 보내기와 같게)
          consumeDraft();
          setPhoto(null);
          onResetSent(result);
        }}
      />
    );
  }

  if (staleIssue) {
    return (
      <Dialog title="Gate 계정 만들기" onClose={finishStale} closable={!resultBusy}>
        <OldIssueLeftResult account={staleIssue.old} fresh={staleIssue.fresh} mailSent={staleIssue.created !== null} onDone={finishStale} onBusyChange={setResultBusy} />
      </Dialog>
    );
  }

  if (mailFailure) {
    return (
      <Dialog title="Gate 계정 만들기" onClose={close} closable={!resultBusy}>
        <MailFailureResult
          account={mailFailure.account}
          reason={mailFailure.reason}
          onClose={close}
          onCancelled={onCancelled}
          onResent={onResent}
          onMailFailed={onResendMailFailed}
          onBusyChange={setResultBusy}
        />
      </Dialog>
    );
  }

  return (
    // 터치 기기는 열릴 때 회사명 칸에 초점을 주지 않아요(UG-453 기획 4) — 첫 할 일은 명함 찍기라 키보드가 화면을 가리지 않게
    <Dialog title="Gate 계정 만들기" onClose={close} closable={!sending && !keepingDraft} wide touchInputFocus={false}>
      <form onSubmit={onSubmit} onKeyDown={onFormKeyDown} noValidate>
        {/* 「작성 중」 저장을 기다리는 동안(keepingDraft)은 칸 · 버튼 · 칩 · 사진을 모두 잠가요 — 저장한 값과 화면 값이 달라지지 않게(UG-451 반박 리뷰) */}
        <fieldset className="dialog-form" disabled={keepingDraft}>
        {/* 찍은 명함 — 읽은 줄(칩)이 있으면 칩 왼쪽(N7), 없거나 주소를 고치는 동안(fix)이면 여기. 누르면 크게 */}
        {photo && (fix || !scan) && <CardPhotoThumb src={photo} onOpen={() => setViewingPhoto(true)} />}
        {/* 명함 찍어서 채우기(N1~N4) — 주소를 고치는 중(fix)에는 다른 명함을 읽을 일이 없어 숨겨요 */}
        {!fix && (
          <div className="scan">
            {scan ? (
              <>
                <div className="scan-head">
                  {/* 읽은 줄은 접어 두고 글자 버튼으로 펼쳐요(UG-451 기획 17100 규칙 3, M16 · M17). 메일 주소를 채우지 못해 펼친 채로 시작해도
                      「읽은 줄 접기」를 늘 보여 줘요 — 주소를 직접 넣은 뒤 접을 수 있게(UG-463 기획 요청 5) */}
                  <span className="scan-toggle-box">
                    <button
                      type="button"
                      className="scan-toggle"
                      aria-expanded={chipsOpen}
                      aria-controls="scan-chips"
                      // 누르는 동안 칸의 커서가 빠지지 않게(PC) — 펼친 칩이 커서가 있는 칸에 들어가요
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={toggleChips}
                    >
                      {chipsToggleText(chipsOpen, scan.chips.length)}
                    </button>
                  </span>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() => fileRef.current?.click()}
                    // 돌려 읽는 동안에는 누를 수 있어요 — 새로 찍으면 하던 읽기를 버려요(반박 리뷰 4)
                    disabled={scanLocked || sending}
                    aria-busy={scanning || undefined}
                  >
                    {scanLocked ? SCAN_READING : SCAN_AGAIN}
                  </button>
                </div>
                {/* 메일 주소를 채우지 못해 읽은 줄에서 골라야 할 때(규칙 4 — M15) 펼친 줄 위에 넣는 법을 알려요(전에는 접기 버튼 자리에 있었어요) */}
                {chipsShown && emailMissing !== null && (
                  <p className="scan-title">
                    명함에서 읽은 줄 · {touchPrimary ? "누르면 진하게 표시된 칸에 들어갑니다" : "누르면 커서가 있는 칸에 들어갑니다"}
                  </p>
                )}
                {/* 찍은 명함 사진은 접힌 채로도 보여요(칸 값을 명함과 견줘요). 읽은 줄은 펼쳤을 때만 */}
                {(photo || chipsShown) && (
                  <div className="scan-body">
                    {photo && <CardPhotoThumb src={photo} onOpen={() => setViewingPhoto(true)} />}
                    {chipsShown && (
                      <div id="scan-chips" className="scan-chips" role="group" aria-label="명함에서 읽은 줄">
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
                    )}
                  </div>
                )}
                {/* 터치 기기에서 진하게 보인 대상 칸을 낭독기에도 알려요(UG-453 리뷰 m2) */}
                {touchPrimary && chipsShown && (
                  <span className="visually-hidden" aria-live="polite">
                    {targetLabel ? `다음 줄은 ${targetLabel} 칸에 들어갑니다` : ""}
                  </span>
                )}
                {/* 다시 읽는 동안에는 지난 결과(「명함에서 읽었습니다…」) 대신 기다림 안내 — 낭독기가 읽게 같은 상태 줄에 */}
                <p className="help" role="status">
                  {scanning ? scanWaitText : scanFailed ? scanFailedText : SCAN_DONE}
                </p>
                {retakeLine}
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="btn btn-outline scan-button"
                  onClick={() => fileRef.current?.click()}
                  disabled={scanLocked || sending}
                  aria-busy={scanning || undefined}
                >
                  <IcCamera size={16} />
                  {/* 못 읽은 뒤 · 돌려 읽는 동안 · 서버가 읽어 채운 뒤(칩 없음, UG-463)에는 「명함 다시 찍기」(기획 17106-1 · 반박 리뷰 4) */}
                  {scanLocked ? SCAN_READING : scanFailed || scanning || serverRead ? SCAN_AGAIN : SCAN_BUTTON}
                </button>
                {/* 읽는 동안(N2)은 안내 아래에 기다림 안내를 한 줄 더 — 둘 다 상태 줄 안이라 낭독기가 읽어요 */}
                <div className="scan-status" role="status">
                  <p className="help">
                    {scanFailed ? (
                      scanFailedText
                    ) : serverRead && !scanning ? (
                      // 서버가 읽어 채웠어요(UG-463) — 칩 없이 사진 · 칸만. 기기 안 읽기의 「명함에서 읽었습니다…」와 같은 안내
                      SCAN_DONE
                    ) : (
                      // 휴대폰은 한 줄 안내(UG-453 기획 6) — 폭에 따라 하나만 보여요(globals.css)
                      <>
                        <span className="scan-help-long">{SCAN_HELP}</span>
                        <span className="scan-help-short">{SCAN_HELP_SHORT}</span>
                      </>
                    )}
                  </p>
                  {scanning && <p className="help">{scanWaitText}</p>}
                </div>
                {retakeLine}
              </>
            )}
          </div>
        )}

        <div className="field-row">
          <div className="field">
            <label htmlFor="company" className="t-body-200-b">
              회사명
            </label>
            <div className={`input-box${companyError ? " is-error" : ""}${companyLocked ? " is-readonly" : ""}${targetClass("company")}`}>
              <input
                ref={companyRef}
                id="company"
                // 칸 이동 · 입력 도움(UG-451 기획 17073): Enter = 다음 칸, 자동 완성 · 맞춤법 고치기 끔.
                // 길이는 maxLength 로 자르지 않고 「40자까지」 안내로 알려요 — 붙여 넣은 글이 조용히 잘리거나 한글 입력 마지막 글자가 깨지지 않게.
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="next"
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
            <div className={`input-box${nameError ? " is-error" : ""}${personLocked ? " is-readonly" : ""}${targetClass("name")}`}>
              <input
                ref={nameRef}
                id="person-name"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="words"
                spellCheck={false}
                enterKeyHint="next"
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
            <label htmlFor="email" className="t-body-200-b">
              고객 이메일
            </label>
            <div className={`input-box${emailError || suspectBlocked || inUse || closing || fixSame || fixTaken ? " is-error" : ""}${targetClass("email")}`}>
              <input
                ref={emailRef}
                id="email"
                type="email"
                inputMode="email"
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="next"
                maxLength={EMAIL_MAX}
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
                aria-invalid={!!emailError || suspectBlocked || inUse || closing || fixSame || fixTaken}
                aria-describedby="email-note"
              />
            </div>
            <div id="email-note" role="status" aria-live="polite">
              {suspectBlocked ? (
                // 잘렸을 수 있는 메일 칩 값 그대로(눌러 넣음 · 직접 침 · 붙여 넣음, 대소문자 없이) — 고치거나 「명함과 같은 주소예요」로
                // 확인할 때까지 떠 있고 보내기를 막아요(반박 리뷰 F2 · 기획 17030). 다른 안내(확인 실패 등)보다 먼저 — 아래 확인 버튼과 짝이에요
                <p className="error" id="email-suspect">
                  {SUSPECT_EMAIL}
                </p>
              ) : emailError ? (
                <p className="error">{emailError}</p>
              ) : fix && cancelError ? (
                <p className="error">{cancelErrorText(cancelError)}</p>
              ) : fixSame ? (
                // 주소 오류(I2 · C2): PC 는 한 줄, 휴대폰은 문장마다
                <Sentences text={FIX_ADDRESS_TEXT} />
              ) : fixTaken ? (
                <p className="error">이미 만든 계정의 이메일입니다. 다른 주소를 입력해 주세요.</p>
              ) : closing ? (
                <p className="error">{CLOSING_EMAIL}</p>
              ) : fix && !inUse ? null : inUse ? (
                // 정말 막힌 경우: 빨간 한 줄 + 실행 버튼 비활성. 아래에 「고객이 비밀번호를 잊었나요?」(UG-421 D · MD)
                <p className="error">이미 사용 중인 계정입니다.</p>
              ) : blocked && pending ? (
                // 다시 보낼 수 없는 경우: 까닭은 아래 빨간 안내로, 실행 버튼은 「발급 취소」
                <p className="help">
                  이미 만든 계정입니다({handle(pending.createdBy)} · {fmtMonthDay(pending.createdAt)}).
                </p>
              ) : pending ? (
                // 오류가 아니라 할 일이 바뀐 경우: 회색 안내 + 실행 버튼이 「메일 재발송」
                <p className="help">
                  이미 만든 계정입니다({handle(pending.createdBy)} · {fmtMonthDay(pending.createdAt)}). 로그인 전이라 다시 보낼 수 있습니다.
                </p>
              ) : emailMissing ? (
                // 명함에서 메일 주소를 채우지 못함(N4) — 막힌 게 아니라 회색(C 와 같은 모양). 메일 칩이 있었으면(잘렸을 수 있음) 고르라고(UG-451 기획 17022)
                <p className="help">
                  {emailMissing === "unsure"
                    ? "메일 주소를 확인하지 못했습니다. 읽은 줄에서 고르거나 직접 입력해 주세요."
                    : "메일 주소를 찾지 못했습니다. 직접 입력해 주세요."}
                </p>
              ) : (
                <p className="help">주소가 틀리면 다른 사람이 계정을 받습니다.</p>
              )}
            </div>
            {/* 의심 주소 경고 바로 아래(UG-451 기획 17030): 명함과 견줘 맞으면 눌러 그 값으로 보내요 — 칸을 고치면 다시 확인해야 해요 */}
            {suspectBlocked && (
              <button
                type="button"
                ref={suspectConfirmRef}
                className="btn btn-outline btn-sm suspect-confirm"
                aria-describedby="email-suspect"
                disabled={sending || scanning}
                onClick={confirmSuspect}
              >
                {SUSPECT_CONFIRM}
              </button>
            )}
            {/* 사용 중 계정(UG-421 D · MD): 안내 줄 아래 밑줄 링크 — 누르면 이 창 대신 재설정 메일 확인 창(D2 · MD2).
                주소를 고치는 중(fix)에는 새 주소를 받는 중이라 띄우지 않아요. 이메일을 고치면 사라지고 새로 만들기로 돌아가요. */}
            {offerReset && (
              <button
                type="button"
                className="field-link field-link--underline"
                data-autofocus={resetReturned || undefined}
                onClick={() => setResetConfirm(true)}
                disabled={sending || scanning}
              >
                고객이 비밀번호를 잊었나요?
              </button>
            )}
            {/* 명함에서 읽은 이메일의 헷갈리는 글자 · 도메인 — 위 안내(「주소가 틀리면…」 · 오류 · 주소 오류 · 이미 만든 계정) 아래에 덧붙여요 */}
            {/* 잘렸을 수 있는 주소면 「명함과 같은지 확인」 줄은 띄우지 않아요 — 확인된 것처럼 보이지 않게(반박 리뷰 F2) */}
            {scannedEmail && !suspectBlocked && <ScannedEmailNotes email={trimmed} read={scannedRead} />}
          </div>

          {/* 메일 언어는 이메일 칸 바로 아래(UG-451 기획 17073-7) — 휴대폰(한 줄씩)에서 맨 아래 버튼 줄에 가려지지 않게 연락처보다 위에 둬요.
              PC(두 칸)는 전처럼 이메일 · 연락처 줄 아래 한 줄을 다 써요(.field--language). 고치는 중이면 메일 언어는 처음 만든 그대로,
              사용 중 · 발급 취소만 남은 기록이면 보낼 메일이 없어요 — 줄을 숨겨요 */}
          {!fix && !inUse && !closing && !blocked && (
            <div className="field field--language">
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
                      setLanguageAuto(false);
                    }}
                  >
                    <Flag />
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="field">
            <label htmlFor="person-phone" className="t-body-200-b">
              연락처<span className="field-optional">(선택)</span>
            </label>
            <div className={`input-box${phoneError ? " is-error" : ""}${personLocked ? " is-readonly" : ""}${targetClass("phone")}`}>
              <input
                ref={phoneRef}
                id="person-phone"
                type="tel"
                inputMode="tel"
                autoComplete="off"
                // 마지막 칸 — Enter 는 키보드만 닫아요(보내지 않아요, 17073-5)
                enterKeyHint="done"
                maxLength={PHONE_MAX}
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

        {!fix && pending && !blocked && <p className="help">다시 보내면 이전 링크는 쓸 수 없게 됩니다.</p>}
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
        {/* 새 계정은 못 만들었는데 옛 발급의 링크는 이미 막힘(반박 리뷰 M1) — 고친 주소가 이미 있는 계정이면 다시 보내도 같아 옛 발급을 취소하게 */}
        {oldRevoked && <Sentences text={RECREATE_TEXT.sourceRevoked} lines />}
        {keepingDraft && !keepFailed && (
          <p className="help" role="status">
            작성 중인 명함을 저장하고 있습니다…
          </p>
        )}

        {keepFailed ? (
          // 닫을 때 「작성 중」 저장이 연결 문제로 실패(UG-451 기획 16991) — 닫지 않고 고르게 해요. 칸 값은 그대로예요.
          <>
            <p className="error mail-failure" role="alert">
              {DRAFT_KEEP_FAILED}
            </p>
            <div className="dialog-actions">
              <button type="button" className="btn btn-outline" onClick={closeWithoutKeeping} disabled={keepingDraft}>
                그래도 닫기
              </button>
              <button type="button" className="btn btn-dark" onClick={close} disabled={keepingDraft} aria-busy={keepingDraft || undefined}>
                {keepingDraft ? "저장하는 중…" : "다시 시도"}
              </button>
            </div>
          </>
        ) : fix ? (
          // 주소 그대로면 [닫기] [발급 취소](I2 · C2), 고치면 [닫기] [재발송](I3 · C3).
          // 옛 발급의 링크가 이미 막혔으면(반박 리뷰 M1) 고친 뒤에도 [발급 취소]를 함께 둬요 — [닫기] [발급 취소] [재발송]
          <div className="dialog-actions">
            <button type="button" className="btn btn-outline" onClick={close} disabled={cancelling || sending}>
              닫기
            </button>
            {(fixSame || oldRevoked) && cancelError !== "in_use" && cancelError !== "not_found" && cancelError !== "closing" && (
              <button type="button" className="btn btn-danger-outline" onClick={() => cancelNow(fix)} disabled={cancelling || sending || checking} aria-busy={cancelling || undefined}>
                {cancelling ? "취소하는 중…" : "발급 취소"}
              </button>
            )}
            {!fixSame && (
              <button type="submit" className="btn btn-dark" disabled={inUse || closing || fixTaken || suspectBlocked || sending || scanning || cancelling} aria-busy={sending || checking || undefined}>
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
            <button type="submit" className="btn btn-dark" disabled={inUse || closing || suspectBlocked || sending || scanning} aria-busy={sending || checking || undefined}>
              {/* 첫 로그인 전 이메일이면 목록 줄과 같은 이름 「메일 재발송」(UG-450 기획 17020) — 확인 창 제목은 그대로 */}
              {sending ? "보내는 중…" : pending ? "메일 재발송" : "계정 만들고 메일 보내기"}
            </button>
          </div>
        )}
        {/* 아이패드 · 휴대폰은 카메라가 바로 열려요(capture). 폼 끝에 둬요 — 창이 열릴 때 초점이 회사명 칸에 가게(Dialog 는 첫 input 에 초점) */}
        <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={onPhoto} />
        </fieldset>
      </form>
      {/* 보기 화면 위쪽에 지금 이메일 칸의 값을 함께 보여 줘요(기획 17099-2 — 닫지 않고 0 · O, 1 · l · I 를 비교) */}
      {viewingPhoto && photo && <CardPhotoViewer src={photo} email={trimmed} onClose={() => setViewingPhoto(false)} />}
    </Dialog>
  );
}

/** 재설정 메일을 못 보낸 까닭(UG-421 D2 · MD2). cooldown 은 서버가 알려 준 남은 시간으로(모르면 기획 고정 문구 「5분」) */
function resetErrorText(reason: PasswordResetFailure, retryAfterSeconds?: number): string {
  switch (reason) {
    case "cooldown": {
      const minutes = retryAfterSeconds ? Math.max(1, Math.ceil(retryAfterSeconds / 60)) : 5;
      return `같은 계정에는 ${minutes}분 뒤에 다시 보낼 수 있습니다.`;
    }
    case "mail_disabled":
      return "메일 발송이 꺼져 있어 보낼 수 없습니다. 플랫폼 팀에 문의해 주세요.";
    case "not_found":
      return "이 이메일로 가입한 계정이 없습니다. [취소]를 누르면 계정을 새로 만들 수 있습니다.";
    case "closing":
      return `${CLOSING_TIP}. 해지가 끝나거나 철회될 때까지 보낼 수 없습니다.`;
    case "protected":
      return "권한이 높은 계정이라 대신 보낼 수 없습니다. 고객에게 로그인 화면의 「비밀번호 재설정」을 안내해 주세요.";
    case "actor":
      return "본인 계정이거나 지금 쓸 수 없는 직원 계정이라 보낼 수 없습니다.";
    case "invalid":
      return "이메일 형식을 확인해 주세요.";
    default:
      return "메일을 보내지 못했습니다. 다시 시도해 주세요.";
  }
}

/**
 * 사용 중 계정에 비밀번호 재설정 메일을 대신 보낼지 묻는 창(UG-421 D2 · 휴대폰 MD2). 계정 만들기 창 대신 떠요(겹치지 않아요).
 * [취소] · Esc · 바깥 누르기 = 계정 만들기 창으로 돌아가요(입력값 그대로). [보내기] 성공 = 창을 닫고 알림.
 * 5분 안에 이미 보낸 계정(cooldown) · 서버 문제는 창을 열어 둔 채 까닭을 보여 줘요 — 다시 누를 수 있어요.
 * 더 보낼 수 없는 까닭(계정 없음 · 해지 중 · 권한 · 메일 꺼짐)이면 [보내기]를 감추고 [취소]만 남겨요.
 */
function ResetLinkDialog({
  email,
  issuanceLanguage,
  onBack,
  onSent,
}: {
  email: string;
  /**
   * 그 계정을 발급할 때 고른 메일 언어 — 있으면 고정으로 보여 줘요. 발급 기록이 없는 계정(직접 가입 등)이면 null 이고,
   * 이 창에서 고르게 해요(기본 English) — 사용 중 이메일이면 만들기 창의 언어 줄이 숨겨져 고를 데가 없었어요.
   */
  issuanceLanguage: MailLanguage | null;
  /** reason = 마지막으로 못 보낸 까닭(있으면) — 계정 만들기 창이 칸 아래 안내를 맞춰요 */
  onBack: (reason: PasswordResetFailure | null) => void;
  onSent: (result: Extract<PasswordResetResult, { ok: true }>) => void;
}) {
  const [sending, setSending] = useState(false);
  const [picked, setPicked] = useState<MailLanguage>("en");
  const language = issuanceLanguage ?? picked;
  const [failure, setFailure] = useState<{ reason: PasswordResetFailure; retryAfterSeconds?: number } | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  // 다시 눌러도 같은 결과인 까닭 — [보내기]를 감춰요
  const final = !!failure && failure.reason !== "cooldown" && failure.reason !== "failed";

  useEffect(() => {
    if (final) cancelRef.current?.focus();
  }, [final]);

  const back = () => onBack(failure?.reason ?? null);

  async function send() {
    if (sending) return;
    setSending(true);
    setFailure(null);
    const res = await sendPasswordResetLink(email, language);
    setSending(false);
    if (res.ok) return onSent(res);
    setFailure({ reason: res.reason, retryAfterSeconds: res.retryAfterSeconds });
  }

  return (
    <Dialog title="비밀번호 재설정 메일을 보내시겠습니까?" onClose={back} closable={!sending}>
      <div className="summary reset-summary">
        <dl className="summary-rows">
          <div>
            <dt>이메일 주소</dt>
            <dd className="summary-email">{email}</dd>
          </div>
          <div>
            <dt id="reset-language-label">메일 언어</dt>
            <dd>
              {issuanceLanguage ? (
                `${languageName(issuanceLanguage)} (계정 발급 때 고른 언어)`
              ) : (
                <div className="segmented" role="radiogroup" aria-labelledby="reset-language-label">
                  {LANGUAGES.map(({ value, label, Flag }) => (
                    <button key={value} type="button" role="radio" aria-checked={picked === value} onClick={() => setPicked(value)} disabled={sending}>
                      <Flag />
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </dd>
          </div>
          <div>
            <dt>새 비밀번호</dt>
            <dd>고객이 메일의 링크에서 직접 정함</dd>
          </div>
          <div>
            <dt>링크</dt>
            <dd>24시간 · 한 번만 쓸 수 있음</dd>
          </div>
        </dl>
      </div>
      {failure && (
        <p className="error" role="alert">
          {resetErrorText(failure.reason, failure.retryAfterSeconds)}
        </p>
      )}
      <div className="dialog-actions">
        {/* 처음 초점은 「취소」 — Enter 한 번에 실제 메일이 나가지 않게(UG-421 기획 16987) */}
        <button ref={cancelRef} type="button" className="btn btn-outline" onClick={back} disabled={sending} data-autofocus>
          취소
        </button>
        {!final && (
          <button type="button" className="btn btn-dark" onClick={send} disabled={sending} aria-busy={sending || undefined}>
            {sending ? "보내는 중…" : "보내기"}
          </button>
        )}
      </div>
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
  // 실패 결과에서 다시 보내는 중 · 취소하는 중 — 창이 Esc · 바깥 클릭으로 닫히지 않게
  const [resultBusy, setResultBusy] = useState(false);

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
      <Dialog title="안내 메일 다시 보내기" onClose={onClose} closable={!resultBusy}>
        <MailFailureResult
          account={account}
          reason={mailFailure}
          onClose={onClose}
          onCancelled={onCancelled}
          onResent={onResent}
          onMailFailed={onMailFailed}
          onBusyChange={setResultBusy}
        />
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
            <dt>비밀번호 설정 링크</dt>
            <dd>새로 발급(30일) · 이전 링크는 사용 불가</dd>
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
            {/* 명함 사진이 있는 줄이면 「· 명함 사진」까지(기획 17099-4) */}
            <dd>{cancelTargetsText(account)}</dd>
          </div>
          <div>
            <dt>보낸 메일</dt>
            <dd>비밀번호 설정 링크와 체험 링크를 쓸 수 없게 됨</dd>
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
