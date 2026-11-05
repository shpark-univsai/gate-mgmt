// 서버 연결 지점 (UG-405). 화면은 이 파일의 함수만 불러요.
// 로그인은 Gate 인증 서버(/api/v1/auth/...), 계정 발급은 백오피스 서버(/api/v1/mgmt/...)예요. 둘 다 게이트웨이를 거쳐요.
// 백오피스는 허용된 직원만 쓸 수 있어요(서버의 직원 허용 목록). 목록에 없으면 로그인 때 「권한 없음」으로 막혀요.
import { ApiError, authed, publicPost, revokeRefreshToken, send } from "./http";
import { clearSession, getTokens, saveTokens } from "./session";

export type MailLanguage = "en" | "ko";

// 백오피스 계정(영업 · 대표). 플랫폼 팀이 서버에서 직접 만들어 줘요(만드는 화면 없음).
// 직원 이름은 어디에도 두지 않아요(개인정보). 회사 이메일로만 구분하고, 안내 메일 담당자 칸({sales_email})에도 이메일이 들어가요.
// 전화는 메일 템플릿의 회사 대표번호로 고정.
export type Staff = {
  email: string;
};

/**
 * pending = 영업이 만들었고 고객이 아직 첫 로그인 전 / in_use = 고객이 직접 가입했거나 로그인한 적 있음
 * cancelled = 발급 취소. 계정 · 데모 프로젝트는 지웠고, 발급 기록(이 줄)만 남겨요.
 * closing = 해지 중(UG-443 기획 16908). 계정 해지가 진행 중이에요(처리 중 · 계정 서버 대기 · 실패) — 다시 보내기 · 발급 취소를
 *   서버가 막아요(MGMT-121). 해지를 철회하면 원래 상태(statusBeforeClosing)로 돌아가요.
 * closed = 해지됨(UG-443). 고객 요청으로 「계정 해지」가 끝나 계정과 데이터를 파기했어요. 고객 정보는 발급 취소처럼 비워요.
 *   cancelledBy · cancelledAt 은 해지를 실행한 직원 · 파기 완료 시각이에요. 해지가 끝날 때까지는 원래 상태 그대로 보여요.
 */
export type AccountStatus = "pending" | "in_use" | "closing" | "cancelled" | "closed";

/**
 * 안내 메일을 보내지 못한 까닭(서버가 메일 서버 응답으로 판정).
 * temporary = 메일 서버 쪽 일시 오류(잠시 뒤 다시 보내면 될 수 있음) / address = 받는 주소가 유효하지 않음 / unknown = 그 밖의 실패
 */
export type MailFailureReason = "temporary" | "address" | "unknown";

export type Account = {
  id: string;
  company: string;
  email: string;
  language: MailLanguage;
  status: AccountStatus;
  /** 만든 직원의 회사 이메일 */
  createdBy: string;
  createdAt: string;
  /**
   * 데모 프로젝트에 쌓인 데모 기록 수. 로그인 없이 체험 링크로 써 봤을 수 있어서 발급 취소 확인 창에 보여 줘요.
   * 체험 링크 기능이 생기기 전까지 서버가 주지 않아요(없으면 건수를 빼고 보여 줘요).
   */
  demoRecords?: number;
  /** 발급 취소한 직원의 회사 이메일 · 시각(cancelled일 때만). 시스템이 정리한 기록이면 cancelledBy 가 없어요. */
  cancelledBy?: string;
  cancelledAt?: string;
  /** 마지막 안내 메일 발송이 실패했어요 — 다시 보내기로 복구해요 */
  mailFailed?: boolean;
  /**
   * 마지막 발송이 실패한 까닭. 없으면 마지막 발송이 성공했거나 실패한 적이 없어요(예전 서버도 주지 않아요).
   * 상태(status)는 그대로 pending 이라 필터 · 요약 카드에서는 「첫 로그인 전」으로 세요 — 목록 줄의 표시만 바뀌어요.
   */
  mailFailureReason?: MailFailureReason;
  /** 같은 주소로 3번 연속 주소 오류 — 서버가 다시 보내기를 막았어요(발급 취소만 가능) */
  resendBlocked?: boolean;
  /** 고객 이름 · 연락처(명함 · 발급 창, UG-431). 이 기능 전에 만든 기록이거나 비워 두었으면 없어요. */
  name?: string;
  phone?: string;
  /** 해지 중(closing)일 때 원래 상태 — 그 줄의 동작을 꺼 둔 채 보여 줘요 */
  statusBeforeClosing?: "pending" | "in_use";
};

/** 목록 · 내보내기 상태 거르기 — closed_all = 해지 중 + 해지됨(UG-450, 서버 mgmt 같은 값) */
export type AccountStatusFilter = AccountStatus | "all" | "closed_all";
export type AccountQuery = { keyword?: string; status?: AccountStatusFilter; page?: number; size?: number };

/** 목록 한 페이지. total = 조건에 맞는 전체 건수 */
export type AccountPage = { items: Account[]; total: number };

