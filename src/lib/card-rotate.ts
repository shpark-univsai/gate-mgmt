// 명함 방향 맞추기(UG-451 기획 17106-3) — 찍힌 방향으로 읽어 이메일 · 연락처를 하나도 못 찾았을 때만 180° → 90° → 270° 로 돌려 다시 읽어요.
// 전시장에서는 명함을 세로로 받아 찍는 일이 많아요. 매번 네 방향을 다 읽으면 네 배가 걸려서, 못 읽었을 때만 돌려요.
// 방향 감지 도구(OSD)는 쓰지 않아요 — 데이터 파일(약 10MB)을 더 받아야 해요.
// 화면 · 브라우저에 기대지 않는 순수 함수만 둬요(돌려 읽기 자체는 card-ocr.ts).

/** 읽어 보는 방향(시계 방향으로 돌리는 각도) — 찍힌 그대로 먼저, 다음은 거꾸로(가장 흔함), 그다음 옆으로 */
export const ROTATIONS = [0, 180, 90, 270] as const;
export type Rotation = (typeof ROTATIONS)[number];

/**
 * 한 방향으로 읽은 결과의 점수(card-scan.ts scanCard 가 줘요).
 * found = 채운 이메일 · 연락처 수, candidate = 채우진 못했지만 또렷이 읽은 메일 모양 줄이 있음(「확인하지 못했습니다」), confidence = 줄 점수 평균
 */
export type ReadingScore = { found: number; candidate: boolean; confidence: number };

/** 다른 방향으로 다시 읽어야 하는지 — 이메일 · 연락처를 하나도 못 찾았고 쓸 만한 메일 후보도 없을 때(화면이 「명함을 읽지 못했습니다」를 띄울 결과) */
export const needsRetry = (score: ReadingScore): boolean => score.found === 0 && !score.candidate;

/**
 * 돌려 읽기를 새로 시작해도 되는 한도 — 첫 읽기를 시작한 뒤 이만큼 지났으면 더 돌리지 않아요(아이패드에서 한 번 읽는 데 몇 초).
 * 돌려 읽는 한 번은 첫 읽기 시작부터 ROTATE_TOTAL_MS 안에 끝나야 해요(넘으면 끊고 그때까지 가장 나은 결과를 써요).
 */
export const ROTATE_START_LIMIT_MS = 20_000;
export const ROTATE_TOTAL_MS = 45_000;

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
    if (needsRetry(a)) continue;
    if (needsRetry(b) || a.found > b.found || (a.found === b.found && (Number(a.candidate) > Number(b.candidate) || (a.candidate === b.candidate && a.confidence > b.confidence)))) {
      best = i;
    }
  }
  return best;
}
