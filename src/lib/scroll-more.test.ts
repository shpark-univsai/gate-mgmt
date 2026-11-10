// 옆으로 미는 줄의 「오른쪽에 더 있음」 판정(scroll-more.ts) 시험 — 숫자 비교만(실제 밀기는 브라우저에서 확인).
import assert from "node:assert/strict";
import { test } from "node:test";

import { hasMoreToRight } from "./scroll-more.ts";

test("UG-453 17110 칩 줄이 화면보다 넓으면 처음부터 오른쪽에 더 있어요", () => {
  // 줄 358 · 칩 전체 408 — 「해지」 칩이 화면 밖
  assert.equal(hasMoreToRight(0, 358, 408), true);
  assert.equal(hasMoreToRight(20, 358, 408), true);
});

test("UG-453 17110 끝까지 밀면 더 없어요 — 소수점 · 반올림으로 1px 덜 밀려도 끝으로 봐요", () => {
  assert.equal(hasMoreToRight(50, 358, 408), false);
  assert.equal(hasMoreToRight(49.5, 358, 408), false);
  assert.equal(hasMoreToRight(49, 358, 408), false);
  // 아이폰처럼 끝을 지나 더 당겨져도(튕김) 더 없어요
  assert.equal(hasMoreToRight(62, 358, 408), false);
});

test("UG-453 17110 넘치지 않는 폭에서는 처음부터 없어요", () => {
  assert.equal(hasMoreToRight(0, 358, 358), false);
  assert.equal(hasMoreToRight(0, 608, 408), false);
  // PC · 아이패드: 칩 줄이 숨겨져(display: none) 폭이 모두 0
  assert.equal(hasMoreToRight(0, 0, 0), false);
});
