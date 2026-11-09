// 명함 크게 보기의 확대 · 이동 계산(UG-455). 화면에 기대지 않는 순수 함수만 둬요 — 손가락 · 마우스 처리는 card-photo-viewer.tsx.
//
// 좌표: 사진은 보기 영역(stage) 가운데에 「맞춤」 크기(base)로 놓이고, 그 위에 translate(x, y) scale(scale)을 걸어요(기준점 = 사진 가운데).
// 초점(focal)은 보기 영역 가운데를 (0, 0)으로 한 화면 좌표예요.

export type Size = { w: number; h: number };
export type Point = { x: number; y: number };
export type View = { scale: number; x: number; y: number };

export const MIN_SCALE = 1;
export const MAX_SCALE = 4;
/** 두 번 누르기 · 두 번 클릭으로 커지는 배율 */
export const DOUBLE_TAP_SCALE = 2.5;
/** [+] · [−] · 키보드 한 번의 배율 */
export const STEP_FACTOR = 1.5;
export const FIT: View = { scale: 1, x: 0, y: 0 };

/** 이보다 1 에 가까우면 맞춤으로 봐요(소수 오차로 [맞춤]이 켜진 채 남지 않게) */
const FIT_EPSILON = 0.001;
/** 휠 한 번에 너무 크게 뛰지 않게 — 한 번에 받는 세로 이동 상한(px) */
const WHEEL_DELTA_MAX = 300;
/** 휠 감도: 트랙패드 오므리기(ctrlKey)는 작은 값이 자주 와서 더 민감하게 */
const WHEEL_PINCH_RATE = 0.01;
const WHEEL_SCROLL_RATE = 0.0015;
/** deltaMode 1(줄) · 2(쪽)를 px 로 */
const LINE_PX = 16;
const PAGE_PX = 800;

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return MIN_SCALE;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function isFit(view: View): boolean {
  return view.scale <= MIN_SCALE + FIT_EPSILON;
}

/** 사진 가장자리가 보기 영역 안으로 들어오지 않게 이동을 막아요. 사진이 영역보다 작은 쪽은 가운데 */
export function clampPan(view: View, base: Size, stage: Size): View {
  const scale = clampScale(view.scale);
  if (scale <= MIN_SCALE + FIT_EPSILON) return FIT;
  const maxX = Math.max(0, (base.w * scale - stage.w) / 2);
  const maxY = Math.max(0, (base.h * scale - stage.h) / 2);
  return { scale, x: clampAbs(view.x, maxX), y: clampAbs(view.y, maxY) };
}

function clampAbs(v: number, max: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(max, Math.max(-max, v)) || 0; // -0 → 0
}

/** focal 아래의 사진 점이 그 자리에 머물도록 배율을 바꿔요 */
export function zoomAt(view: View, scale: number, focal: Point, base: Size, stage: Size): View {
  const next = clampScale(scale);
  const k = next / view.scale;
  return clampPan({ scale: next, x: focal.x - (focal.x - view.x) * k, y: focal.y - (focal.y - view.y) * k }, base, stage);
}

/** 한 손가락 · 마우스 끌기 — 시작 때의 보기(start)에서 (dx, dy)만큼 */
export function panBy(start: View, dx: number, dy: number, base: Size, stage: Size): View {
  return clampPan({ scale: start.scale, x: start.x + dx, y: start.y + dy }, base, stage);
}

/**
 * 두 손가락 — 시작 때의 보기 · 두 점의 가운데 · 거리에서 지금 가운데 · 거리로.
 * 배율은 거리 비율, 시작 가운데 아래의 사진 점이 지금 가운데를 따라와요(벌리며 옮기기 포함).
 */
export function pinch(start: View, startMid: Point, startDist: number, mid: Point, dist: number, base: Size, stage: Size): View {
  if (!(startDist > 0) || !(dist > 0)) return clampPan(start, base, stage);
  const next = clampScale((start.scale * dist) / startDist);
  const k = next / start.scale;
  return clampPan({ scale: next, x: mid.x - (startMid.x - start.x) * k, y: mid.y - (startMid.y - start.y) * k }, base, stage);
}

/** 휠 · 트랙패드 오므리기(ctrlKey) — 아래로 굴리면 작게, 위로 굴리면 크게 */
export function wheelZoom(view: View, deltaY: number, deltaMode: number, ctrlKey: boolean, focal: Point, base: Size, stage: Size): View {
  const px = deltaY * (deltaMode === 1 ? LINE_PX : deltaMode === 2 ? PAGE_PX : 1);
  if (!Number.isFinite(px) || px === 0) return view;
  const d = Math.min(WHEEL_DELTA_MAX, Math.max(-WHEEL_DELTA_MAX, px));
  return zoomAt(view, view.scale * Math.exp(-d * (ctrlKey ? WHEEL_PINCH_RATE : WHEEL_SCROLL_RATE)), focal, base, stage);
}

/** 두 번 누르기 — 맞춤이면 그 자리를 2.5배로, 커져 있으면 맞춤으로 */
export function toggleZoom(view: View, focal: Point, base: Size, stage: Size): View {
  return isFit(view) ? zoomAt(FIT, DOUBLE_TAP_SCALE, focal, base, stage) : FIT;
}

/** [+] · [−] · 키보드 — 보기 영역 가운데를 기준으로 한 단계 */
export function stepZoom(view: View, dir: 1 | -1, base: Size, stage: Size): View {
  return zoomAt(view, dir > 0 ? view.scale * STEP_FACTOR : view.scale / STEP_FACTOR, { x: 0, y: 0 }, base, stage);
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
