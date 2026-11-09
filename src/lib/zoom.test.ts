// 명함 크게 보기 확대 · 이동 계산(zoom.ts) 시험 — 손가락 · 마우스 처리는 기기에서 확인.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DOUBLE_TAP_SCALE,
  FIT,
  MAX_SCALE,
  clampPan,
  clampScale,
  distance,
  isFit,
  midpoint,
  panBy,
  pinch,
  stepZoom,
  toggleZoom,
  wheelZoom,
  zoomAt,
  type View,
} from "./zoom.ts";

// 가로 명함(400×240)이 보기 영역(400×600) 폭에 맞춰 놓인 경우
const base = { w: 400, h: 240 };
const stage = { w: 400, h: 600 };
const center = { x: 0, y: 0 };

/** focal 아래 사진 점(사진 가운데 기준, 맞춤 크기 px) */
const pointUnder = (v: View, f: { x: number; y: number }) => ({ x: (f.x - v.x) / v.scale, y: (f.y - v.y) / v.scale });

test("UG-455 배율은 1~4 사이로 막아요", () => {
  assert.equal(clampScale(0.3), 1);
  assert.equal(clampScale(9), MAX_SCALE);
  assert.equal(clampScale(2.2), 2.2);
  assert.equal(clampScale(Number.NaN), 1);
});

test("UG-455 맞춤 배율이면 이동 없이 가운데", () => {
  assert.deepEqual(clampPan({ scale: 1, x: 50, y: -30 }, base, stage), FIT);
  assert.deepEqual(clampPan({ scale: 1.0004, x: 50, y: 0 }, base, stage), FIT);
});

test("UG-455 이동은 사진 가장자리까지만 — 영역보다 작은 쪽은 가운데", () => {
  // 2배: 사진 800×480 → 가로는 (800-400)/2 = 200 까지, 세로는 480 < 600 이라 0
  assert.deepEqual(clampPan({ scale: 2, x: 999, y: 999 }, base, stage), { scale: 2, x: 200, y: 0 });
  assert.deepEqual(clampPan({ scale: 2, x: -999, y: -999 }, base, stage), { scale: 2, x: -200, y: 0 });
  // 4배: 1600×960 → 가로 600 · 세로 (960-600)/2 = 180
  assert.deepEqual(clampPan({ scale: 4, x: 700, y: -500 }, base, stage), { scale: 4, x: 600, y: -180 });
});

test("UG-455 zoomAt 은 초점 아래 사진 점을 그 자리에 둬요(막히지 않는 범위)", () => {
  const f = { x: 100, y: 0 }; // 2배면 세로 480 < 600 이라 세로는 가운데로 막혀요 — 가로만 봐요
  const v = zoomAt(FIT, 2, f, base, stage);
  assert.equal(v.scale, 2);
  const before = pointUnder(FIT, f);
  const after = pointUnder(v, f);
  assert.ok(Math.abs(before.x - after.x) < 1e-9 && Math.abs(before.y - after.y) < 1e-9);
});

test("UG-455 zoomAt 결과도 가장자리를 넘지 않아요", () => {
  const v = zoomAt({ scale: 2, x: 200, y: 0 }, 1.2, { x: -190, y: 0 }, base, stage);
  assert.ok(Math.abs(v.x) <= (base.w * v.scale - stage.w) / 2 + 1e-9);
  // 1 로 줄이면 맞춤
  assert.deepEqual(zoomAt({ scale: 3, x: 300, y: 100 }, 1, { x: 80, y: 80 }, base, stage), FIT);
});

test("UG-455 끌기는 커진 상태에서 시작점 기준으로 · 가장자리에서 멈춰요", () => {
  const start = { scale: 2, x: 0, y: 0 };
  assert.deepEqual(panBy(start, 50, 40, base, stage), { scale: 2, x: 50, y: 0 });
  assert.deepEqual(panBy(start, 500, 0, base, stage), { scale: 2, x: 200, y: 0 });
  // 맞춤이면 움직이지 않아요
  assert.deepEqual(panBy(FIT, 80, 80, base, stage), FIT);
});

