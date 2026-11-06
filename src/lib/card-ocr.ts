// 명함 사진 → 글자 (UG-431). 글자는 이 기기(브라우저) 안에서 읽어요(원본을 서버로 보내지 않음) — 읽고 나면 원본 · 그림판은 바로 버려요.
// 비교용으로 줄인 사진(data URL)만 돌려줘요 — 발급 창에 두고 계정을 만들면 바로 지워요(기기에는 저장하지 않음).
// 만들지 않고 창을 닫으면 이 줄인 사진만 「작성 중」 명함으로 서버에 남겨요(기획 16864).
// 글자 읽기 도구는 tesseract.js(한국어 + 영어). 도구 파일은 같은 출처 /ocr/ 에서 받아요(외부 CDN 없음) —
// scripts/copy-ocr-assets.mjs 가 dev · build 전에 node_modules 에서 public/ocr/ 로 복사해요.
// 처음 한 번은 언어 데이터(약 4.5MB)를 내려받고 브라우저 저장소(IndexedDB)에 둬요 — 다음부터는 바로 읽어요.
// 일꾼은 「계정 만들기」 창이 열려 있는 동안만 살려 두고, 창을 닫으면 닫아요(createCardReader).
// 배포 화면의 CSP 는 일꾼 안에서 wasm 을 돌릴 수 있게 script-src 에 'wasm-unsafe-eval' 이 있어야 해요(nginx 설정, 플랫폼 쪽).

import { createRetryBudget, loadWithRetry } from "./ocr-retry.ts";

/** 사진의 긴 변을 이만큼으로 줄여 읽어요 — 아이패드 원본(4000px 안팎)은 느리고 글자 인식에도 득이 없어요. */
const MAX_SIDE = 2000;
/** 발급 창에 비교용으로 보여 주는 사진(「작성 중」 명함으로 서버에 남기는 사진도 이것)의 긴 변 · JPEG 품질 */
const PREVIEW_SIDE = 1200;
const PREVIEW_QUALITY = 0.8;

/**
 * 기다리는 한도. 도구가 일꾼 안에서 실패하면(CSP 가 wasm 을 막는 등) 약속이 끝나지 않아요 — 버튼이 「읽고 있습니다…」에 멈추지 않게 끊어요.
 * 처음 한 번은 전시장 인터넷으로 약 8.5MB 를 받아요. 받는 중(진행 소식이 오는 동안)이면 기다림을 늘려요(UG-451 기획 16991) —
 * 마지막 소식 뒤 LOAD_IDLE_MS(150초) 동안 아무 소식이 없거나, 모두 합쳐 LOAD_MAX_MS 가 지나면 끊어요.
 */
// tesseract 는 파일 단위로만 소식을 줘요 — 큰 파일(언어 데이터)을 받는 동안에는 소식이 없어 넉넉히(UG-451 반박 리뷰)
const LOAD_IDLE_MS = 150_000;
const LOAD_MAX_MS = 300_000;
/**
 * 도구 받기가 실패(오류로 끝남 — 인터넷이 잠깐 끊김 등)하면 이만큼 쉬고 한 번만 다시 받아요(UG-451 기획 17005) — 찍을 때마다 한 번(기획 17022).
 * 다시 받기도 처음 시작부터 센 LOAD_MAX_MS(5분) 안에서만 — 한 번 더 받는다고 기다림이 두 배가 되지 않아요.
 * 시간 초과(소식 없이 LOAD_IDLE_MS · 모두 LOAD_MAX_MS)로 끊긴 것은 다시 받지 않아요 — 이미 오래 기다렸고, 멈춘 일꾼은 닫을 수 없어 둘이 함께 받게 돼요.
 * 실패한 일꾼은 tesseract 가 돌려주지 않아 닫을 수 없어, 다시 받을 때마다 닫지 못한 일꾼이 쌓여요(반박 리뷰) —
 * 그래서 화면(페이지)을 연 동안 다시 받기는 모두 합쳐 MAX_AUTO_RETRIES 번까지만(ocr-retry.ts). 다 쓰면 「새로 고친 뒤 다시 찍어 주세요」(tool_reload).
 */
const LOAD_RETRY_DELAY_MS = 2_000;
const MAX_AUTO_RETRIES = 3;
const retryBudget = createRetryBudget(MAX_AUTO_RETRIES);
const READ_TIMEOUT_MS = 60_000;

/**
 * 읽지 못한 까닭 — tool = 글자 읽기 도구를 받지 못함(첫 사용 · 인터넷 없음 · 시간 초과),
 * tool_reload = 받지 못했고 페이지의 다시 받기도 다 씀(새로 고쳐야 해요, UG-451 기획 17022), read = 읽다가 실패
 */
export type ReadFailure = "tool" | "tool_reload" | "read";

