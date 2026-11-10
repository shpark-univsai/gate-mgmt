// 명함 방향 맞추기(card-rotate.ts) 시험 — `npm test`.
import assert from "node:assert/strict";
import { test } from "node:test";

import { ROTATE_START_LIMIT_MS, ROTATE_TOTAL_MS, ROTATIONS, isReadable, isSettled, needsRetry, pickReading, rotateBudget, type ReadingScore } from "./card-rotate.ts";

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

test("UG-451 반박 리뷰 4 글자가 거의 없는 사진(뒷면 · 빈 사진)은 돌려 읽지 않아요", () => {
  assert.equal(needsRetry({ ...score(0), sparse: true }), false);
  assert.equal(needsRetry({ ...score(0), sparse: false }), true);
});

test("UG-451 반박 리뷰 4 돌려 읽다가 멈추는 것은 읽힌 방향이 나왔을 때만 — 글자가 거의 없는 방향을 고르지 않아요", () => {
  assert.equal(isReadable(score(1)), true);
  assert.equal(isReadable(score(0, true)), true);
  assert.equal(isReadable({ ...score(0), sparse: true }), false);
  // 0° 는 깨진 글자, 180° 는 글자가 거의 없음 → 어느 쪽도 읽히지 않았으니 찍힌 그대로
  assert.equal(pickReading([score(0, false, 40), { ...score(0, false, 70), sparse: true }]).index, 0);
});

test("UG-451 17106-3 돌려 읽기 한도 — 첫 읽기 시작 10초 뒤에는 새로 돌리지 않고, 모두 25초 안에 끝나요", () => {
  assert.equal(ROTATE_START_LIMIT_MS, 10_000);
  assert.equal(ROTATE_TOTAL_MS, 25_000);
  assert.equal(rotateBudget(0), ROTATE_TOTAL_MS);
  assert.equal(rotateBudget(5_000), ROTATE_TOTAL_MS - 5_000);
  assert.equal(rotateBudget(ROTATE_START_LIMIT_MS - 1), ROTATE_TOTAL_MS - ROTATE_START_LIMIT_MS + 1);
  assert.equal(rotateBudget(ROTATE_START_LIMIT_MS), 0);
  assert.equal(rotateBudget(60_000), 0);
});

test("UG-451 17106-3 방향 고르기 — 찾은 방향이 이겨요", () => {
  // 찍힌 그대로 읽힘
  assert.equal(pickReading([score(2, false, 90)]).index, 0);
  // 거꾸로 찍힌 명함: 0° 못 읽음 → 180° 에서 찾음
  assert.equal(pickReading([score(0, false, 35), score(2, false, 88)]).index, 1);
  // 옆으로 찍힌 명함: 0° · 180° 못 읽음 → 90° 에서 찾음
  assert.equal(pickReading([score(0, false, 30), score(0, false, 32), score(1, false, 85)]).index, 2);
  // 270° 까지 가서 찾음
  assert.equal(pickReading([score(0), score(0), score(0), score(1, false, 80)]).index, 3);
});

test("UG-451 17106-3 방향 고르기 — 어느 방향도 못 읽었으면 찍힌 그대로(깨진 줄 점수로 사진을 돌리지 않아요)", () => {
  assert.equal(pickReading([score(0, false, 20), score(0, false, 55), score(0, false, 40), score(0, false, 48)]).index, 0);
});

test("UG-451 17106-3 방향 고르기 — 찾은 수, 메일 후보, 줄 점수 차례로 견줘요", () => {
  // 찾은 수가 많은 쪽
  assert.equal(pickReading([score(0), score(1, false, 95), score(2, false, 70)]).index, 2);
  // 찾은 것은 없지만 또렷한 메일 후보가 있는 방향이 못 읽은 방향보다 나아요
  assert.equal(pickReading([score(0, false, 40), score(0, true, 82)]).index, 1);
  // 찾은 방향이 후보만 있는 방향보다 나아요
  assert.equal(pickReading([score(0), score(0, true, 90), score(1, false, 60)]).index, 2);
  // 같으면 줄 점수가 높은 쪽, 그래도 같으면 먼저 읽은 쪽
  assert.equal(pickReading([score(0), score(1, false, 70), score(1, false, 85)]).index, 2);
  assert.equal(pickReading([score(0), score(1, false, 85), score(1, false, 85)]).index, 1);
});

