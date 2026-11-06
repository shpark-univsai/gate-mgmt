// 글자 읽기 도구 다시 받기 규칙(ocr-retry.ts) 시험 — UG-451 기획 17022: 찍을 때마다 한 번, 페이지에서 모두 합쳐 3번까지.
import assert from "node:assert/strict";
import { test } from "node:test";

import { createRetryBudget, loadWithRetry, type RetryBudget } from "./ocr-retry.ts";

/** 받기 한 번(찍기 한 번) — fails = 앞에서부터 실패할 횟수. 부른 횟수를 돌려줘요 */
async function capture(budget: RetryBudget, fails: number, opts: { live?: () => boolean; now?: () => number } = {}) {
  let calls = 0;
  let ok = false;
  try {
    await loadWithRetry({
      start: async () => {
        calls++;
        if (calls <= fails) throw new Error("lang data");
        return "worker";
      },
      budget,
      live: opts.live ?? (() => true),
      started: 0,
      maxMs: 300_000,
      delayMs: 2_000,
      now: opts.now ?? (() => 1_000),
      sleep: async () => undefined,
    });
    ok = true;
  } catch {
    ok = false;
  }
  return { calls, ok };
}

test("UG-451 17022 · 찍을 때마다 한 번 다시 받아요(페이지에 한 번이 아니라)", async () => {
  const budget = createRetryBudget(3);
  // 첫 찍기: 한 번 실패 → 다시 받아 성공
  assert.deepEqual(await capture(budget, 1), { calls: 2, ok: true });
  // 다음 찍기도 자기 몫의 한 번이 있어요
  assert.deepEqual(await capture(budget, 1), { calls: 2, ok: true });
  // 한 찍기에서 두 번 실패하면 더 받지 않아요(한 번만)
  assert.deepEqual(await capture(budget, 5), { calls: 2, ok: false });
  assert.equal(budget.spent, true);
});

test("UG-451 17022 · 페이지에서 다시 받기는 모두 합쳐 3번 — 다 쓰면 다시 받지 않고 spent", async () => {
  const budget = createRetryBudget(3);
  for (let i = 0; i < 3; i++) {
    assert.equal(budget.spent, false, `${i}`);
    assert.deepEqual(await capture(budget, 5), { calls: 2, ok: false }, `${i}`);
  }
  assert.equal(budget.spent, true);
  // 넷째 찍기는 한 번만 받아요(닫지 못하는 일꾼이 더 쌓이지 않게)
  assert.deepEqual(await capture(budget, 5), { calls: 1, ok: false });
  // 처음 받기가 되면 그대로 써요
  assert.deepEqual(await capture(budget, 0), { calls: 1, ok: true });
});

test("UG-451 17022 · 성공한 받기는 다시 받기를 쓰지 않아요", async () => {
  const budget = createRetryBudget(3);
  for (let i = 0; i < 5; i++) assert.deepEqual(await capture(budget, 0), { calls: 1, ok: true });
  assert.equal(budget.spent, false);
});

test("UG-451 · 시간 초과 · 창 닫기 뒤나 5분 한도가 모자라면 다시 받지 않고 몫도 쓰지 않아요", async () => {
  // 몫이 하나뿐이어도 아래 세 경우 모두 쓰지 않아요
  const budget = createRetryBudget(1);
  assert.deepEqual(await capture(budget, 1, { live: () => false }), { calls: 1, ok: false });
  assert.deepEqual(await capture(budget, 1, { now: () => 299_000 }), { calls: 1, ok: false });
  assert.equal(budget.spent, false);
  // 쉬는 사이 창을 닫았으면 다시 받지 않아요
  let live = true;
  let calls = 0;
  await assert.rejects(
    loadWithRetry({
      start: async () => {
        calls++;
        throw new Error("lang data");
      },
      budget,
      live: () => live,
      started: 0,
      maxMs: 300_000,
      delayMs: 2_000,
      now: () => 1_000,
      sleep: async () => {
        live = false;
      },
    }),
  );
  assert.equal(calls, 1);
  // 쉬는 사이 닫혀 다시 받지 않았으면 몫도 그대로예요(반박 리뷰 F5)
  assert.equal(budget.spent, false);
  assert.deepEqual(await capture(budget, 1), { calls: 2, ok: true });
  assert.equal(budget.spent, true);
});