const asset = (path: string) => new URL(path, window.location.origin).href;

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`명함 읽기 시간 초과(${ms}ms)`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/** 비트맵을 긴 변 maxSide 로 줄인 그림판에 그려요. 그리지 못하면 null */
function drawScaled(bitmap: ImageBitmap, maxSide: number): HTMLCanvasElement | null {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * 사진을 바로 세우고(촬영 방향 정보 반영) 읽기용 그림판(긴 변 2000)과 비교용 JPEG(긴 변 1200, data URL)으로 옮겨요.
 * blob: 주소는 만들지 않아요 — CSP(img-src)가 'self' data: 만 허용해요. 열지 못하는 형식이면 둘 다 null(원본을 그대로 읽어요).
 */
async function prepare(file: Blob): Promise<{ canvas: HTMLCanvasElement | null; preview: string | null }> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return { canvas: null, preview: null };
  }
  try {
    const canvas = drawScaled(bitmap, MAX_SIDE);
    const small = drawScaled(bitmap, PREVIEW_SIDE);
    let preview: string | null = null;
    if (small) {
      try {
        preview = small.toDataURL("image/jpeg", PREVIEW_QUALITY);
      } catch {
        preview = null;
      }
      small.width = small.height = 0;
    }
    return { canvas, preview };
  } finally {
    bitmap.close();
  }
}

type OcrWorker = Awaited<ReturnType<typeof import("tesseract.js")["createWorker"]>>;
type OcrLog = { status: string; progress: number };

/**
 * 일꾼을 띄우고 도구를 받아요. tesseract 는 엔진(core)을 받지 못하면 약속을 끝내지만, 언어 데이터를 받지 못하면(인터넷이 잠깐 끊김 등)
 * 약속이 끝나지 않고 오류만 errorHandler 로 알려요 — 그래서 띄우는 동안 온 오류로 실패를 바로 알아차려요(UG-451 기획 17005, 다시 받기).
 * 띄운 뒤(글자 읽기 중) 오류는 그 읽기 약속이 따로 실패로 끝나요 — 여기서는 무시해요(errorHandler 가 없으면 tesseract 가 잡히지 않는 오류를 던져요).
 * 실패한 일꾼은 tesseract 가 돌려주지 않아 닫을 수 없어요(전에도 같았어요 — 쉬는 일꾼이 남아요).
 */
async function startWorker(logger: (m: OcrLog) => void): Promise<OcrWorker> {
  // 화면 묶음에는 넣지 않고 처음 누를 때 받아요(목록 화면을 무겁게 하지 않게)
  const { createWorker, OEM } = await import("tesseract.js");
  const startup: { fail: ((reason: Error) => void) | null } = { fail: null };
  const failed = new Promise<never>((_, reject) => {
    startup.fail = reject;
  });
  const created = createWorker(["kor", "eng"], OEM.LSTM_ONLY, {
    logger,
    errorHandler: (err: unknown) => startup.fail?.(new Error(`명함 읽기 도구 받기 실패: ${String(err)}`)),
    workerPath: asset("/ocr/worker.min.js"),
    corePath: asset("/ocr/core"),
    langPath: asset("/ocr/lang"),
    // 일꾼을 blob: 주소가 아니라 같은 출처 파일로 띄워요(CSP worker-src 'self')
    workerBlobURL: false,
    gzip: true,
    // 브라우저 저장소 이름에 모델 판(4.0.0_best_int)을 넣어요 — 언어 데이터를 바꾸면 옛 사본을 읽지 않게
    cachePath: "gate-mgmt-ocr-4.0.0_best_int",
  });
  try {
    return await Promise.race([created, failed]);
  } finally {
    startup.fail = null;
  }
}

/** 늦게라도 뜬 일꾼은 닫아요(시간 초과 · 창 닫기 뒤). 끝나지 않는 약속이면 할 수 있는 게 없어요. */
const closeLater = (pending: Promise<OcrWorker>) => void pending.then((w) => w.terminate()).catch(() => undefined);

/**
 * 「계정 만들기」 창 하나 동안 쓰는 읽기 도구. 일꾼은 처음 읽을 때 띄우고 창이 열려 있는 동안 다시 써요(다시 찍기가 빨라요).
 * 창을 닫으면 dispose() 로 닫아요. 불러오기에 실패하거나 시간이 지나면 일꾼을 버리고 다음 읽기 때 새로 띄워요.
 */