test("UG-455 두 손가락: 거리 비율로 배율, 가운데 아래 점이 따라와요", () => {
  const a0 = { x: -50, y: 0 };
  const b0 = { x: 50, y: 0 };
  const a1 = { x: -100, y: 0 };
  const b1 = { x: 100, y: 0 };
  const v = pinch(FIT, midpoint(a0, b0), distance(a0, b0), midpoint(a1, b1), distance(a1, b1), base, stage);
  assert.equal(v.scale, 2);
  assert.deepEqual(pointUnder(v, midpoint(a1, b1)), pointUnder(FIT, midpoint(a0, b0)));
  // 벌리면서 옮기기 — 가운데가 30 옮겨지면 사진도 따라와요(가장자리 안)
  const moved = pinch(FIT, { x: 0, y: 0 }, 100, { x: 30, y: 0 }, 200, base, stage);
  assert.equal(moved.x, 30);
  // 너무 벌려도 4배, 오므려도 1배
  assert.equal(pinch(FIT, center, 10, center, 1000, base, stage).scale, MAX_SCALE);
  assert.deepEqual(pinch({ scale: 2, x: 100, y: 0 }, center, 200, center, 20, base, stage), FIT);
  // 거리 0(손가락이 겹침)이면 그대로
  assert.deepEqual(pinch({ scale: 2, x: 0, y: 0 }, center, 0, center, 100, base, stage), { scale: 2, x: 0, y: 0 });
});

test("UG-455 휠: 위로 굴리면 커지고 아래로 굴리면 작아져요 · 오므리기(ctrlKey)는 더 민감", () => {
  const up = wheelZoom(FIT, -100, 0, false, center, base, stage);
  assert.ok(up.scale > 1);
  const pinchUp = wheelZoom(FIT, -10, 0, true, center, base, stage);
  assert.ok(pinchUp.scale > 1);
  const plainSmall = wheelZoom(FIT, -10, 0, false, center, base, stage);
  assert.ok(pinchUp.scale > plainSmall.scale);
  assert.deepEqual(wheelZoom(FIT, 100, 0, false, center, base, stage), FIT);
  const down = wheelZoom({ scale: 3, x: 0, y: 0 }, 100, 0, false, center, base, stage);
  assert.ok(down.scale < 3);
  // 줄 단위(Firefox) 한 칸 = 16px
  assert.equal(wheelZoom(FIT, -3, 1, false, center, base, stage).scale, wheelZoom(FIT, -48, 0, false, center, base, stage).scale);
  // 0 · NaN 은 그대로
  const v = { scale: 2, x: 10, y: 0 };
  assert.equal(wheelZoom(v, 0, 0, false, center, base, stage), v);
  assert.equal(wheelZoom(v, Number.NaN, 0, false, center, base, stage), v);
  // 한 번에 크게 와도 상한까지만 — 4배를 넘지 않아요
  assert.ok(wheelZoom(FIT, -100000, 0, true, center, base, stage).scale <= MAX_SCALE);
});

test("UG-455 두 번 누르기: 맞춤 ↔ 2.5배", () => {
  const f = { x: 60, y: 0 }; // 2.5배면 세로 600 = 영역 높이라 세로 이동은 0 으로 막혀요
  const zoomed = toggleZoom(FIT, f, base, stage);
  assert.equal(zoomed.scale, DOUBLE_TAP_SCALE);
  assert.deepEqual(pointUnder(zoomed, f), pointUnder(FIT, f));
  assert.deepEqual(toggleZoom(zoomed, f, base, stage), FIT);
});

test("UG-455 [+] · [−] 는 가운데 기준 한 단계, 끝에서 멈춰요", () => {
  const plus = stepZoom(FIT, 1, base, stage);
  assert.equal(plus.scale, 1.5);
  assert.equal(plus.x, 0);
  let v = FIT;
  for (let i = 0; i < 10; i++) v = stepZoom(v, 1, base, stage);
  assert.equal(v.scale, MAX_SCALE);
  for (let i = 0; i < 10; i++) v = stepZoom(v, -1, base, stage);
  assert.deepEqual(v, FIT);
  assert.ok(isFit(v));
});
