// 말줄임 판정(text-overflow.ts) 시험 — 소수점 폭 비교만(DOM 재기는 브라우저에서 확인).
import assert from "node:assert/strict";
import { test } from "node:test";

import { exceedsBox } from "./text-overflow.ts";

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