/** 요약 카드. 검색어 · 상태 필터와 무관한 전체 기준(서버가 셈) */
// closed = 해지됨(UG-443) — cancelled 에는 들어가지 않아요. 예전 서버는 주지 않아요(없으면 「—」).
// closing = 해지 중(UG-443 기획 16908) — pending · inUse 에 들어가지 않아요. 예전 서버는 주지 않아요.
export type AccountSummary = {
  total: number;
  pending: number;
  inUse: number;
  closing?: number;
  cancelled: number;
  closed?: number;
  thisMonth: number;
};

export type CreateAccountInput = {
  company: string;
  email: string;
  language: MailLanguage;
  /** 고객 이름(UG-431). 화면은 새로 만들 때 꼭 받지만 서버는 비어도 받아요(고치는 재발송 · 옛 기록). 최대 40자 */
  name?: string;
  /** 고객 연락처(UG-431, 선택). 숫자 · 공백 · + · - · ( · ) 만, 최대 30자 */
  phone?: string;
  /** 「작성 중」 명함을 이어서 만든 창이면 그 번호(UG-431 기획 16864) — 계정이 만들어지면(메일 실패 포함) 서버가 그 명함을 지워요 */
  draftId?: number;
};

/**
 * 「CSV 내려받기」 한 줄(UG-431). 목록과 같은 조건 · 같은 순서(최신순)의 기록 전부.
 * 동의는 Y · N, 발급 취소한 기록이거나 기록이 없으면 null. createdAt 은 UTC(한국 시각 변환은 화면이 해요).
 */
export type ExportRow = {
  /** 발급 취소 · 해지됨 기록은 비어(null) 올 수 있어요 — CSV 에는 빈 칸 */
  company: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  language: MailLanguage;
  status: AccountStatus;
  firstLoginConsent: "Y" | "N" | null;
  marketingConsent: "Y" | "N" | null;
  createdBy: string;
  createdAt: string;
};

/** too_many = 조건에 맞는 기록이 10,000건을 넘어 서버가 거절함(MGMT-107 — 검색어 · 상태로 좁혀 다시) / failed = 서버 · 네트워크 문제 */
export type ExportResult = { ok: true; rows: ExportRow[] } | { ok: false; reason: "too_many" | "failed" };

/**
 * 이메일 칸을 벗어날 때 하는 미리 조회. 보내기 전에 상태를 보여 주려고 써요.
 * 서버는 보내기 때도 같은 판정을 다시 해요(조회와 보내기 사이에 바뀔 수 있어서).
 * pending 이면 그 발급 기록 번호(id)로 다시 보내요.
 * resendBlocked = 같은 주소로 3번 연속 주소 오류라 서버가 다시 보내기를 막았어요(발급 취소만 가능 · 목록과 같은 규칙).
 * 예전 서버는 주지 않아요(없으면 false).
 * company = 그 발급 기록의 회사명(창에 기록 그대로 보여 주려고). 서버가 주지 않으면 이메일만 보여요.
 * mailFailureReason = 마지막 발송이 실패한 까닭(다시 보내기가 성공하면 빠져요). address 면 창에서 주소를 고쳐 재발송하게 해요.
 */
export type EmailCheck =
  | { status: "new" }
  | {
      status: "pending";
      id: string;
      createdBy: string;
      createdAt: string;
      language: MailLanguage;
      resendBlocked: boolean;
      company?: string;
      mailFailureReason?: MailFailureReason;
    }
  // 이미 쓰는 계정 — 새로 만들지 않아요. 직원이 비밀번호 재설정 메일을 대신 보낼 수 있어요(UG-421).
  // language = 그 계정을 백오피스에서 발급했을 때 고른 메일 언어(재설정 메일도 이 언어로 가요). 발급 기록이 없는 계정(직접 가입 등)이면 없어요.
  | { status: "in_use"; language?: MailLanguage }
  // 해지 중인 계정(UG-443 기획 16908) — 다시 보내지도 새로 만들지도 않아요
  | { status: "closing" };

export type CreateAccountResult =
  | { ok: true; account: Account; mailSent: true }
  // 계정은 만들었지만 안내 메일은 못 보냈어요 — 까닭에 따라 목록에서 다시 보내거나 발급 취소해요
  | { ok: true; account: Account; mailSent: false; mailFailureReason: MailFailureReason }
  // duplicate = 첫 로그인 전 계정이 이미 있음(다시 보내기로 안내) / in_use = 쓰던 비밀번호가 막히므로 보내지 않음
  // domain = 받는 주소의 도메인이 메일을 받을 수 없어 서버가 계정을 만들지 않음(MGMT-108 — 명함에서 도메인을 잘못 읽은 경우 등)
  | { ok: false; reason: "duplicate" | "in_use" | "failed" | "domain" };

// 만들기 · 다시 보내기 모두 하루 제한은 두지 않아요.
// in_use = 그사이 고객이 로그인함 / not_found = 그사이 발급 취소됨 / failed = 서버 · 네트워크 문제(다시 누르면 될 수 있음)
// temporary · address · unknown = 메일을 보내지 못한 까닭 / blocked = 주소 오류가 3번 이어져 서버가 다시 보내기를 막음
// closing = 해지 처리 중인 계정(MGMT-121, UG-443)
export type ResendFailure = "in_use" | "not_found" | "closing" | "failed" | MailFailureReason | "blocked";
export type ResendResult = { ok: true; requestedAt: string } | { ok: false; reason: ResendFailure };

