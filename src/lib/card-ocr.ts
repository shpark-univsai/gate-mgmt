// 명함 사진 → 글자 (UG-431). 이 파일의 글자 읽기는 이 기기(브라우저) 안에서 해요 — 읽고 나면 원본 · 그림판은 바로 버려요.
// UG-463 부터는 서버가 먼저 읽어요(card-read.ts — 줄인 사진을 보내 네 칸 값만 받아요). 이 기기 안 읽기는 서버가 읽지 못할 때(꺼짐 · 오류 · 25초)만 써요.
// 비교용으로 줄인 사진(data URL)만 돌려줘요 — 발급 창에 두고, 계정을 만들면 계정과 함께 서버로 보낸 뒤 창에서는 비워요(기기에는 저장하지 않음, UG-455).
// 만들지 않고 창을 닫으면 이 줄인 사진만 「작성 중」 명함으로 서버에 남겨요(기획 16864).
// 글자 읽기 도구는 tesseract.js(한국어 + 영어). 도구 파일은 같은 출처 /ocr/ 에서 받아요(외부 CDN 없음) —
// scripts/copy-ocr-assets.mjs 가 dev · build 전에 node_modules 에서 public/ocr/ 로 복사해요.
// 처음 한 번은 언어 데이터(약 4.5MB)를 내려받고 브라우저 저장소(IndexedDB)에 둬요 — 다음부터는 바로 읽어요.
// 일꾼은 「계정 만들기」 창이 열려 있는 동안만 살려 두고, 창을 닫으면 닫아요(createCardReader).
// 배포 화면의 CSP 는 일꾼 안에서 wasm 을 돌릴 수 있게 script-src 에 'wasm-unsafe-eval' 이 있어야 해요(nginx 설정, 플랫폼 쪽).

import { ROTATIONS, isSettled, needsRetry, pickReading, rotateBudget, type ReadingScore, type Rotation } from "./card-rotate.ts";
import type { OcrLine } from "./card-scan.ts";
import { createRetryBudget, loadWithRetry } from "./ocr-retry.ts";

/** 사진의 긴 변을 이만큼으로 줄여 읽어요 — 아이패드 원본(4000px 안팎)은 느리고 글자 인식에도 득이 없어요. */
const MAX_SIDE = 2000;
/** 발급 창에 비교용으로 보여 주는 사진(「작성 중」 명함으로 서버에 남기는 사진도 이것)의 긴 변 · JPEG 품질 */
export const PREVIEW_SIDE = 1200;
export const PREVIEW_QUALITY = 0.8;

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

/** 그림판 → 비교용 JPEG(data URL). 만들지 못하면 null */
function toPreview(canvas: HTMLCanvasElement | null): string | null {
  if (!canvas) return null;
  try {
    return canvas.toDataURL("image/jpeg", PREVIEW_QUALITY);
  } catch {
    return null;
  }
}

/** 그림판을 시계 방향으로 90° · 180° · 270° 돌린 새 그림판(UG-451 기획 17106-3). 만들지 못하면 null */
function rotated(src: HTMLCanvasElement, degrees: Exclude<Rotation, 0>): HTMLCanvasElement | null {
  const canvas = document.createElement("canvas");
  const sideways = degrees !== 180;
  canvas.width = sideways ? src.height : src.width;
  canvas.height = sideways ? src.width : src.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((degrees * Math.PI) / 180);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return canvas;
}

/**
 * 사진을 바로 세우고(촬영 방향 정보 반영) 읽기용 그림판(긴 변 2000)과 비교용 그림판(긴 변 1200) · 그 JPEG(data URL)으로 옮겨요.
 * blob: 주소는 만들지 않아요 — CSP(img-src)가 'self' data: 만 허용해요. 열지 못하는 형식이면 모두 null(원본을 그대로 읽어요).
 * 비교용 그림판(small)은 돌려 읽은 방향이 이기면 그 방향으로 다시 그리려고 읽기가 끝날 때까지 남겨요(끝나면 read 가 비워요).
 */