/** 바로 놓인 명함인지 모르는데 이메일 없이 연락처만 찾은 읽기 */
const weak = (confidence = 50): ReadingScore => ({ found: 1, candidate: false, confidence, weak: true });

test("UG-451 반박 리뷰 후속 1 — 연락처만 찾은 방향에서는 멈추지 않고 남은 방향을 읽어요", () => {
  // 거꾸로 놓인 「+82 10 5555 0102」가 0° 에서 「8010 9999」로 읽힘 → 읽히긴 했지만 방향이 맞다고 볼 수 없어요
  assert.equal(isReadable(weak()), true);
  assert.equal(isSettled(weak()), false);
  assert.equal(needsRetry(weak()), true);
  // 이메일까지 찾았거나 바로 놓인 명함으로 보이면 방향이 맞아요
  assert.equal(isSettled(score(2)), true);
  assert.equal(isSettled(score(1)), true);
  assert.equal(isSettled(score(0, true)), true);
  assert.equal(isSettled(score(0)), false);
});

test("UG-451 반박 리뷰 후속 1 — 방향 고르기: 연락처만 찾은 방향보다 방향이 맞는 읽기를 써요", () => {
  // 거꾸로 찍힌 명함: 0° 「8010 9999」(연락처만) → 180° 에서 이메일 · 연락처
  assert.deepEqual(pickReading([weak(60), score(2, false, 90)], false), { index: 1, lonePhone: false });
  // 옆으로 찍힌 명함: 0° · 180° 못 읽음 → 90°(= 거꾸로) 「8010 9999」 → 270° 에서 읽힘. 전에는 90° 에서 멈춰 사진도 거꾸로 세웠어요
  assert.deepEqual(pickReading([score(0, false, 30), score(0, false, 35), weak(62), score(2, false, 91)]), { index: 3, lonePhone: false });
  // 다른 재현 번호도 같아요(「+82 10 9608 1689」 → 「6891 8096」 · 「T. 6689 0916」 → 「9160 6899」 · 「M 010-8696-0190」 → 「0610-9698-010」)
  assert.deepEqual(pickReading([weak(70), score(1, false, 88)], false), { index: 1, lonePhone: false });
  // 바로 놓인 명함으로 보이는 방향(찾은 것은 없어도)이 연락처만 찾은 방향보다 나아요
  assert.deepEqual(pickReading([weak(70), score(0, true, 85)], false), { index: 1, lonePhone: false });
});

test("UG-451 반박 리뷰 후속 1 — 더 나은 방향이 없을 때: 네 방향을 다 읽고 연락처만 찾은 방향이 하나뿐이면 그 번호를 쓰고, 아니면 비워요", () => {
  // 조금 기울어 연락처만 또렷한 명함 — 다른 세 방향은 읽히지 않음
  assert.deepEqual(pickReading([weak(), score(0), score(0), score(0)]), { index: 0, lonePhone: true });
  assert.deepEqual(pickReading([score(0), score(0), weak(), score(0)]), { index: 2, lonePhone: true });
  // 두 방향에서 연락처만 찾음(거꾸로 읽혀도 번호 모양이 되는 번호) — 어느 쪽이 맞는지 몰라 찍힌 그대로 두고 번호를 믿지 않아요
  assert.deepEqual(pickReading([weak(80), score(0), weak(85), score(0)]), { index: 0, lonePhone: false });
  assert.deepEqual(pickReading([score(0), weak(80), score(0), weak(85)]), { index: 0, lonePhone: false });
  // 한도 때문에 네 방향을 다 읽지 못함 — 읽지 않은 방향이 맞는 방향일 수 있어요
  assert.deepEqual(pickReading([weak(80), score(0)], false), { index: 0, lonePhone: false });
  assert.deepEqual(pickReading([weak(80)], false), { index: 0, lonePhone: false });
  // 아무 방향도 읽히지 않음
  assert.deepEqual(pickReading([score(0), score(0), score(0), score(0)]), { index: 0, lonePhone: false });
});