/**
 * 발급 취소. in_use = 누르는 사이 고객이 로그인해서 취소하지 않음(서버가 누를 때 다시 판정)
 * not_found = 다른 직원이 먼저 취소함
 */
export type CancelFailure = "in_use" | "not_found" | "closing" | "failed";
export type CancelResult = { ok: true } | { ok: false; reason: CancelFailure };

/**
 * invalid = 이메일 · 비밀번호가 맞지 않음 / forbidden = 백오피스를 쓸 수 없는 계정 / failed = 서버 · 네트워크 문제
 * password = 임시 비밀번호라 먼저 바꿔야 함(바꾸는 화면은 Gate 콘솔에 있어요)
 */
export type LoginResult =
  | { ok: true; staff: Staff }
  | { ok: false; reason: "invalid" | "forbidden" | "failed" | "password" };

const MGMT = "/api/v1/mgmt";

/**
 * 계정 만들기 전 도메인 확인에 걸림(UG-431, HTTP 400) — 받는 주소의 도메인이 메일을 받을 수 없어(도메인 없음 · 메일 서버 없음)
 * 서버가 아무것도 만들지 않았어요. 명함에서 도메인을 잘못 읽은 경우(company-a.com → company-a.qi)가 대표적이에요.
 */
const RECIPIENT_DOMAIN_UNDELIVERABLE = "MGMT-108";

/** 서버 · 네트워크 문제(다시 시도하면 될 수 있는 것)인지 */
const isTransient = (e: unknown) =>
  !(e instanceof ApiError) || e.status === 0 || e.status === 429 || e.status >= 500;

