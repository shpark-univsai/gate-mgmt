// 명함 방향 맞추기(card-rotate.ts) 시험 — `npm test`.
import assert from "node:assert/strict";
import { test } from "node:test";

import { ROTATE_START_LIMIT_MS, ROTATE_TOTAL_MS, ROTATIONS, needsRetry, pickReading, rotateBudget, type ReadingScore } from "./card-rotate.ts";

const score = (found: number, candidate = false, confidence = 0): ReadingScore => ({ found, candidate, confidence });

test("UG-451 17106-3 읽는 차례 — 찍힌 그대로, 거꾸로, 옆으로", () => {
  assert.deepEqual([...ROTATIONS], [0, 180, 90, 270]);
});

test("UG-451 17106-3 이메일 · 연락처를 하나도 못 찾고 메일 후보도 없을 때만 돌려 읽어요", () => {
  assert.equal(needsRetry(score(0)), true);
  assert.equal(needsRetry(score(0, false, 95)), true); // 줄이 또렷해도 찾은 것이 없으면 다시
  assert.equal(needsRetry(score(1)), false);
  assert.equal(needsRetry(score(2)), false);
  assert.equal(needsRetry(score(0, true)), false); // 또렷한 메일 모양 줄 — 바로 놓인 명함이에요
});

test("UG-451 17106-3 돌려 읽기 한도 — 첫 읽기 시작 20초 뒤에는 새로 돌리지 않고, 모두 45초 안에 끝나요", () => {
  assert.equal(rotateBudget(0), ROTATE_TOTAL_MS);
  assert.equal(rotateBudget(5_000), ROTATE_TOTAL_MS - 5_000);
  assert.equal(rotateBudget(ROTATE_START_LIMIT_MS - 1), ROTATE_TOTAL_MS - ROTATE_START_LIMIT_MS + 1);
  assert.equal(rotateBudget(ROTATE_START_LIMIT_MS), 0);
  assert.equal(rotateBudget(60_000), 0);
});

test("UG-451 17106-3 방향 고르기 — 찾은 방향이 이겨요", () => {
  // 찍힌 그대로 읽힘
  assert.equal(pickReading([score(2, false, 90)]), 0);
  // 거꾸로 찍힌 명함: 0° 못 읽음 → 180° 에서 찾음
  assert.equal(pickReading([score(0, false, 35), score(2, false, 88)]), 1);
  // 옆으로 찍힌 명함: 0° · 180° 못 읽음 → 90° 에서 찾음
  assert.equal(pickReading([score(0, false, 30), score(0, false, 32), score(1, false, 85)]), 2);
  // 270° 까지 가서 찾음
  assert.equal(pickReading([score(0), score(0), score(0), score(1, false, 80)]), 3);
});

test("UG-451 17106-3 방향 고르기 — 어느 방향도 못 읽었으면 찍힌 그대로(깨진 줄 점수로 사진을 돌리지 않아요)", () => {
  assert.equal(pickReading([score(0, false, 20), score(0, false, 55), score(0, false, 40), score(0, false, 48)]), 0);
});

test("UG-451 17106-3 방향 고르기 — 찾은 수, 메일 후보, 줄 점수 차례로 견줘요", () => {
  // 찾은 수가 많은 쪽
  assert.equal(pickReading([score(0), score(1, false, 95), score(2, false, 70)]), 2);
  // 찾은 것은 없지만 또렷한 메일 후보가 있는 방향이 못 읽은 방향보다 나아요
  assert.equal(pickReading([score(0, false, 40), score(0, true, 82)]), 1);
  // 찾은 방향이 후보만 있는 방향보다 나아요
  assert.equal(pickReading([score(0), score(0, true, 90), score(1, false, 60)]), 2);
  // 같으면 줄 점수가 높은 쪽, 그래도 같으면 먼저 읽은 쪽
  assert.equal(pickReading([score(0), score(1, false, 70), score(1, false, 85)]), 2);
  assert.equal(pickReading([score(0), score(1, false, 85), score(1, false, 85)]), 1);
});
