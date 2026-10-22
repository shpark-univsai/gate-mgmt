// 서버 호출 공통부. 게이트웨이(api-*.univsgate.com)를 직접 불러요 — gate-web 과 같은 방식이에요.
// 주소는 빌드에 넣지 않고 /config.js(런타임 설정)에서 읽어요. 응답은 {success, data, errors} 봉투예요.
import { clearSession, getTokens, saveTokens, setLoginReason, type LoginReason } from "./session";

declare global {
  interface Window {
    __APP_CONFIG__?: { apiOrigin?: string };
  }
}

/** 서버가 거절한 요청. status = HTTP 상태(네트워크 오류는 0), code = 서버 오류 코드(예: MGMT-102) */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code?: string,
    message?: string,
  ) {
    super(message ?? `HTTP ${status}`);
  }
}

type Envelope<T> = {
  success: boolean;
  data: T;
  errors: { code: string; type: string; message: string } | null;
};

function apiOrigin(): string {
  const origin = typeof window !== "undefined" ? window.__APP_CONFIG__?.apiOrigin : undefined;
  if (!origin) throw new ApiError(0, undefined, "config.js 에 apiOrigin 이 없어요");
  return origin.replace(/\/+$/, "");
}

const json = (body: unknown) => ({
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/** 한 번만 불러요(재발급 · 로그인 화면 이동 없음). 보통은 아래 authed · publicPost 를 써요. */
export async function send<T>(method: string, path: string, init: RequestInit, token?: string): Promise<T> {
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  let res: Response;
  try {
    // 응답이 끝내 오지 않으면 30초에 끊어요 — 재발급 잠금이 다른 탭을 오래 붙잡지 않게.
    res = await fetch(`${apiOrigin()}${path}`, { ...init, method, headers, signal: init.signal ?? AbortSignal.timeout(30_000) });
  } catch {
    throw new ApiError(0);
  }
  let envelope: Envelope<T> | null = null;
  try {
    envelope = (await res.json()) as Envelope<T>;
  } catch {
    // 게이트웨이 · 프록시가 봉투 없이 답한 경우(502 등)
  }
  if (!res.ok || !envelope?.success) {
    throw new ApiError(res.status, envelope?.errors?.code, envelope?.errors?.message);
  }
  return envelope.data;
}

/** 로그인 · 토큰 재발급처럼 토큰 없이 부르는 auth 공개 경로 */
export function publicPost<T>(path: string, body: unknown): Promise<T> {
  return send<T>("POST", path, json(body));
}

/** 리프레시 토큰을 서버에서 끝내요(로그아웃). 실패(만료 · 오프라인)해도 토큰은 시간이 지나면 끝나요. */
export function revokeRefreshToken(refreshToken: string) {
  publicPost("/api/v1/auth/logout", { refreshToken }).catch(() => {});
}

/**
 * 액세스 토큰이 만료되면(401) 재발급해요. 리프레시 토큰은 1회용이라 탭끼리 동시에 쓰면 안 돼요 —
 * 브라우저 잠금(navigator.locks)으로 한 번에 한 탭만 재발급하고, 잠금을 얻은 뒤 다른 탭이 이미 바꿨으면 그 토큰을 써요.
 * @param staleAccess 401 을 받은 액세스 토큰
 */
async function refreshAccessToken(staleAccess: string): Promise<string> {
  const run = async () => {
    const current = getTokens();
    if (!current) throw new ApiError(401);
    if (current.accessToken !== staleAccess) return current.accessToken; // 다른 탭 · 요청이 먼저 바꿨어요
    const data = await publicPost<{ accessToken: string; refreshToken?: string }>("/api/v1/auth/token/refresh", {
      refreshToken: current.refreshToken,
    });
    // 기다리는 사이 로그아웃했으면 되살리지 않아요 — 방금 받은 토큰도 서버에서 끝내요.
    if (getTokens()?.refreshToken !== current.refreshToken) {
      if (data.refreshToken) revokeRefreshToken(data.refreshToken);
      throw new ApiError(401);
    }
    // auth 는 재발급 때 리프레시 토큰도 새로 줄 수 있어요(1회용). 주면 바꿔 둬요.
    saveTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken ?? current.refreshToken });
    return data.accessToken;
  };
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request("gate-mgmt.token-refresh", run);
  }
  return inTabOnce(run);
}

// navigator.locks 가 없는 브라우저: 이 탭 안에서만 한 번으로 묶어요.
let refreshing: Promise<string> | null = null;
function inTabOnce(run: () => Promise<string>): Promise<string> {
  if (!refreshing) refreshing = run().finally(() => (refreshing = null));
  return refreshing;
}

/**
 * 로그인이 끊겼어요(재발급 실패 · 백오피스 권한 없음) — 로그인 상태를 지우고 이유와 함께 로그인 화면으로 보내요.
 * 토큰이 이미 없으면(이 탭 · 다른 탭에서 직접 로그아웃) 안내 없이 보내요.
 */
function sessionEnded(reason: LoginReason): never {
  const loggedOut = getTokens() === null;
  clearSession();
  if (!loggedOut) setLoginReason(reason);
  window.location.replace("/login");
  throw new ApiError(401);
}

/** 직원 토큰을 붙여 부르는 백오피스 API */
export async function authed<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = body === undefined ? {} : json(body);
  const token = getTokens()?.accessToken;
  if (!token) sessionEnded("expired");
  try {
    return await send<T>(method, path, init, token);
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    // 허용 목록에서 빠진 직원(MGMT-106)은 다시 로그인해도 같아요 — 로그인 화면이 이유를 보여 줘요.
    if (e.status === 403 && e.code === "MGMT-106") sessionEnded("forbidden");
    if (e.status !== 401) throw e;
  }
  let fresh: string;
  try {
    fresh = await refreshAccessToken(token);
  } catch {
    sessionEnded("expired");
  }
  try {
    return await send<T>(method, path, init, fresh);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) sessionEnded("expired");
    if (e instanceof ApiError && e.status === 403 && e.code === "MGMT-106") sessionEnded("forbidden");
    throw e;
  }
}