export function createCardReader() {
  let worker: Promise<OcrWorker> | null = null;
  let disposed = false;
  // 도구를 받는 동안의 마지막 소식 시각 · 진행률을 받을 곳(읽는 동안만)
  let lastActivity = 0;
  let onProgress: ((percent: number) => void) | null = null;

  /** 도구 받기 소식 — 엔진(core) 30% · 언어 데이터 70% 로 나눠 0~100 으로 알려요(tesseract 가 주는 단계가 굵어요: 0 · 25 · 50 …) */
  function logger(m: OcrLog) {
    lastActivity = Date.now();
    if (m.status === "loading tesseract core") onProgress?.(Math.round(30 * m.progress));
    else if (m.status === "loading language traineddata") onProgress?.(Math.round(30 + 70 * m.progress));
  }

  /** 받는 동안 소식이 오면 기다림을 늘리는 한도(LOAD_IDLE_MS · LOAD_MAX_MS). started = 처음 받기 시작한 시각(다시 받기도 같은 시각부터 세요) */
  function withLoadTimeout<T>(work: Promise<T>, started: number): Promise<T> {
    let timer: ReturnType<typeof setInterval> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setInterval(() => {
        const now = Date.now();
        if (now - Math.max(started, lastActivity) > LOAD_IDLE_MS || now - started > LOAD_MAX_MS) {
          reject(new Error("명함 읽기 도구 받기 시간 초과"));
        }
      }, 1000);
    });
    return Promise.race([work, timeout]).finally(() => clearInterval(timer));
  }

  /** 도구 받기 한 번(다시 받기 포함). live = 아직 기다리는 받기인지 — 시간 초과 · 창 닫기 뒤에는 false 라 다시 받지 않아요(반박 리뷰) */
  type LoadAttempt = { live: boolean };
  let attempt: LoadAttempt | null = null;

  /** 도구 받기 — 오류로 끝나면 LOAD_RETRY_DELAY_MS 뒤 한 번만 다시(ocr-retry.ts). 진행률은 다시 0 부터 알려요. */
  function startWithRetry(started: number, mine: LoadAttempt): Promise<OcrWorker> {
    return loadWithRetry({
      start: () => startWorker(logger),
      budget: retryBudget,
      live: () => mine.live && attempt === mine && !disposed,
      started,
      maxMs: LOAD_MAX_MS,
      delayMs: LOAD_RETRY_DELAY_MS,
      onActivity: () => {
        lastActivity = Date.now();
      },
    });
  }

  // 지금 받는 도구의 시작 시각 — 받는 중에 다시 찍어 read 가 또 불려도 처음 시각부터 세요
  let loadStarted = 0;

  function ready(): Promise<OcrWorker> {
    if (!worker) {
      loadStarted = lastActivity = Date.now();
      const mine: LoadAttempt = { live: true };
      attempt = mine;
      const starting = startWithRetry(loadStarted, mine);
      worker = starting;
      // 실패 · 시간 초과면 버려요(시간 초과 뒤에 뜨면 닫아요). 시간 초과 뒤 첫 받기의 늦은 오류로 다시 받지 않게 live 를 꺼요
      withLoadTimeout(starting, loadStarted).catch(() => {
        mine.live = false;
        if (worker === starting) worker = null;
        closeLater(starting);
      });
    }
    return withLoadTimeout(worker, loadStarted);
  }

  /**
   * 명함 사진에서 읽은 글자(줄바꿈 포함)와 비교용 줄인 사진(data URL, 만들지 못하면 null).
   * 읽기 도구를 받지 못했거나 읽다가 실패하면 text 가 null 이고 failure 에 까닭이 있어요 — 그래도 이번 사진(preview)은 돌려줘요(앞 명함 사진이 남지 않게).
   * progress = 도구를 받는 동안의 진행률(0~100). 이미 받아 둔 도구면 부르지 않아요.
   */
  async function read(
    photo: Blob,
    progress?: (percent: number) => void,
  ): Promise<{ text: string | null; preview: string | null; failure: ReadFailure | null }> {
    const { canvas, preview } = await prepare(photo);
    onProgress = progress ?? null;
    try {
      let w: OcrWorker;
      try {
        w = await ready();
      } catch {
        // 읽기 도구를 받지 못함(첫 사용 · 인터넷 없음 · 시간 초과) — 다시 받기를 다 썼으면 새로 고치라고 안내해요
        return { text: null, preview, failure: retryBudget.spent ? "tool_reload" : "tool" };
      } finally {
        onProgress = null;
      }
      try {
        const { data } = await withTimeout(w.recognize(canvas ?? photo), READ_TIMEOUT_MS);
        return { text: data.text, preview, failure: null };
      } catch {
        // 읽다가 멈춘 일꾼은 다시 쓰지 않아요
        if (worker) closeLater(worker);
        worker = null;
        return { text: null, preview, failure: "read" };
      }
    } finally {
      // 그림판 메모리도 바로 비워요
      if (canvas) canvas.width = canvas.height = 0;
      if (disposed && worker) {
        closeLater(worker);
        worker = null;
      }
    }
  }

  /** 창이 열릴 때(개발 모드에서 효과가 두 번 돌아도 다시 쓸 수 있게) */
  function open() {
    disposed = false;
  }

  function dispose() {
    disposed = true;
    if (attempt) attempt.live = false;
    attempt = null;
    if (worker) closeLater(worker);
    worker = null;
  }

  return { read, open, dispose };
}

export type CardReader = ReturnType<typeof createCardReader>;
