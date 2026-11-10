// 말줄임 판정(text-overflow.ts) 시험 — 소수점 폭 비교만(DOM 재기는 브라우저에서 확인).
import assert from "node:assert/strict";
import { test } from "node:test";

import { exceedsBox, tipOpensUp } from "./text-overflow.ts";

test("UG-453 17101 긴 말풍선이 아래에 다 들어가지 않고 위에 들어가면 위로 띄워요", () => {
  // 아래 100 · 위 300 · 말풍선(여백 포함) 117 — 전에는 아래로 펴져 17px 잘렸어요
  assert.equal(tipOpensUp(100, 300, 117), true);
  // 위에도 모자라면 아래 그대로(첫 줄이 잘리지 않게)
  assert.equal(tipOpensUp(100, 110, 117), false);
  // 아래에 다 들어가면 아래
  assert.equal(tipOpensUp(117, 300, 117), false);
  assert.equal(tipOpensUp(400, 300, 117), false);
});

test("UG-453 17101 한두 줄 말풍선은 전과 같아요 — 아래 자리가 72 보다 모자라면 위로", () => {
  assert.equal(tipOpensUp(71, 20, 42), true);
  assert.equal(tipOpensUp(72, 500, 42), false);
});

test("UG-450 17003 1px 보다 덜 넘쳐도 말줄임으로 봐요", () => {
  assert.equal(exceedsBox(358.25, 358), true);
  assert.equal(exceedsBox(358.02, 358), true);
  assert.equal(exceedsBox(400, 358), true);
});

test("UG-450 17003 딱 맞거나 짧으면 · 반올림 오차만큼이면 말줄임이 아니에요", () => {
  assert.equal(exceedsBox(358, 358), false);
  assert.equal(exceedsBox(358.005, 358), false);
  assert.equal(exceedsBox(120.5, 358), false);
});
