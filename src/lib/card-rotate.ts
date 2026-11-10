// 명함 방향 맞추기(UG-451 기획 17106-3) — 찍힌 방향으로 읽어 이메일 · 연락처를 하나도 못 찾았을 때만 180° → 90° → 270° 로 돌려 다시 읽어요.
// 전시장에서는 명함을 세로로 받아 찍는 일이 많아요. 매번 네 방향을 다 읽으면 네 배가 걸려서, 못 읽었을 때만 돌려요.
// 방향 감지 도구(OSD)는 쓰지 않아요 — 데이터 파일(약 10MB)을 더 받아야 해요.
// 화면 · 브라우저에 기대지 않는 순수 함수만 둬요(돌려 읽기 자체는 card-ocr.ts).

/** 읽어 보는 방향(시계 방향으로 돌리는 각도) — 찍힌 그대로 먼저, 다음은 거꾸로(가장 흔함), 그다음 옆으로 */
export const ROTATIONS = [0, 180, 90, 270] as const;
export type Rotation = (typeof ROTATIONS)[number];

/**
 * 한 방향으로 읽은 결과의 점수(card-scan.ts scanCard 가 줘요).
 * found = 채운 이메일 · 연락처 수, candidate = 채우진 못했지만 바로 놓인 명함으로 보임(또렷이 읽은 메일 모양 글자 · 또렷한 글자 줄 여럿),
 * confidence = 줄 점수 평균, sparse = 글자가 거의 읽히지 않은 사진(뒷면 · 빈 사진)
 */
export type ReadingScore = { found: number; candidate: boolean; confidence: number; sparse?: boolean };

/** 그 방향으로 읽힌 것으로 보는지 — 이메일 · 연락처를 찾았거나 바로 놓인 명함으로 보임. 돌려 읽다가 이런 방향이 나오면 멈춰요 */
export const isReadable = (score: ReadingScore): boolean => score.found > 0 || score.candidate;

/**
 * 찍힌 그대로(0°) 읽은 결과를 보고, 다른 방향으로 돌려 읽기 시작할지 — 읽히지 않았을 때(isReadable 아님).
 * 글자가 거의 없는 사진(sparse)은 돌려도 나올 것이 없어 건너뛰어요 — 거꾸로 · 옆으로 찍힌 명함은 깨진 글자가 많이 읽혀요(UG-451 반박 리뷰 4).
 */
export const needsRetry = (first: ReadingScore): boolean => !isReadable(first) && !first.sparse;

/**
 * 돌려 읽기를 새로 시작해도 되는 한도 — 첫 읽기를 시작한 뒤 이만큼 지났으면 더 돌리지 않아요.
 * 돌려 읽는 한 번은 첫 읽기 시작부터 ROTATE_TOTAL_MS 안에 끝나야 해요(넘으면 끊고 그때까지 가장 나은 결과를 써요).
 * 근거(UG-451 반박 리뷰 4, Mac 에서 지어낸 명함 그림): 못 읽는 방향 한 번은 대개 1초 안팎이라(네 방향 중앙값 3.9초) 아이패드가 두세 배 느려도
 * 10초 안에 세 방향을 모두 시작해요. 잡음이 많아 한 번에 6~10초 걸리는 사진(네 방향 24~41초)은 가장 흔한 거꾸로(180°) 한 번만 더 읽고 25초에 끊어요.
 * 그동안 직원은 「명함 다시 찍기」로 버리고 새로 찍을 수 있어요.
 */
export const ROTATE_START_LIMIT_MS = 10_000;
export const ROTATE_TOTAL_MS = 25_000;

/** 돌려 읽기 한 번에 줄 시간(ms) — 한도가 지났으면 0(더 돌리지 않아요). elapsed = 첫 읽기를 시작한 뒤 지난 시간 */
export function rotateBudget(elapsed: number): number {
  return elapsed < ROTATE_START_LIMIT_MS ? ROTATE_TOTAL_MS - elapsed : 0;
}

/**
 * 읽은 방향들 가운데 쓸 결과의 차례(scores 의 index).
 * - 이메일 · 연락처를 더 많이 찾은 방향, 같으면 메일 후보가 있는 방향, 그래도 같으면 줄 점수가 높은 방향, 그래도 같으면 먼저 읽은 방향
 * - 어느 방향도 찾은 것 · 후보가 없으면 찍힌 그대로(0) — 깨진 줄의 점수로 사진을 돌리지 않아요
 */
export function pickReading(scores: readonly ReadingScore[]): number {
  let best = 0;
  for (let i = 1; i < scores.length; i++) {
    const a = scores[i];
    const b = scores[best];
    if (!isReadable(a)) continue;
    if (!isReadable(b) || a.found > b.found || (a.found === b.found && (Number(a.candidate) > Number(b.candidate) || (a.candidate === b.candidate && a.confidence > b.confidence)))) {
      best = i;
    }
  }
  return best;
}
