// 로그인 상태. 이 탭(sessionStorage)에만 둬요 — 탭을 닫으면 로그아웃돼요(백오피스라 오래 남기지 않아요).
// 화면 이동용 직원 정보와 서버 호출용 토큰을 함께 둬요. 권한 검사는 서버가 합니다.
import { useSyncExternalStore } from "react";
import type { Staff } from "./api";

const KEY = "gate-mgmt.staff";
const TOKEN_KEY = "gate-mgmt.tokens";

export type Tokens = { accessToken: string; refreshToken: string };

export function saveStaff(staff: Staff) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(staff));
  } catch {}
}

export function saveTokens(tokens: Tokens) {
  try {
    sessionStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
  } catch {}
}

export function getTokens(): Tokens | null {
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY);
    return raw ? (JSON.parse(raw) as Tokens) : null;
  } catch {
    return null;
  }
}

/** 이 탭의 로그인 상태(직원 정보 · 토큰)를 지워요. 서버 세션 종료는 api.ts 의 logout 이 함께 해요. */
export function clearSession() {
  try {
    sessionStorage.removeItem(KEY);
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {}
}

let cachedRaw: string | null = null;
let cachedStaff: Staff | null = null;

function snapshot(): Staff | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(KEY);
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

/** 화면에서 쓰는 훅. undefined = 아직 모름(서버 렌더링), null = 로그인 안 함 */
export function useStaff(): Staff | null | undefined {
  return useSyncExternalStore(noop, snapshot, () => undefined);
}
