// 목록 화면의 거르기 조건을 주소(?…)에 둬요(UG-458 기획 6 · 9). 새로 고쳐도 조건이 남고, 계정 해지로 갔다가 뒤로 가면
// 계정 발급의 고른 카드 · 검색어가 그대로 돌아와요. 화면에 기대지 않는 순수 함수만 둬요(list-query.test.ts) — 주소를 읽고 쓰는 것은 use-url-query.ts.
// 기본값(전체 · 빈 검색어)은 주소에 쓰지 않아요 — 조건이 없으면 주소도 깨끗하게. 모르는 값은 기본값으로 봐요(옛 주소 · 손으로 고친 주소).
import type { AccountStatusFilter, ClosureSource, ClosureStatusFilter } from "./api";

/** 계정 발급 목록 — status = 고른 카드(PC) · 칩(휴대폰) · 선택 상자, keyword = 검색어 */
export type AccountsQuery = { keyword: string; status: AccountStatusFilter };
/** 계정 해지 목록 — status = 상태, source = 가입 경로(UG-458 기획 8), keyword = 검색어 */
export type ClosuresQuery = { keyword: string; status: ClosureStatusFilter; source: ClosureSource };

export const ACCOUNTS_DEFAULT: AccountsQuery = { keyword: "", status: "all" };
export const CLOSURES_DEFAULT: ClosuresQuery = { keyword: "", status: "all", source: "all" };

// 해지 중 · 해지됨 · 해지(closing · closed · closed_all)는 목록에서 빠졌어요(UG-458 기획 1 · 2) — 그런 옛 주소는 「전체」로 열어요(기획 6)
const ACCOUNT_STATUSES: readonly string[] = ["all", "pending", "in_use", "cancelled"] satisfies AccountStatusFilter[];
const CLOSURE_STATUSES: readonly string[] = ["all", "not_withdrawn", "processing", "failed", "completed", "withdrawn"] satisfies ClosureStatusFilter[];
const CLOSURE_SOURCES: readonly string[] = ["all", "sales", "direct"] satisfies ClosureSource[];

const pick = <T extends string>(allowed: readonly string[], value: string | null, fallback: T): T =>
  value !== null && allowed.includes(value) ? (value as T) : fallback;

export function parseAccountsQuery(params: URLSearchParams): AccountsQuery {
  return {
    keyword: (params.get("keyword") ?? "").trim(),
    status: pick(ACCOUNT_STATUSES, params.get("status"), ACCOUNTS_DEFAULT.status),
  };
}

export function serializeAccountsQuery(q: AccountsQuery): string {
  const params = new URLSearchParams();
  if (q.status !== "all") params.set("status", q.status);
  if (q.keyword.trim()) params.set("keyword", q.keyword.trim());
  return params.toString();
}

export function parseClosuresQuery(params: URLSearchParams): ClosuresQuery {
  return {
    keyword: (params.get("keyword") ?? "").trim(),
    status: pick(CLOSURE_STATUSES, params.get("status"), CLOSURES_DEFAULT.status),
    source: pick(CLOSURE_SOURCES, params.get("source"), CLOSURES_DEFAULT.source),
  };
}

export function serializeClosuresQuery(q: ClosuresQuery): string {
  const params = new URLSearchParams();
  if (q.source !== "all") params.set("source", q.source);
  if (q.status !== "all") params.set("status", q.status);
  if (q.keyword.trim()) params.set("keyword", q.keyword.trim());
  return params.toString();
}

/**
 * 계정 발급 「해지 N개 보기」가 여는 계정 해지 주소(UG-458 기획 4 · 9) — 영업 발급 · 철회 제외.
 * N(요약의 salesClosures)과 같은 범위라 열면 줄 수가 N 과 같아요.
 */
export const SALES_CLOSURES_HREF = `/closures?${serializeClosuresQuery({ keyword: "", status: "not_withdrawn", source: "sales" })}`;