async function prepare(file: Blob): Promise<{ canvas: HTMLCanvasElement | null; small: HTMLCanvasElement | null; preview: string | null }> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return { canvas: null, small: null, preview: null };
  }
  try {
    const canvas = drawScaled(bitmap, MAX_SIDE);
    const small = drawScaled(bitmap, PREVIEW_SIDE);
    return { canvas, small, preview: toPreview(small) };
  } finally {
    bitmap.close();
  }
}

type OcrPage = Awaited<ReturnType<OcrWorker["recognize"]>>["data"];

/** 글자 읽기 결과의 줄 · 낱말과 그 인식 점수(0~100) — 회사명 · 이름 자동 채움이 점수가 높은 줄만 쓰려고(UG-451 기획 17100). 도구가 주지 않으면 null */
function linesOf(data: OcrPage): OcrLine[] | null {
  if (!data.blocks) return null;
  const lines: OcrLine[] = [];
  for (const block of data.blocks) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        lines.push({
          text: line.text,
          confidence: line.confidence,
          words: (line.words ?? []).map((w) => ({ text: w.text, confidence: w.confidence })),
        });
      }
    }
  }
  return lines;
}

/** 글자와 함께 줄 · 낱말 점수(blocks)도 받아요 */
const OCR_OUTPUT = { text: true, blocks: true } as const;

/**
 * 돌려 읽기(UG-451 기획 17106-3) — judge = 한 방향으로 읽은 글자의 점수(화면이 card-scan 으로 매겨요),
 * onRetry = 다른 방향으로 다시 읽기 시작할 때(attempt 번째 / 모두 total 방향) — 기다림 안내가 멈춘 것처럼 보이지 않게 화면이 알려요
 */
export type RotateOptions = {
  judge: (text: string, lines: OcrLine[] | null) => ReadingScore;
  onRetry?: (attempt: number, total: number) => void;
};

/** 읽은 결과 — rotation = 쓴 방향(시계 방향으로 돌린 각도, 0 = 찍힌 그대로). preview 도 그 방향으로 세운 사진이에요 */
export type CardReading = {
  text: string | null;
  lines: OcrLine[] | null;
  preview: string | null;
  failure: ReadFailure | null;
  rotation: Rotation;
  /**
   * 이 읽기가 「바로 놓인 명함인지 모르는데 연락처만 찾은」 것일 때 그 번호를 믿어도 되는지(scanCard 의 opts.lonePhone 으로 넘겨요).
   * 돌려 읽고도 그런 방향이 둘 이상이거나 다 읽지 못했으면 false — 거꾸로 읽힌 번호일 수 있어 채우지 않아요(card-rotate.ts pickReading)
   */
  lonePhone: boolean;
};

/**
 * 읽을 그림을 바이트로 — 일꾼에게 넘기기 전에 여기서 미리 바꿔 둬요(UG-451 반박 리뷰 후속 6).
 * tesseract 는 그림판 · Blob 을 받으면 안에서 바이트로 바꾼 뒤(비동기) 일꾼에게 보내는데, 그 사이에 읽기를 끊어 일꾼을 닫으면
 * 닫힌 일꾼에 보내다 난 오류(Cannot read properties of null (reading 'postMessage'))가 어디에도 잡히지 않고 남아요.
 * 바이트를 넘기면 그 변환이 같은 차례 안에서 끝나, 끊는 일이 그 사이에 끼어들 수 없어요.
 */
