// 목업 로그인 상태. 화면 이동용일 뿐 보안이 아니에요 — 권한 검사는 서버가 합니다.
import { useSyncExternalStore } from "react";
import type { Staff } from "./api";

const KEY = "gate-mgmt.staff";

export function saveStaff(staff: Staff) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(staff));
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
