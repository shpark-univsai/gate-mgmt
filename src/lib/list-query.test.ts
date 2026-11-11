// 목록 거르기 조건 ↔ 주소(list-query.ts, UG-458) 시험 — 주소를 읽고 쓰는 화면 동작은 브라우저에서 확인.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  SALES_CLOSURES_HREF,
  parseAccountsQuery,
  parseClosuresQuery,
  serializeAccountsQuery,
  serializeClosuresQuery,
} from "./list-query.ts";

const q = (s: string) => new URLSearchParams(s);

test("계정 발급: 빈 주소는 전체 · 빈 검색어", () => {
  assert.deepEqual(parseAccountsQuery(q("")), { keyword: "", status: "all" });
});

test("계정 발급: 카드 · 검색어를 읽고 다시 쓰면 같은 주소", () => {
  const parsed = parseAccountsQuery(q("status=pending&keyword=company-a"));
  assert.deepEqual(parsed, { keyword: "company-a", status: "pending" });
  assert.equal(serializeAccountsQuery(parsed), "status=pending&keyword=company-a");
});

test("계정 발급: 옛 해지 거르기 주소(closing · closed · closed_all)는 전체로 열어요(기획 6)", () => {
  for (const old of ["closing", "closed", "closed_all"]) {
    assert.deepEqual(parseAccountsQuery(q(`status=${old}&keyword=x`)), { keyword: "x", status: "all" }, old);
  }
});

test("계정 발급: 모르는 값 · 기본값은 주소에 쓰지 않아요", () => {
  assert.equal(parseAccountsQuery(q("status=PENDING")).status, "all");
  assert.equal(serializeAccountsQuery({ keyword: "  ", status: "all" }), "");
  assert.equal(serializeAccountsQuery({ keyword: " 한글 회사 ", status: "in_use" }), "status=in_use&keyword=%ED%95%9C%EA%B8%80+%ED%9A%8C%EC%82%AC");
  assert.deepEqual(parseAccountsQuery(q(serializeAccountsQuery({ keyword: "a&b=c", status: "cancelled" }))), { keyword: "a&b=c", status: "cancelled" });
});

test("계정 해지: 상태 · 가입 경로 · 검색어", () => {
  assert.deepEqual(parseClosuresQuery(q("")), { keyword: "", status: "all", source: "all" });
  const parsed = parseClosuresQuery(q("source=direct&status=failed&keyword=user1%40example.com"));
  assert.deepEqual(parsed, { keyword: "user1@example.com", status: "failed", source: "direct" });
  assert.equal(serializeClosuresQuery(parsed), "source=direct&status=failed&keyword=user1%40example.com");
  assert.deepEqual(parseClosuresQuery(q("source=SALES&status=closing")), { keyword: "", status: "all", source: "all" });
});

test("「해지 N개 보기」 링크 = 영업 발급 · 철회 제외(기획 4 · 9)", () => {
  assert.equal(SALES_CLOSURES_HREF, "/closures?source=sales&status=not_withdrawn");
  assert.deepEqual(parseClosuresQuery(new URL(SALES_CLOSURES_HREF, "https://example.com").searchParams), {
    keyword: "",
    status: "not_withdrawn",
    source: "sales",
  });
});
