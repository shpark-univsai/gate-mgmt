// 명함 사진 → 글자 (UG-431). 사진은 이 기기(브라우저) 안에서만 읽고 서버로 보내지 않아요 — 읽고 나면 원본 · 그림판은 바로 버려요.
// 비교용으로 줄인 사진(data URL)만 돌려줘요 — 발급 창에 보여 주고 이 기기에만 잠깐 둬요(card-photo.ts).
// 글자 읽기 도구는 tesseract.js(한국어 + 영어). 도구 파일은 같은 출처 /ocr/ 에서 받아요(외부 CDN 없음) —
// scripts/copy-ocr-assets.mjs 가 dev · build 전에 node_modules 에서 public/ocr/ 로 복사해요.
// 처음 한 번은 언어 데이터(약 4.5MB)를 내려받고 브라우저 저장소(IndexedDB)에 둬요 — 다음부터는 바로 읽어요.
// 일꾼은 「계정 만들기」 창이 열려 있는 동안만 살려 두고, 창을 닫으면 닫아요(createCardReader).
// 배포 화면의 CSP 는 일꾼 안에서 wasm 을 돌릴 수 있게 script-src 에 'wasm-unsafe-eval' 이 있어야 해요(nginx 설정, 플랫폼 쪽).

/** 사진의 긴 변을 이만큼으로 줄여 읽어요 — 아이패드 원본(4000px 안팎)은 느리고 글자 인식에도 득이 없어요. */
const MAX_SIDE = 2000;
/** 비교용으로 보여 주고 기기에 두는 사진(card-photo.ts)의 긴 변 · JPEG 품질 */
const PREVIEW_SIDE = 1200;
const PREVIEW_QUALITY = 0.8;

/**
 * 기다리는 한도. 도구가 일꾼 안에서 실패하면(CSP 가 wasm 을 막는 등) 약속이 끝나지 않아요 — 버튼이 「읽고 있습니다…」에 멈추지 않게 끊어요.
 * 처음 한 번은 전시장 인터넷으로 약 8MB 를 받으므로 넉넉히.
 */
const LOAD_TIMEOUT_MS = 90_000;
const READ_TIMEOUT_MS = 60_000;

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

async function startWorker(): Promise<OcrWorker> {
  // 화면 묶음에는 넣지 않고 처음 누를 때 받아요(목록 화면을 무겁게 하지 않게)
  const { createWorker, OEM } = await import("tesseract.js");
  return createWorker(["kor", "eng"], OEM.LSTM_ONLY, {
    workerPath: asset("/ocr/worker.min.js"),
    corePath: asset("/ocr/core"),
    langPath: asset("/ocr/lang"),
    // 일꾼을 blob: 주소가 아니라 같은 출처 파일로 띄워요(CSP worker-src 'self')
    workerBlobURL: false,
    gzip: true,
    // 브라우저 저장소 이름에 모델 판(4.0.0_best_int)을 넣어요 — 언어 데이터를 바꾸면 옛 사본을 읽지 않게
    cachePath: "gate-mgmt-ocr-4.0.0_best_int",
  });
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

  function ready(): Promise<OcrWorker> {
    if (!worker) {
      const starting = startWorker();
      worker = starting;
      // 실패 · 시간 초과면 버려요(시간 초과 뒤에 뜨면 닫아요)
      withTimeout(starting, LOAD_TIMEOUT_MS).catch(() => {
        if (worker === starting) worker = null;
        closeLater(starting);
      });
    }
    return withTimeout(worker, LOAD_TIMEOUT_MS);
  }

  /**
   * 명함 사진에서 읽은 글자(줄바꿈 포함)와 비교용 줄인 사진(data URL, 만들지 못하면 null).
   * 읽기 도구를 받지 못했거나 읽다가 실패하면 text 가 null 이에요 — 그래도 이번 사진(preview)은 돌려줘요(앞 명함 사진이 남지 않게).
   */
  async function read(photo: Blob): Promise<{ text: string | null; preview: string | null }> {
    const { canvas, preview } = await prepare(photo);
    try {
      const w = await ready();
      try {
        const { data } = await withTimeout(w.recognize(canvas ?? photo), READ_TIMEOUT_MS);
        return { text: data.text, preview };
      } catch {
        // 읽다가 멈춘 일꾼은 다시 쓰지 않아요
        if (worker) closeLater(worker);
        worker = null;
        return { text: null, preview };
      }
    } catch {
      // 읽기 도구를 받지 못함(첫 사용 · 인터넷 없음 · 시간 초과)
      return { text: null, preview };
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
    if (worker) closeLater(worker);
    worker = null;
  }

  return { read, open, dispose };
}

export type CardReader = ReturnType<typeof createCardReader>;
