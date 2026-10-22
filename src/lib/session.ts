// 로그인 상태. 직원 정보(화면 이동용)와 토큰(서버 호출용)을 이 브라우저(localStorage)에 둬요 — gate-web 과 같아요.
// 탭끼리 공유해요: 탭을 복제하거나 새 탭을 열어도 같은 토큰을 쓰고, 한 탭에서 로그아웃하면 다른 탭도 로그인 화면으로 가요.
// (탭마다 따로 두면 복제한 탭이 이미 바뀐 1회용 리프레시 토큰을 다시 써서, 서버가 그 직원의 모든 세션을 끊어요.)
// 권한 검사는 서버가 합니다.
import { useSyncExternalStore } from "react";
import type { Staff } from "./api";

const KEY = "gate-mgmt.staff";
const TOKEN_KEY = "gate-mgmt.tokens";
const REASON_KEY = "gate-mgmt.login-reason";

export type Tokens = { accessToken: string; refreshToken: string };

// 로그인 화면이 한 번 읽은 「세션이 끊긴 이유」(읽으면서 지우므로 다시 그려도 같은 값을 보여 주려고 둬요).
let takenReason: LoginReason | null | undefined;

/** 로그인 화면이 한 번 보여 줄 안내. expired = 로그인이 만료됨, forbidden = 백오피스 권한이 없어짐 */
export type LoginReason = "expired" | "forbidden";

export function saveStaff(staff: Staff) {
  takenReason = undefined; // 다음에 로그인 화면에 올 때 지난 안내가 남지 않게
  try {
    localStorage.setItem(KEY, JSON.stringify(staff));
  } catch {}
}

export function saveTokens(tokens: Tokens) {
  try {
    localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
  } catch {}
}

export function getTokens(): Tokens | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    return raw ? (JSON.parse(raw) as Tokens) : null;
  } catch {
    return null;
  }
}

/** 로그인 상태(직원 정보 · 토큰)를 지워요. 서버 세션 종료는 api.ts 의 logout 이 함께 해요. */
export function clearSession() {
  takenReason = undefined;
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

/** 세션이 끊겨 로그인 화면으로 보낼 때 이유를 남겨요. 로그인 화면이 한 번 읽고 지워요. */
export function setLoginReason(reason: LoginReason) {
  try {
    sessionStorage.setItem(REASON_KEY, reason);
  } catch {}
}

function reasonSnapshot(): LoginReason | null {
  if (takenReason === undefined) {
    try {
      const reason = sessionStorage.getItem(REASON_KEY);
      sessionStorage.removeItem(REASON_KEY);
      takenReason = reason === "expired" || reason === "forbidden" ? reason : null;
    } catch {
      takenReason = null;
    }
  }
  return takenReason;
}

/** 로그인 화면이 쓰는 훅 — 세션이 끊긴 이유(없으면 null). 한 번 읽고 지워요. */
export function useLoginReason(): LoginReason | null {
  return useSyncExternalStore(noop, reasonSnapshot, () => null);
}

let cachedRaw: string | null = null;
let cachedStaff: Staff | null = null;

function snapshot(): Staff | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {}
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      cachedStaff = raw ? (JSON.parse(raw) as Staff) : null;
    } catch {
      cachedStaff = null;
    }
  }
  return cachedStaff;
}

const noop = () => () => {};

/** 다른 탭에서 로그인 · 로그아웃하면 이 탭도 따라가요(storage 이벤트는 다른 탭의 변경만 알려 줘요). */
function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

/** 화면에서 쓰는 훅. undefined = 아직 모름(서버 렌더링), null = 로그인 안 함 */
export function useStaff(): Staff | null | undefined {
  return useSyncExternalStore(subscribe, snapshot, () => undefined);
}
