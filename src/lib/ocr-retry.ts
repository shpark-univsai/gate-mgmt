// 글자 읽기 도구 받기의 「한 번 더 받기」 규칙(UG-451 기획 17005 · 17022). 브라우저 · tesseract 에 기대지 않아 따로 시험해요(card-ocr.ts 가 써요).
//
// - 도구 받기가 오류로 끝나면 잠깐 쉬고 한 번만 다시 받아요 — 찍을 때마다(「명함 찍기」 · 「다시 찍기」가 시작한 받기마다) 한 번(기획 17022).
// - 실패한 일꾼은 tesseract 가 돌려주지 않아 닫을 수 없어요(언어 데이터를 받지 못하면 약속이 끝나지 않아요) — 다시 받을 때마다
//   닫지 못한 일꾼이 하나씩 쌓여요. 그래서 페이지를 연 동안 다시 받기는 모두 합쳐 max 번까지만(createRetryBudget).
//   다 쓰면 「페이지를 새로 고친 뒤 다시 찍어 주세요」로 안내해요(spent).
// - 시간 초과 · 창 닫기 뒤(live 가 아님)나 처음 받기 시작부터 센 한도(maxMs)가 모자라면 다시 받지 않아요.

/** 페이지를 연 동안 쓸 수 있는 다시 받기 수 */
export type RetryBudget = {
  /** 하나 써요 — 남았으면 true */
  take(): boolean;
  /** 다 썼는지 */
  readonly spent: boolean;
};

export function createRetryBudget(max: number): RetryBudget {
  let used = 0;
  return {
    take() {
      if (used >= max) return false;
      used++;
      return true;
    },
    get spent() {
      return used >= max;
    },
  };
}

export type LoadWithRetryOptions<T> = {
  /** 도구 받기 한 번 */
  start: () => Promise<T>;
  budget: RetryBudget;
  /** 이 받기가 아직 기다리는 받기인지(시간 초과 · 창 닫기 뒤에는 false) */
  live: () => boolean;
  /** 처음 받기 시작한 시각 — 다시 받기도 이 시각부터 세요(한 번 더 받는다고 기다림이 늘지 않게) */
  started: number;
  /** 받기 하나의 모두 합친 한도(ms) */
  maxMs: number;
  /** 다시 받기 전에 쉬는 시간(ms) */
  delayMs: number;
  /** 첫 받기가 오류로 끝난 바로 뒤 · 다시 받기 직전(소식 시각을 새로 둬 쉬는 동안 시간 초과로 끊기지 않게) */
  onActivity?: () => void;
  /** 시험용 — 기본은 Date.now · setTimeout */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

/**
 * 도구 받기 — 오류로 끝나면 delayMs 뒤 한 번만 다시(찍을 때마다 한 번). 이 받기가 아직 지금 받기이고(live),
 * 페이지의 다시 받기 수(budget)가 남았고, 남은 시간이 있을 때만. 다시 받기도 실패하면 그 오류로 끝나요.
 */
export async function loadWithRetry<T>(opts: LoadWithRetryOptions<T>): Promise<T> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  try {
    return await opts.start();
  } catch (first) {
    opts.onActivity?.();
    // 다 썼으면 쉬지 않고 바로 실패로 — 몫은 쉰 뒤 실제로 다시 받을 때만 써요(쉬는 사이 창을 닫으면 쓰지 않아요, 반박 리뷰 F5)
    if (!opts.live() || opts.budget.spent || now() + opts.delayMs - opts.started >= opts.maxMs) throw first;
    await sleep(opts.delayMs);
    if (!opts.live() || !opts.budget.take()) throw first;
    opts.onActivity?.();
    return opts.start();
  }
}