async function imageBytes(image: HTMLCanvasElement | Blob): Promise<Uint8Array> {
  const blob = image instanceof Blob ? image : await new Promise<Blob | null>((resolve) => image.toBlob(resolve));
  if (!blob) throw new Error("명함 그림을 읽을 수 없음");
  return new Uint8Array(await blob.arrayBuffer());
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
  // 지금 하는 읽기(UG-451 반박 리뷰 4) — 돌려 읽는 동안 직원이 「명함 다시 찍기」로 새 사진을 주면 앞 읽기를 버려요.
  // generation = 읽기 차례 번호(새 읽기가 시작되면 앞 읽기는 더 돌리지 않아요), abortCurrent = 앞 읽기가 기다리던 글자 읽기를 바로 끊는 함수
  let generation = 0;
  let abortCurrent: (() => void) | null = null;
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
   * 명함 사진에서 읽은 글자(줄바꿈 포함) · 줄 점수와 비교용 줄인 사진(data URL, 만들지 못하면 null).
   * 읽기 도구를 받지 못했거나 읽다가 실패하면 text 가 null 이고 failure 에 까닭이 있어요 — 그래도 이번 사진(preview)은 돌려줘요(앞 명함 사진이 남지 않게).
   * progress = 도구를 받는 동안의 진행률(0~100). 이미 받아 둔 도구면 부르지 않아요.
   * rotate 를 주면 찍힌 방향으로 읽은 결과가 「못 읽음」이거나 「연락처만 찾음」(needsRetry)일 때만 180° → 90° → 270° 로 돌려 다시 읽고, 가장 나은 방향의 결과를 돌려줘요
   * (UG-451 기획 17106-3, card-rotate.ts). 돌려 읽은 방향이 이기면 preview 도 그 방향으로 세워요 — 썸네일 · 크게 보기 · 서버에 남기는 사진이 모두 이 preview 예요.
   * 돌려 읽기는 첫 읽기 시작부터 ROTATE_START_LIMIT_MS 안에만 시작하고 ROTATE_TOTAL_MS 에 끊어요. 끊긴(멈춘) 일꾼은 버리고 그때까지의 결과를 써요.
   * 브라우저가 열지 못한 사진(그림판 없음)은 돌릴 수 없어 찍힌 그대로만 읽어요.
   * 읽는 중에 read 가 또 불리면(돌려 읽는 동안의 「명함 다시 찍기」) 앞 읽기는 버려요 — 읽던 일꾼을 닫아 새 읽기가 기다리지 않게 하고,
   * 앞 읽기는 더 돌리지 않고 그때까지의 결과로 바로 끝나요(화면이 그 결과를 쓰지 않아요 — 읽기 차례 번호로 걸러요).
   */
  async function read(photo: Blob, progress?: (percent: number) => void, rotate?: RotateOptions): Promise<CardReading> {
    // 앞 읽기가 아직 돌고 있으면 버려요 — 읽던 일꾼은 닫고(읽는 중인 글자 읽기는 멈출 수 없어요) 새 일꾼으로 읽어요
    const mine = ++generation;
    abortCurrent?.();
    abortCurrent = null;
    const { canvas, small, preview } = await prepare(photo);
    if (mine !== generation) {
      // 사진을 여는 사이 더 새 읽기가 시작됨
      if (canvas) canvas.width = canvas.height = 0;
      if (small) small.width = small.height = 0;
      return { text: null, lines: null, preview, failure: "read", rotation: 0, lonePhone: true };
    }
    onProgress = progress ?? null;
    // 이 읽기가 쓰는 일꾼 — 버려지면(abort) 이 일꾼만 닫아요(그사이 새 읽기가 띄운 일꾼은 건드리지 않아요)
    let used: Promise<OcrWorker> | null = null;
    const dropUsed = () => {
      if (!used) return;
      closeLater(used);
      if (worker === used) worker = null;
      used = null;
    };
    let abort: () => void = () => undefined;
    const aborted = new Promise<never>((_, reject) => {
      abort = () => reject(new Error("새 명함 읽기가 시작됨"));
    });
    aborted.catch(() => undefined);
    /** 글자 읽기 한 번 — 한도(ms)가 지나거나 새 읽기가 시작되면 끊어요 */
    const recognize = async (w: OcrWorker, image: HTMLCanvasElement | Blob, ms: number) => {
      // 그림을 먼저 바이트로 바꾸고(끊기면 여기서 끝나요), 끊기지 않았을 때만 일꾼에게 넘겨요 — 닫힌 일꾼에는 보내지 않아요(imageBytes)
      const bytes = await Promise.race([imageBytes(image), aborted]);
      if (!used) throw new Error("읽기가 끊김");
      // tesseract 의 타입에는 없지만 바이트(Uint8Array)를 그대로 받아요(loadImage 가 그대로 넘겨요)
      return Promise.race([withTimeout(w.recognize(bytes as unknown as Blob, {}, OCR_OUTPUT), ms), aborted]);
    };
    try {
      let w: OcrWorker;
      try {
        w = await ready();
      } catch {
        // 읽기 도구를 받지 못함(첫 사용 · 인터넷 없음 · 시간 초과) — 다시 받기를 다 썼으면 새로 고치라고 안내해요
        return { text: null, lines: null, preview, failure: retryBudget.spent ? "tool_reload" : "tool", rotation: 0, lonePhone: true };
      } finally {
        onProgress = null;
      }
      if (mine !== generation) return { text: null, lines: null, preview, failure: "read", rotation: 0, lonePhone: true };
      used = worker;
      abortCurrent = () => {
        dropUsed();
        abort();
      };
      const started = Date.now();
      let first: OcrPage;
      try {
        ({ data: first } = await recognize(w, canvas ?? photo, READ_TIMEOUT_MS));
      } catch {
        // 읽다가 멈춘(또는 버려진) 일꾼은 다시 쓰지 않아요
        dropUsed();
        return { text: null, lines: null, preview, failure: "read", rotation: 0, lonePhone: true };
      }
      const readings: { rotation: Rotation; text: string; lines: OcrLine[] | null }[] = [{ rotation: 0, text: first.text, lines: linesOf(first) }];
      if (!canvas || !rotate) return { text: readings[0].text, lines: readings[0].lines, preview, failure: null, rotation: 0, lonePhone: true };
      const scores = [rotate.judge(readings[0].text, readings[0].lines)];
      for (const rotation of ROTATIONS) {
        if (rotation === 0) continue;
        // 방금 읽은 방향에서 찾았으면 끝 · 창을 닫았거나 새 읽기가 시작됐거나 한도가 지났으면 더 돌리지 않아요
        const budget = rotateBudget(Date.now() - started);
        // 찍힌 그대로가 방향이 맞게 읽혔거나 글자가 거의 없으면 돌리지 않고, 돌려 읽다가 방향이 맞는 읽기가 나오면 멈춰요.
        // 「연락처만 찾은」 방향(거꾸로 읽힌 번호일 수 있어요)에서는 멈추지 않아요(반박 리뷰 후속 1)
        const settled = scores.length === 1 ? !needsRetry(scores[0]) : isSettled(scores[scores.length - 1]);
        if (settled || disposed || mine !== generation || budget <= 0) break;
        const turned = rotated(canvas, rotation);
        if (!turned) break;
        rotate.onRetry?.(readings.length + 1, ROTATIONS.length);
        try {
          const { data } = await recognize(w, turned, Math.min(READ_TIMEOUT_MS, budget));
          const lines = linesOf(data);
          readings.push({ rotation, text: data.text, lines });
          scores.push(rotate.judge(data.text, lines));
        } catch {
          // 돌려 읽다가 멈춤 · 한도 초과 · 새 읽기에 밀림 — 일꾼은 버리고 그때까지 읽은 결과를 써요(읽기 실패가 아니에요)
          dropUsed();
          break;
        } finally {
          turned.width = turned.height = 0;
        }
      }
      const pick = pickReading(scores, scores.length === ROTATIONS.length);
      const best = readings[pick.index];
      let upright = preview;
      if (best.rotation !== 0 && small) {
        // 돌려 읽은 방향이 이겼으면 비교용 사진도 바로 세워요 — 만들지 못하면 찍힌 그대로
        const turned = rotated(small, best.rotation);
        upright = toPreview(turned) ?? preview;
        if (turned) turned.width = turned.height = 0;
      }
      return { text: best.text, lines: best.lines, preview: upright, failure: null, rotation: best.rotation, lonePhone: pick.lonePhone };
    } finally {
      if (mine === generation) abortCurrent = null;
      // 그림판 메모리도 바로 비워요
      if (canvas) canvas.width = canvas.height = 0;
      if (small) small.width = small.height = 0;
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
    // 읽는 중이면 바로 끊어요(그림판 · 일꾼을 기다리지 않고 정리)
    abortCurrent?.();
    abortCurrent = null;
    if (attempt) attempt.live = false;
    attempt = null;
    if (worker) closeLater(worker);
    worker = null;
  }

  return { read, open, dispose };
}

export type CardReader = ReturnType<typeof createCardReader>;
