// 서버 연결 지점.
// 지금은 목업이에요(이 탭 안에서만 유지되는 메모리 저장소). 플랫폼 팀이 서버 API를 붙일 때
// 아래 함수들의 몸통만 바꾸면 돼요. 서버 주소는 따로 받지 않고 같은 출처의 상대 경로(예: fetch("/api/v1/..."))로
// 부릅니다 — 배포 컨테이너의 nginx 가 /api/ 를 환경별 게이트웨이로 넘겨요(.env.example 참고).
//
// 목업에서 화면 상태를 확인하는 방법(계정 만들기 창의 고객 이메일 칸):
//   목록에 「첫 로그인 전」인 이메일 → 이미 만든 계정(다시 보내기 가능, 처음 보낸 언어로 미리 선택)
//   inuse@example.com 또는 목록에 「사용 중」인 이메일 → 이미 사용 중(다시 보내기 없음)
//   fail@example.com  → 그 밖의 실패
// 발급 취소 목업: user7@example.com(Company G)은 누르는 순간 고객이 로그인한 경우(취소 안 됨 → 「사용 중」으로 바뀜).
// 로그인 목업은 비밀번호가 "wrong"이면 실패해요.

export type MailLanguage = "en" | "ko";

// 백오피스 계정(영업 · 대표). 플랫폼 팀이 서버에서 직접 만들어 줘요(만드는 화면 없음).
// 직원 이름은 어디에도 두지 않아요(개인정보). 회사 이메일로만 구분하고, 안내 메일 담당자 칸({sales_email})에도 이메일이 들어가요.
// 전화는 메일 템플릿의 회사 대표번호로 고정.
export type Staff = {
  email: string;
};

/** pending = 영업이 만들었고 고객이 아직 첫 로그인 전 / in_use = 고객이 직접 가입했거나 로그인한 적 있음 */
export type AccountStatus = "pending" | "in_use";

export type Account = {
  id: string;
  company: string;
  email: string;
  language: MailLanguage;
  status: AccountStatus;
  /** 만든 직원의 회사 이메일 */
  createdBy: string;
  createdAt: string;
  /** 데모 프로젝트에 쌓인 데모 기록 수. 로그인 없이 체험 링크로 써 봤을 수 있어서 발급 취소 확인 창에 보여 줘요. */
  demoRecords: number;
};

export type AccountQuery = { keyword?: string; status?: AccountStatus | "all" };

export type CreateAccountInput = {
  company: string;
  email: string;
  language: MailLanguage;
};

/**
 * 이메일 칸을 벗어날 때 하는 미리 조회. 보내기 전에 상태를 보여 주려고 써요.
 * 서버는 보내기 때도 같은 판정을 다시 해요(조회와 보내기 사이에 바뀔 수 있어서).
 */
export type EmailCheck =
  | { status: "new" }
  | { status: "pending"; createdBy: string; createdAt: string; language: MailLanguage }
  | { status: "in_use" };

export type CreateAccountResult =
  | { ok: true; account: Account }
  // duplicate = 첫 로그인 전 계정이 이미 있음(다시 보내기로 안내) / in_use = 쓰던 비밀번호가 막히므로 보내지 않음
  | { ok: false; reason: "duplicate" | "in_use" | "failed" };

// 만들기 · 다시 보내기 모두 하루 제한은 두지 않아요.
export type ResendResult = { ok: true; requestedAt: string } | { ok: false; reason: "failed" };

/** 발급 취소. in_use = 누르는 사이 고객이 로그인해서 취소하지 않음(서버가 누를 때 다시 판정) */
export type CancelResult = { ok: true } | { ok: false; reason: "in_use" | "failed" };

