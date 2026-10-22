// 서버 호출 공통부. 게이트웨이(api-*.univsgate.com)를 직접 불러요 — gate-web 과 같은 방식이에요.
// 주소는 빌드에 넣지 않고 /config.js(런타임 설정)에서 읽어요. 응답은 {success, data, errors} 봉투예요.
import { clearSession, getTokens, saveTokens } from "./session";

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
    res = await fetch(`${apiOrigin()}${path}`, { ...init, method, headers });
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

// 액세스 토큰이 만료되면(401) 한 번만 재발급하고 다시 불러요. 동시에 여러 요청이 401 을 받아도 재발급은 한 번만 해요.
let refreshing: Promise<string> | null = null;

function refreshAccessToken(): Promise<string> {
  if (!refreshing) {
    refreshing = (async () => {
      const refreshToken = getTokens()?.refreshToken;
      if (!refreshToken) throw new ApiError(401);
      const data = await publicPost<{ accessToken: string; refreshToken?: string }>("/api/v1/auth/token/refresh", {
        refreshToken,
      });
      // auth 는 재발급 때 리프레시 토큰도 새로 줄 수 있어요(1회용). 주면 바꿔 둬요.
      saveTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken ?? refreshToken });
      return data.accessToken;
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

/** 로그인이 끊겼어요(재발급 실패 · 백오피스 권한 없음) — 이 탭의 로그인 상태를 지우고 로그인 화면으로 보내요. */
function sessionEnded(): never {
  clearSession();
  window.location.replace("/login");
  throw new ApiError(401);
}

/** 직원 토큰을 붙여 부르는 백오피스 API */
export async function authed<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = body === undefined ? {} : json(body);
  const token = getTokens()?.accessToken;
  if (!token) sessionEnded();
  try {
    return await send<T>(method, path, init, token);
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    // 허용 목록에서 빠진 직원(MGMT-106)은 다시 로그인해도 같아요 — 로그인 화면이 안내해요.
    if (e.status === 403 && e.code === "MGMT-106") sessionEnded();
    if (e.status !== 401) throw e;
  }
  let fresh: string;
  try {
    fresh = await refreshAccessToken();
  } catch {
    sessionEnded();
  }
  try {
    return await send<T>(method, path, init, fresh);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) sessionEnded();
    throw e;
  }
}
