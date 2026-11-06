// 「작성 중」 명함 자동 저장의 차례 지키기(UG-451 기획 17009 — 아이패드 Safari 는 새로고침 · 탭 닫기 때 묻지 않아요).
// 화면에 기대지 않는 작은 일정표만 둬요. 무엇을 남길지(snapshot) · 어떻게 남길지(save)는 계정 만들기 창이 줘요.
//
// - 입력이 멈추면(delayMs) 저장, 명함 읽기가 끝나면 바로 저장(saveNow)
// - 한 번에 하나만 보내요. 보내는 동안 바뀌면 끝난 뒤 그때의 최신 값으로 한 번 더
// - 마지막으로 성공한 값과 같으면 보내지 않아요(key 비교)
// - 실패하면 화면에 아무것도 띄우지 않고, 다음 변경 때 다시 해요(같은 값으로 곧바로 되풀이하지 않아요)
// - hold · suspend = 잠깐 멈춤(닫기 · 계정 만들기 · 재설정 메일 확인 창). 멈춤은 센 수라, 돌려준 release 를 모두 불러야 다시 켜져요 —
//   한쪽(보내기)이 끝나 다시 켜도 다른 쪽(닫을 때 저장)이 멈춰 둔 것은 풀리지 않아요(반박 리뷰 F3)
// - stop = 영영 끔(계정을 만듦 · 명함을 다 씀 · 명함이 서버에서 없어짐 · 창이 닫힘) — 그 뒤에는 어떤 저장도 시작하지 않아요
//   (계정을 만든 뒤 · 지운 뒤에 자동 저장이 명함을 되살리지 않게)

/** saved = 남김, failed = 남기지 못함(다음 변경 때 다시), stop = 더 남기면 안 됨(명함이 없어짐 등) */
export type AutosaveResult = "saved" | "failed" | "stop";