export type LoginResult = { ok: true; staff: Staff } | { ok: false };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── 목업 데이터(지어낸 값) ──
let seq = 100;
const id = (email: string) => email.replace(/\D/g, "") || "0";
const seedRows: [string, string, MailLanguage, AccountStatus, string, string][] = [
  ["Company A", "user1@example.com", "en", "pending", "kim.sales@example.com", "2026-10-20T06:20:00Z"],
  ["Company B", "user2@example.com", "ko", "in_use", "park.ceo@example.com", "2026-10-18T02:02:00Z"],
  ["Company C", "user3@example.com", "en", "in_use", "kim.sales@example.com", "2026-10-16T00:40:00Z"],
  ["Company D", "user4@example.com", "ko", "pending", "lee.sales@example.com", "2026-10-15T08:25:00Z"],
  ["Company E", "user5@example.com", "en", "in_use", "park.ceo@example.com", "2026-10-12T05:10:00Z"],
  ["Company F", "user6@example.com", "ko", "in_use", "lee.sales@example.com", "2026-10-08T01:05:00Z"],
  ["Company G", "user7@example.com", "en", "pending", "kim.sales@example.com", "2026-10-02T07:30:00Z"],
  ["Company H", "user8@example.com", "ko", "in_use", "kim.sales@example.com", "2026-09-28T04:45:00Z"],
];
const store: Account[] = seedRows.map(([company, email, language, status, createdBy, createdAt]) => ({
  id: String(seq++),
  company,
  email,
  language,
  status,
  createdBy,
  createdAt,
  demoRecords: status === "pending" ? (Number(id(email)) % 4) : 0,
}));

export async function login(email: string, password: string): Promise<LoginResult> {
  await wait(500);
  if (password === "wrong") return { ok: false };
  return { ok: true, staff: { email } };
}

/** 계정 발급 목록. 모든 직원이 만든 계정을 최신순으로 보여 줘요. */
export async function listAccounts(query: AccountQuery = {}): Promise<Account[]> {
  await wait(200);
  const k = (query.keyword ?? "").trim().toLowerCase();
  return store
    .filter((a) => (query.status && query.status !== "all" ? a.status === query.status : true))
    .filter((a) => (k ? a.company.toLowerCase().includes(k) || a.email.toLowerCase().includes(k) : true))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function checkEmail(email: string): Promise<EmailCheck> {
  await wait(300);
  const e = email.toLowerCase();
  if (e === "inuse@example.com") return { status: "in_use" };
  const found = store.find((a) => a.email.toLowerCase() === e);
  if (!found) return { status: "new" };
  if (found.status === "in_use") return { status: "in_use" };
  return { status: "pending", createdBy: found.createdBy, createdAt: found.createdAt, language: found.language };
}

/** 고객 계정 생성 + 임시 비밀번호 + 데모 프로젝트 1개 + 안내 메일 발송을 한 번에 요청 */
export async function createAccount(input: CreateAccountInput, staff: Staff): Promise<CreateAccountResult> {
  await wait(800);
  const e = input.email.toLowerCase();
  if (e === "fail@example.com") return { ok: false, reason: "failed" };
  const check = await checkEmail(e);
  if (check.status === "pending") return { ok: false, reason: "duplicate" };
  if (check.status === "in_use") return { ok: false, reason: "in_use" };
  const account: Account = {
    id: String(seq++),
    ...input,
    status: "pending",
    createdBy: staff.email,
    createdAt: new Date().toISOString(),
    demoRecords: 0,
  };
  store.unshift(account);
  return { ok: true, account };
}

/** 첫 로그인 전 계정에 새 임시 비밀번호로 안내 메일을 다시 보냄(이전 비밀번호는 무효) */
export async function resendGuide(input: CreateAccountInput): Promise<ResendResult> {
  await wait(800);
  if (input.email.toLowerCase() === "fail@example.com") return { ok: false, reason: "failed" };
  return { ok: true, requestedAt: new Date().toISOString() };
}

/**
 * 첫 로그인 전 계정의 발급 취소: 계정 · 데모 프로젝트(데모 기록 포함)를 지우고, 보낸 메일의 임시 비밀번호와 체험 링크를 막아요.
 * 취소 안내 메일은 보내지 않아요. 지운 뒤에는 같은 이메일로 다시 발급할 수 있어요.
 */
export async function cancelIssue(accountId: string): Promise<CancelResult> {
  await wait(800);
  const i = store.findIndex((a) => a.id === accountId);
  if (i < 0) return { ok: false, reason: "failed" };
  const a = store[i];
  if (a.email === "user7@example.com" || a.status === "in_use") {
    a.status = "in_use";
    return { ok: false, reason: "in_use" };
  }
  store.splice(i, 1);
  return { ok: true };
}