export async function login(email: string, password: string): Promise<LoginResult> {
  let tokens: { accessToken: string; refreshToken: string; mustSetPassword?: boolean };
  try {
    tokens = await publicPost("/api/v1/auth/login", { email, password });
  } catch (e) {
    return { ok: false, reason: isTransient(e) ? "failed" : "invalid" };
  }
  if (tokens.mustSetPassword) {
    // 관리자가 준 임시 비밀번호처럼 변경이 강제된 계정 — 서버가 다른 API 를 막으므로 들어가지 않아요(auth UMS-52 · 53).
    revokeRefreshToken(tokens.refreshToken);
    return { ok: false, reason: "password" };
  }
  try {
    // 허용된 직원인지 서버에 물어요. 토큰은 확인된 뒤에만 남겨요.
    const me = await send<{ accountId: string; email: string }>("GET", `${MGMT}/me`, {}, tokens.accessToken);
    saveTokens({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
    return { ok: true, staff: { email: me.email } };
  } catch (e) {
    revokeRefreshToken(tokens.refreshToken);
    if (e instanceof ApiError && e.status === 403 && e.code === "AUTH-171") return { ok: false, reason: "password" };
    if (e instanceof ApiError && e.status === 403) return { ok: false, reason: "forbidden" };
    return { ok: false, reason: "failed" };
  }
}

/** 로그아웃: 이 탭의 로그인 상태를 지우고, 서버 세션(리프레시 토큰)도 끝내요. 서버 응답은 기다리지 않아요. */
export function logout() {
  const refreshToken = getTokens()?.refreshToken;
  clearSession();
  if (refreshToken) revokeRefreshToken(refreshToken);
}

// 발급 취소 · 해지됨 기록은 서버가 고객 정보를 비워 회사명 · 이메일이 null 로 와요(UG-443 기획 16925) — 화면에는 빈 글자로 넘겨요.
type AccountDto = Omit<Account, "company" | "email" | "createdBy" | "cancelledBy" | "cancelledAt" | "mailFailureReason" | "name" | "phone" | "statusBeforeClosing"> & {
  company: string | null;
  email: string | null;
  /** 만든 직원 이메일 — 서버는 NOT NULL 로 늘 채우지만, 비어 와도 목록이 깨지지 않게 받는다(UG-443 기획 16936) */
  createdBy: string | null;
  statusBeforeClosing?: "pending" | "in_use" | null;
  cancelledBy: string | null;
  cancelledAt: string | null;
  mailFailureReason?: MailFailureReason | null;
  name?: string | null;
  phone?: string | null;
};

const MAIL_FAILURE_REASONS: readonly string[] = ["temporary", "address", "unknown"] satisfies MailFailureReason[];
const isMailFailureReason = (r: unknown): r is MailFailureReason => typeof r === "string" && MAIL_FAILURE_REASONS.includes(r);

const toAccount = (a: AccountDto): Account => ({
  id: a.id,
  company: a.company ?? "",
  email: a.email ?? "",
  language: a.language,
  status: a.status,
  createdBy: a.createdBy ?? "",
  createdAt: a.createdAt,
  mailFailed: a.mailFailed,
  ...(isMailFailureReason(a.mailFailureReason) ? { mailFailureReason: a.mailFailureReason } : {}),
  ...(a.resendBlocked ? { resendBlocked: true } : {}),
  ...(a.cancelledBy ? { cancelledBy: a.cancelledBy } : {}),
  ...(a.cancelledAt ? { cancelledAt: a.cancelledAt } : {}),
  ...(a.name ? { name: a.name } : {}),
  ...(a.phone ? { phone: a.phone } : {}),
  ...(a.statusBeforeClosing ? { statusBeforeClosing: a.statusBeforeClosing } : {}),
});

/** 계정 발급 목록. 모든 직원이 만든 계정을 최신순으로, 한 페이지씩(page 는 1부터) 보여 줘요. */
export async function listAccounts(query: AccountQuery = {}): Promise<AccountPage> {
  const params = new URLSearchParams();
  if (query.keyword?.trim()) params.set("keyword", query.keyword.trim());
  params.set("status", query.status ?? "all");
  params.set("page", String(query.page ?? 1));
  params.set("size", String(query.size ?? 20));
  const data = await authed<{ content: AccountDto[]; totalElements: number }>("GET", `${MGMT}/accounts?${params}`);
  return { items: data.content.map(toAccount), total: data.totalElements };
}

/**
 * 「CSV 내려받기」 — 지금 목록에 걸린 조건(검색어 · 상태) 그대로 전부(페이지 없음). 파일은 화면이 만들어요(accounts-csv.ts).
 * 고객 이름 · 연락처가 담긴 파일이라 서버가 누가 몇 건을 내보냈는지 기록해 둬요.
 */
export async function exportAccounts(query: Pick<AccountQuery, "keyword" | "status"> = {}): Promise<ExportResult> {
  const params = new URLSearchParams();
  if (query.keyword?.trim()) params.set("keyword", query.keyword.trim());
  params.set("status", query.status ?? "all");
  try {
    const data = await authed<{ rows: ExportRow[]; total: number }>("GET", `${MGMT}/accounts/export?${params}`);
    return { ok: true, rows: data.rows };
  } catch (e) {
    if (e instanceof ApiError && e.code === "MGMT-107") return { ok: false, reason: "too_many" };
    return { ok: false, reason: "failed" };
  }
}

export function getSummary(): Promise<AccountSummary> {
  return authed<AccountSummary>("GET", `${MGMT}/accounts/summary`);
}

export async function checkEmail(email: string): Promise<EmailCheck> {
  const data = await authed<{
    status: "new" | "pending" | "in_use" | "closing";
    id?: string;
    createdBy?: string;
    createdAt?: string;
    language?: MailLanguage;
    resendBlocked?: boolean | null;
    company?: string | null;
    mailFailureReason?: MailFailureReason | null;
  }>("GET", `${MGMT}/accounts/email-check?email=${encodeURIComponent(email)}`);
  if (data.status === "pending" && data.id && data.createdBy && data.createdAt && data.language) {
    return {
      status: "pending",
      id: data.id,
      createdBy: data.createdBy,
      createdAt: data.createdAt,
      language: data.language,
      resendBlocked: data.resendBlocked === true,
      ...(data.company ? { company: data.company } : {}),
      ...(isMailFailureReason(data.mailFailureReason) ? { mailFailureReason: data.mailFailureReason } : {}),
    };
  }
  if (data.status === "closing") return { status: "closing" };
  if (data.status === "in_use") return isMailLanguage(data.language) ? { status: "in_use", language: data.language } : { status: "in_use" };
  return { status: "new" };
}

const isMailLanguage = (v: unknown): v is MailLanguage => v === "en" || v === "ko";

/**
 * 비밀번호 재설정 메일을 대신 보낼 때(UG-421) 못 보낸 까닭.
 * cooldown = 같은 계정에 5분 안에 이미 보냄(고객이 직접 요청한 것 포함, MGMT-122) / mail_disabled = 메일 발송이 꺼져 있음(MGMT-123)
 * not_found = 그사이 계정이 없어짐(MGMT-124) / closing = 해지 처리 중(MGMT-121) / protected = 직원보다 권한이 높은 계정(MGMT-103)
 * actor = 본인 계정이거나 쓸 수 없는 직원 계정(MGMT-104) / failed = 서버 · 네트워크 문제(다시 누르면 될 수 있음)
 */
export type PasswordResetFailure = "cooldown" | "mail_disabled" | "not_found" | "closing" | "protected" | "actor" | "failed";
export type PasswordResetResult =
  // invitationPending = 초대를 아직 수락하지 않은 계정이라 링크 대신 「초대 메일을 확인하세요」 안내가 갔어요(그래도 성공)
  // expiresAt = 링크가 끝나는 시각(24시간 · 한 번만), 초대 안내면 null
  | { ok: true; mailLanguage: MailLanguage; invitationPending: boolean; expiresAt: string | null }
  // retryAfterSeconds = cooldown 일 때 서버가 알려 준 남은 초(모르면 없음 — 화면은 「5분」)
  | { ok: false; reason: PasswordResetFailure; retryAfterSeconds?: number };

const PASSWORD_RESET_FAILURE: Record<string, PasswordResetFailure> = {
  "MGMT-123": "mail_disabled",
  "MGMT-124": "not_found",
  "MGMT-121": "closing",
  "MGMT-103": "protected",
  "MGMT-104": "actor",
};

/**
 * 사용 중 계정에 비밀번호 재설정 메일을 대신 보내요(UG-421). 로그인 화면의 「비밀번호 재설정」과 같은 메일 · 같은 링크예요.
 * 새 비밀번호는 고객이 링크에서 직접 정해요. 메일 언어는 그 계정을 발급할 때 고른 언어이고, 발급 기록이 없으면 language(만들기 창에서 고른 언어)예요.
 * 누가 · 언제 보냈는지 서버가 기록해 둬요.
 */
export async function sendPasswordResetLink(email: string, language: MailLanguage): Promise<PasswordResetResult> {
  try {
    const data = await authed<{ mailLanguage: MailLanguage; invitationPending: boolean; expiresAt?: string | null }>(
      "POST",
      `${MGMT}/accounts/password-reset-link`,
      { email, language },
    );
    return {
      ok: true,
      mailLanguage: isMailLanguage(data.mailLanguage) ? data.mailLanguage : language,
      invitationPending: data.invitationPending === true,
      expiresAt: data.expiresAt ?? null,
    };
  } catch (e) {
    if (!(e instanceof ApiError)) return { ok: false, reason: "failed" };
    if (e.code === "MGMT-122") {
      return { ok: false, reason: "cooldown", ...(e.retryAfterSeconds ? { retryAfterSeconds: e.retryAfterSeconds } : {}) };
    }
    const reason = (e.code && PASSWORD_RESET_FAILURE[e.code]) || "failed";
    return { ok: false, reason };
  }
}

/** 계정 만들기 — 서버가 계정 · 데모 프로젝트를 만들고 안내 메일을 보내요. 만든 직원은 서버가 로그인 정보로 정해요. */
export async function createAccount(input: CreateAccountInput): Promise<CreateAccountResult> {
  try {
    const data = await authed<{
      ok: boolean;
      reason?: "duplicate" | "in_use" | "failed";
      account?: AccountDto;
      mailSent?: boolean;
      mailFailureReason?: MailFailureReason | null;
    }>("POST", `${MGMT}/accounts`, input);
    if (data.ok && data.account) {
      const account = toAccount(data.account);
      if (data.mailSent) return { ok: true, account, mailSent: true };
      // 예전 서버는 까닭을 주지 않아요 — 「메일 발송 실패」(unknown)로 보여 줘요.
      const mailFailureReason = isMailFailureReason(data.mailFailureReason) ? data.mailFailureReason : "unknown";
      return { ok: true, account, mailSent: false, mailFailureReason };
    }
    return { ok: false, reason: data.reason ?? "failed" };
  } catch (e) {
    if (e instanceof ApiError && e.code === RECIPIENT_DOMAIN_UNDELIVERABLE) return { ok: false, reason: "domain" };
    return { ok: false, reason: "failed" };
  }
}

/** 첫 로그인 전 계정에 안내 메일을 다시 보내요(새 임시 비밀번호). id = 발급 기록 번호 */
export async function resendGuide(id: string, language: MailLanguage): Promise<ResendResult> {
  try {
    const data = await authed<{ ok: boolean; requestedAt?: string; reason?: string | null }>(
      "POST",
      `${MGMT}/accounts/${encodeURIComponent(id)}/resend`,
      { language },
    );
    if (data.ok && data.requestedAt) return { ok: true, requestedAt: data.requestedAt };
    // 예전 서버는 까닭을 주지 않아요 — 전처럼 「다시 시도해 주세요」로 보여 줘요.
    if (data.reason === "blocked" || isMailFailureReason(data.reason)) return { ok: false, reason: data.reason };
    return { ok: false, reason: "failed" };
  } catch (e) {
    if (e instanceof ApiError && e.code === "MGMT-121") return { ok: false, reason: "closing" };
    if (e instanceof ApiError && e.code === "MGMT-102") return { ok: false, reason: "in_use" };
    if (e instanceof ApiError && e.code === "MGMT-101") return { ok: false, reason: "not_found" };
    return { ok: false, reason: "failed" };
  }
}

/**
 * 첫 로그인 전 계정의 발급 취소: 계정 · 데모 프로젝트를 지우고, 보낸 메일의 임시 비밀번호와 체험 링크를 막아요.
 * 취소 안내 메일은 보내지 않아요. 목록에는 「발급 취소」 줄로 남고(누가 · 언제), 같은 이메일로 다시 발급할 수 있어요.
 * 만들기 · 다시 보내기 · 발급 취소는 할 때마다 누가 · 언제 했는지 서버가 기록해 둬요(나중에 「관리/보안 이력」에서 보기).
 */
export async function cancelIssue(accountId: string): Promise<CancelResult> {
  try {
    await authed("DELETE", `${MGMT}/accounts/${encodeURIComponent(accountId)}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof ApiError && e.code === "MGMT-121") return { ok: false, reason: "closing" };
    if (e instanceof ApiError && e.code === "MGMT-102") return { ok: false, reason: "in_use" };
    if (e instanceof ApiError && e.code === "MGMT-101") return { ok: false, reason: "not_found" };
    return { ok: false, reason: "failed" };
  }
}

/**
 * 「작성 중」 명함(UG-431 기획 16864). 계정 만들기 창에서 명함을 찍었거나 칸을 채운 뒤 만들지 않고 닫으면 서버에 남겨요 —
 * 다른 기기 · 다른 직원도 목록에서 보고 이어서 만들 수 있어요. 계정을 만들면(서버가 draftId 로) · [지우기] · 찍은 날부터 30일(서버)에 지워요.
 * 요약 카드 · CSV 에는 들어가지 않아요(발급 기록이 아니에요). 못 채운 칸 · 고르지 않은 메일 언어는 null.
 */
export type CardDraft = {
  id: string;
  company: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  language: MailLanguage | null;
  hasPhoto: boolean;
  capturedAt: string;
  expiresAt: string;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
};

/** 이어서 만들기로 열 때 받는 것 — chips = 창이 저장한 칩 상태(JSON 그대로), photo = 명함 사진(순수 base64 JPEG) */
export type CardDraftDetail = { draft: CardDraft; chips: unknown; photo: string | null };

/**
 * 남기는 값. 갱신(PUT)은 통째 바꾸기라 보내지 않은 칸은 지워져요.
 * 사진: 새로 찍었으면 photo(data: 접두사 없는 base64 JPEG), 그대로면 keepPhoto: true, 지웠으면 둘 다 빼요.
 */
export type CardDraftInput = {
  company?: string;
  name?: string;
  email?: string;
  phone?: string;
  language?: MailLanguage;
  chips?: unknown;
  photo?: string;
  keepPhoto?: boolean;
};

/**
 * not_found = 그사이 계정을 만들었거나 다른 직원이 지움(MGMT-109 — 새로 남기지 않아요)
 * photo = 사진이 너무 크거나(MGMT-110 · 112) JPEG 가 아님(MGMT-111)
 * invalid = 칸 값을 받지 않음(PJ-101 — 길이 · 제어 문자 · 빈 명함) / failed = 서버 · 네트워크 문제
 */
export type CardDraftSaveResult = { ok: true; draft: CardDraft } | { ok: false; reason: "not_found" | "photo" | "invalid" | "failed" };

/**
 * 「작성 중」 명함 칸 길이 상한 — 서버(CardDraftRequest @Size)와 같아요. 줄바꿈 · 탭 같은 제어 문자도 서버가 받지 않아요(PJ-101).
 * 계정 만들기 칸(회사명 · 이름 40, 연락처 30)과 같고, 이메일은 255.
 */
export const CARD_DRAFT_MAX = { company: 40, name: 40, email: 255, phone: 30 } as const;

const CARD_DRAFT_NOT_FOUND = "MGMT-109";
const CARD_DRAFT_PHOTO_ERRORS: readonly string[] = ["MGMT-110", "MGMT-111", "MGMT-112"];

type CardDraftDto = Partial<Omit<CardDraft, "id" | "hasPhoto">> & { id: string | number; hasPhoto?: boolean | null };

const LANGUAGES: readonly string[] = ["en", "ko"] satisfies MailLanguage[];
const textOrNull = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);

const toCardDraft = (d: CardDraftDto): CardDraft => ({
  id: String(d.id),
  company: textOrNull(d.company),
  name: textOrNull(d.name),
  email: textOrNull(d.email),
  phone: textOrNull(d.phone),
  language: typeof d.language === "string" && LANGUAGES.includes(d.language) ? d.language : null,
  hasPhoto: d.hasPhoto === true,
  capturedAt: d.capturedAt ?? "",
  expiresAt: d.expiresAt ?? "",
  createdBy: d.createdBy ?? "",
  createdAt: d.createdAt ?? "",
  updatedBy: d.updatedBy ?? "",
  updatedAt: d.updatedAt ?? "",
});

const isDraftNotFound = (e: unknown) => e instanceof ApiError && (e.code === CARD_DRAFT_NOT_FOUND || (e.status === 404 && !e.code));

/** 「작성 중」 명함 목록 — 모든 직원 것. 목록 화면의 검색어가 있으면 같은 검색어로 걸러요(한 번에 최대 100장, total = 전체 장 수). */
export async function listCardDrafts(keyword = ""): Promise<{ items: CardDraft[]; total: number }> {
  const params = new URLSearchParams();
  if (keyword.trim()) params.set("keyword", keyword.trim());
  params.set("page", "1");
  params.set("size", "100");
  const data = await authed<{ content: CardDraftDto[]; totalElements: number }>("GET", `${MGMT}/card-drafts?${params}`);
  const items = data.content.map(toCardDraft);
  return { items, total: Math.max(items.length, Number(data.totalElements) || 0) };
}

/** 이어서 만들기 — 칩 · 사진까지. not_found = 그사이 계정을 만들었거나 지워짐 */
export async function getCardDraft(
  id: string,
): Promise<{ ok: true; detail: CardDraftDetail } | { ok: false; reason: "not_found" | "failed" }> {
  try {
    const data = await authed<{ draft: CardDraftDto; chips?: unknown; photo?: string | null }>(
      "GET",
      `${MGMT}/card-drafts/${encodeURIComponent(id)}`,
    );
    return {
      ok: true,
      detail: { draft: toCardDraft(data.draft), chips: data.chips ?? null, photo: typeof data.photo === "string" && data.photo ? data.photo : null },
    };
  } catch (e) {
    return { ok: false, reason: isDraftNotFound(e) ? "not_found" : "failed" };
  }
}

/** 남기기 — id 가 없으면 새로(POST), 있으면 그 명함을 통째 바꿔요(PUT). */
export async function saveCardDraft(id: string | null, input: CardDraftInput): Promise<CardDraftSaveResult> {
  try {
    const data = id
      ? await authed<CardDraftDto>("PUT", `${MGMT}/card-drafts/${encodeURIComponent(id)}`, input)
      : await authed<CardDraftDto>("POST", `${MGMT}/card-drafts`, input);
    return { ok: true, draft: toCardDraft(data) };
  } catch (e) {
    if (id && isDraftNotFound(e)) return { ok: false, reason: "not_found" };
    if (e instanceof ApiError && ((e.code && CARD_DRAFT_PHOTO_ERRORS.includes(e.code)) || e.status === 413)) return { ok: false, reason: "photo" };
    if (e instanceof ApiError && e.code === "PJ-101") return { ok: false, reason: "invalid" };
    return { ok: false, reason: "failed" };
  }
}

/** [지우기] — 사진 · 칩 · 입력한 값 모두. 이미 없으면(계정을 만들었거나 다른 직원이 지움) 그대로 성공이에요(멱등). */
export async function deleteCardDraft(id: string): Promise<boolean> {
  try {
    await authed<{ deleted: boolean }>("DELETE", `${MGMT}/card-drafts/${encodeURIComponent(id)}`);
    return true;
  } catch (e) {
    return isDraftNotFound(e);
  }
}

// ───────────────────────── 계정 해지 (UG-443) ─────────────────────────
// 고객이 support@univs.ai 로 탈퇴를 요청하면 직원이 실행해요(약관 제27조). 순서: 로그인 막기 → 프로젝트 · 데이터 파기(되살리기 없음)
// → 계정 삭제 → 처리 기록. 서버가 단계마다 기록을 남기고 요청 밖에서 이어 가요 — 실행하면 바로 「처리 중」 줄이 생겨요.

/**
 * processing = 처리 중(주황) / failed = 멈춤(빨강 · [다시 시도]) / completed = 파기 완료(회색)
 * withdrawn = 철회됨(회색) — 아무것도 지우기 전에 직원이 거둠. 같은 계정을 나중에 다시 해지할 수 있어요.
 */
export type ClosureStatus = "processing" | "failed" | "completed" | "withdrawn";

/** 지금(또는 멈춘) 단계 — suspend 로그인 막기 · gate_purge 데이터 파기 · auth_delete 계정 삭제 · record 처리 기록 */
export type ClosureStep = "suspend" | "gate_purge" | "auth_delete" | "record";

/** 처리 기록 한 줄. 파기 완료한 기록은 고객 이메일 · 회사명을 서버가 비우고 도메인(@example.com)만 남겨요. */
export type Closure = {
  id: string;
  company: string | null;
  email: string | null;
  emailDomain: string;
  projectCount: number;
  status: ClosureStatus;
  /** 계정 서버의 정지 · 삭제 기능을 기다리는 중 — 상태는 처리 중으로 보여요 */
  authWaiting: boolean;
  step: ClosureStep;
  /** 멈춘 까닭(failed 일 때만) */
  failureCode: string | null;
  /** 고객이 탈퇴를 요청한 날(yyyy-MM-dd, 한국 날짜) */
  requestedOn: string;
  /** 실행한 직원 이메일(처리자) */
  processedBy: string;
  requestedAt: string;
  /** 파기 완료 시각 = 약관 「처리를 마친 날」 기준 */
  completedAt: string | null;
  retryCount: number;
  /** 지금 철회할 수 있어요 — 아직 아무것도 지우지 않았어요(로그인 막기 전 · 계정 서버 대기 또는 실패) */
  withdrawable: boolean;
  withdrawnAt: string | null;
  /** 철회한 직원 이메일 */
  withdrawnBy: string | null;
};

export type ClosureQuery = { keyword?: string; status?: ClosureStatus | "all"; page?: number; size?: number };

/** 계정 찾기(T2 → T3). 지워지는 것: 프로젝트(되살리기 기간 안인 삭제 프로젝트 포함) · 등록(얼굴 · 손바닥 각각) · 인증 기록 */
export type ClosureTarget = {
  accountId: string;
  email: string;
  company: string | null;
  signupType: "sales" | "direct";
  /** 가입일 — 영업 발급 계정만 알아요(직접 가입은 없음) */
  signedUpAt: string | null;
  projects: number;
  registrations: number;
  authRecords: number;
  /** 이미 실행한 해지 — 있으면 다시 실행할 수 없어요 */
  closure: Closure | null;
};

/**
 * not_found = 이 이메일로 가입한 계정이 없음(대소문자까지 같아야 해요) / staff = 백오피스 직원 계정이라 해지할 수 없음(MGMT-119)
 * failed = 서버 · 네트워크 문제
 */
export type FindClosureTargetResult = { ok: true; target: ClosureTarget } | { ok: false; reason: "not_found" | "staff" | "failed" };

/**
 * exists = 그사이 다른 직원이 같은 계정을 해지함(MGMT-116) / not_found = 그사이 계정이 없어짐(MGMT-118) / staff = 직원 계정(MGMT-119)
 * invalid = 확인 이메일 · 요청일을 서버가 받지 않음(PJ-101) / failed = 서버 · 네트워크 문제
 */
export type StartClosureResult =
  | { ok: true; closure: Closure }
  | { ok: false; reason: "exists" | "not_found" | "staff" | "invalid" | "failed" };

/** not_retryable = 이미 다른 직원이 다시 시도했거나 끝남(MGMT-117 · 105) / not_found = 기록 없음 / failed = 서버 · 네트워크 문제 */
export type RetryClosureResult = { ok: true; closure: Closure } | { ok: false; reason: "not_retryable" | "not_found" | "failed" };

const CLOSURES = `${MGMT}/closures`;

/** 처리 기록 목록 — 최근 실행이 맨 위. 검색어는 계정 이메일 · 회사명(파기 완료한 기록은 이메일 도메인으로만 걸려요). */
export async function listClosures(query: ClosureQuery = {}): Promise<{ items: Closure[]; total: number }> {
  const params = new URLSearchParams();
  if (query.keyword?.trim()) params.set("keyword", query.keyword.trim());
  params.set("status", query.status ?? "all");
  params.set("page", String(query.page ?? 1));
  params.set("size", String(query.size ?? 20));
  const data = await authed<{ content: Closure[]; totalElements: number }>("GET", `${CLOSURES}?${params}`);
  return { items: data.content, total: data.totalElements };
}

/** 탈퇴를 요청한 이메일로 계정을 찾아요(읽기만 해요). 이메일은 주소가 아니라 본문으로 보내요 — 서버 접근 기록에 남지 않게. */
export async function findClosureTarget(email: string): Promise<FindClosureTargetResult> {
  try {
    const data = await authed<{ found: boolean } & Partial<ClosureTarget>>("POST", `${CLOSURES}/target`, { email });
    if (!data.found || !data.accountId || !data.email) return { ok: false, reason: "not_found" };
    return {
      ok: true,
      target: {
        accountId: data.accountId,
        email: data.email,
        company: data.company ?? null,
        signupType: data.signupType === "sales" ? "sales" : "direct",
        signedUpAt: data.signedUpAt ?? null,
        projects: data.projects ?? 0,
        registrations: data.registrations ?? 0,
        authRecords: data.authRecords ?? 0,
        closure: data.closure ?? null,
      },
    };
  } catch (e) {
    if (e instanceof ApiError && e.code === "MGMT-119") return { ok: false, reason: "staff" };
    return { ok: false, reason: "failed" };
  }
}

/** [계정 해지] — 서버도 확인 이메일 · 요청일 · 계정을 다시 확인해요. 실행하면 바로 돌아오고 처리는 서버가 이어 가요. */
export async function startClosure(input: { email: string; confirmEmail: string; requestedOn: string }): Promise<StartClosureResult> {
  try {
    return { ok: true, closure: await authed<Closure>("POST", CLOSURES, input) };
  } catch (e) {
    if (e instanceof ApiError && e.code === "MGMT-116") return { ok: false, reason: "exists" };
    if (e instanceof ApiError && e.code === "MGMT-118") return { ok: false, reason: "not_found" };
    if (e instanceof ApiError && e.code === "MGMT-119") return { ok: false, reason: "staff" };
    if (e instanceof ApiError && e.code === "PJ-101") return { ok: false, reason: "invalid" };
    return { ok: false, reason: "failed" };
  }
}

/** [다시 시도] — 멈춘 단계부터 이어서 해요. */
export async function retryClosure(id: string): Promise<RetryClosureResult> {
  try {
    return { ok: true, closure: await authed<Closure>("POST", `${CLOSURES}/${encodeURIComponent(id)}/retry`) };
  } catch (e) {
    if (e instanceof ApiError && (e.code === "MGMT-117" || e.code === "MGMT-105")) return { ok: false, reason: "not_retryable" };
    if (e instanceof ApiError && e.code === "MGMT-115") return { ok: false, reason: "not_found" };
    return { ok: false, reason: "failed" };
  }
}

/** not_withdrawable = 그사이 로그인 막기가 시작됐거나 끝남(MGMT-120 · 105) / not_found = 기록 없음 / failed = 서버 · 네트워크 문제 */
export type WithdrawClosureResult = { ok: true; closure: Closure } | { ok: false; reason: "not_withdrawable" | "not_found" | "failed" };

/** [철회] — 아직 아무것도 지우지 않은 해지만 돼요. 로그인 막기가 된 뒤에는 서버가 거절해요. */
export async function withdrawClosure(id: string): Promise<WithdrawClosureResult> {
  try {
    return { ok: true, closure: await authed<Closure>("POST", `${CLOSURES}/${encodeURIComponent(id)}/withdraw`) };
  } catch (e) {
    if (e instanceof ApiError && (e.code === "MGMT-120" || e.code === "MGMT-105")) return { ok: false, reason: "not_withdrawable" };
    if (e instanceof ApiError && e.code === "MGMT-115") return { ok: false, reason: "not_found" };
    return { ok: false, reason: "failed" };
  }
}
