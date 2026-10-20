// 서버 연결 지점.
// 지금은 목업이에요. 플랫폼 팀이 서버 API를 붙일 때 아래 세 함수의 몸통만 바꾸면 돼요.
// 서버 주소는 NEXT_PUBLIC_API_BASE_URL 환경변수로 받습니다(.env.example).
//
// 목업에서 화면 상태를 확인하는 방법(고객 이메일 칸에 입력):
//   taken@example.com → 이미 계정이 있는 이메일(첫 로그인 전 → 다시 보내기 가능)
//   inuse@example.com → 이미 사용 중인 계정(다시 보내기 없음)
//   limit@example.com → 오늘 보낼 수 있는 수를 넘음
//   fail@example.com  → 그 밖의 실패
// 로그인 목업은 비밀번호가 "wrong"이면 실패해요.

export type MailLanguage = "en" | "ko";

// 백오피스 계정(영업 · 대표). 플랫폼 팀이 서버에서 직접 만들어 줘요(만드는 화면 없음).
// 이름 · 전화 · 이메일은 안내 메일의 담당자 칸({sales_name} {sales_phone} {sales_email})에 들어가요.
export type Staff = {
  name: string;
  team: string;
  phone: string;
  email: string;
};

export type CreateAccountInput = {
  company: string;
  email: string;
  language: MailLanguage;
};

export type CreateAccountResult =
  | { ok: true; requestedAt: string }
  // duplicate = 영업이 만들었고 고객이 아직 첫 로그인 전 → 다시 보내기 가능
  // in_use = 고객이 직접 가입했거나 로그인한 적 있음 → 다시 보내면 쓰던 비밀번호가 막히므로 보내지 않음
  | { ok: false; reason: "duplicate" | "in_use" | "daily_limit" | "failed" };

export type ResendResult =
  | { ok: true; requestedAt: string }
  | { ok: false; reason: "daily_limit" | "failed" };

export type LoginResult = { ok: true; staff: Staff } | { ok: false };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function login(email: string, password: string): Promise<LoginResult> {
  await wait(500);
  if (password === "wrong") return { ok: false };
  return { ok: true, staff: { name: "김영업", team: "영업팀", phone: "010-0000-0000", email } };
}

/** 고객 계정 생성 + 임시 비밀번호 + 데모 프로젝트 1개 + 안내 메일 발송을 한 번에 요청 */
export async function createAccount(input: CreateAccountInput): Promise<CreateAccountResult> {
  await wait(800);
  const email = input.email.toLowerCase();
  if (email === "taken@example.com") return { ok: false, reason: "duplicate" };
  if (email === "inuse@example.com") return { ok: false, reason: "in_use" };
  if (email === "limit@example.com") return { ok: false, reason: "daily_limit" };
  if (email === "fail@example.com") return { ok: false, reason: "failed" };
  return { ok: true, requestedAt: new Date().toISOString() };
}

/** 이미 있는 계정에 새 임시 비밀번호로 안내 메일을 다시 보냄(이전 비밀번호는 무효) */
export async function resendGuide(input: CreateAccountInput): Promise<ResendResult> {
  await wait(800);
  if (input.email.toLowerCase() === "fail@example.com") return { ok: false, reason: "failed" };
  return { ok: true, requestedAt: new Date().toISOString() };
}