export type AutosaveOptions<T> = {
  /** 입력이 멈춘 뒤 기다릴 시간(ms) */
  delayMs: number;
  /** 지금 남길 것과 그 내용 열쇠(같은 내용이면 같은 글자). null = 남길 것 없음 */
  snapshot: () => { value: T; key: string } | null;
  save: (value: T) => Promise<AutosaveResult>;
  /** 시험용 — 기본은 setTimeout · clearTimeout */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

export type Autosaver = {
  /** 입력이 바뀜 — delayMs 동안 더 바뀌지 않으면 저장해요 */
  schedule(): void;
  /** 바로 저장(명함 읽기가 끝남) — 보내는 중이면 끝난 뒤에 */
  saveNow(): void;
  /**
   * 잠깐 멈춤(바로) — 예약을 지우고 새로 보내지 않아요. 돌려준 release 로 풀어요(여러 번 불러도 한 번만 풀려요).
   * 멈춤을 모두 풀면, 멈춘 사이 바뀐 것(멈추며 지운 예약 · 끝난 뒤 하려던 한 번 더 포함)이 있을 때만 delayMs 뒤에 저장해요 —
   * 바뀐 것 없이 풀기만 하면 보내지 않아요(실패한 값을 곧바로 되풀이하지 않게). 끈(stop) 뒤에는 아무것도 하지 않아요.
   */
  hold(): () => void;
  /** hold 하고, 보내는 중인 저장이 끝날 때까지 기다려요 */
  suspend(): Promise<() => void>;
  /** 영영 끔 — 보내는 중인 저장이 끝날 때까지 기다려요 */
  stop(): Promise<void>;
  /** 이 내용은 이미 서버에 있어요(이어서 만든 명함을 열었을 때) */
  markSaved(key: string): void;
  /** 보내는 중인지 */
  readonly saving: boolean;
  /** 끈 뒤인지 */
  readonly stopped: boolean;
};

export function createAutosaver<T>(opts: AutosaveOptions<T>): Autosaver {
  const setTimer = opts.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let timer: unknown = null;
  let inFlight: Promise<void> | null = null;
  // 보내는 동안 다시 저장을 부탁받았는지 — 끝난 뒤 최신 값으로 한 번 더
  let again = false;
  // 멈춤 수 — 0 일 때만 보내요
  let holds = 0;
  // 멈춘 동안 저장을 부탁받았는지 — 다시 켜면 그때 저장해요
  let dirty = false;
  let stopped = false;
  let lastKey: string | null = null;

  const cancelTimer = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };

  function run() {
    timer = null;
    if (stopped) return;
    if (holds > 0) {
      dirty = true;
      return;
    }
    if (inFlight) {
      again = true;
      return;
    }
    const snap = opts.snapshot();
    if (!snap || snap.key === lastKey) return;
    const { value, key } = snap;
    inFlight = (async () => {
      let result: AutosaveResult;
      try {
        result = await opts.save(value);
      } catch {
        result = "failed";
      }
      if (result === "saved") lastKey = key;
      else if (result === "stop") stopped = true;
    })().finally(() => {
      inFlight = null;
      if (again) {
        again = false;
        run();
      }
    });
  }

  /** 보내는 중인 저장(끝난 뒤 이어진 한 번 더 포함)이 모두 끝날 때까지 */
  async function idle() {
    while (inFlight) await inFlight;
  }

  function hold(): () => void {
    holds++;
    if (timer !== null) dirty = true; // 기다리던 변경 — 다시 켜면 저장해요
    if (again) dirty = true; // 보내는 중에 들어온 변경도
    cancelTimer();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      holds--;
      if (holds > 0 || stopped || !dirty) return;
      dirty = false;
      cancelTimer();
      timer = setTimer(run, opts.delayMs);
    };
  }

  return {
    schedule() {
      if (stopped) return;
      if (holds > 0) {
        dirty = true;
        return;
      }
      cancelTimer();
      timer = setTimer(run, opts.delayMs);
    },
    saveNow() {
      if (stopped) return;
      cancelTimer();
      run();
    },
    hold,
    async suspend() {
      const release = hold();
      await idle();
      return release;
    },
    async stop() {
      stopped = true;
      cancelTimer();
      await idle();
    },
    markSaved(key: string) {
      lastKey = key;
    },
    get saving() {
      return inFlight !== null;
    },
    get stopped() {
      return stopped;
    },
  };
}

const DATA_URL_PREFIX = /^data:[^,]*;base64,/;

/** 사진 내용 표 — data URL · 순수 base64 어느 쪽이든 같은 사진이면 같은 글자(긴 사진을 통째로 견주지 않게 길이 + 끝 64자) */
export function photoTag(photo: string | null | undefined): string | null {
  if (!photo) return null;
  const b64 = photo.replace(DATA_URL_PREFIX, "");
  return `${b64.length}:${b64.slice(-64)}`;
}

/**
 * 자동 저장의 내용 열쇠 — 서버에 있어야 할 내용(네 칸 · 메일 언어 · 칩 · 사진)이 같으면 같은 글자.
 * 사진은 보내는 모양(새로 보냄 photo · 그대로 keepPhoto)과 상관없이 「어떤 사진이 남아야 하는지」로 봐요 —
 * 한 번 올린 사진을 다음 저장에서 keepPhoto 로 바꿔 보내도 내용은 같아요.
 * serverPhoto = 지금 서버 명함에 있는 사진(keepPhoto 일 때 남는 사진)
 */
export function draftContentKey(
  input: { photo?: string; keepPhoto?: boolean } & Record<string, unknown>,
  serverPhoto: string | null,
): string {
  const { photo, keepPhoto, ...rest } = input;
  const fields = Object.keys(rest)
    .sort()
    .map((k) => [k, rest[k]]);
  return JSON.stringify([fields, photoTag(photo ?? (keepPhoto ? serverPhoto : null))]);
}
