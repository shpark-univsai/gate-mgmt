// 명함 사진 → 글자 (UG-431). 사진은 이 기기(브라우저) 안에서만 읽고 서버로 보내지 않아요 — 읽고 나면 사진 · 그림판 · 일꾼을 모두 버려요.
// 글자 읽기 도구는 tesseract.js(한국어 + 영어). 도구 파일은 같은 출처 /ocr/ 에서 받아요(외부 CDN 없음) —
// scripts/copy-ocr-assets.mjs 가 dev · build 전에 node_modules 에서 public/ocr/ 로 복사해요.
// 처음 한 번은 언어 데이터(약 4.5MB)를 내려받고 브라우저 저장소(IndexedDB)에 둬요 — 다음부터는 바로 읽어요.
// 배포 화면의 CSP 는 일꾼 안에서 wasm 을 돌릴 수 있게 script-src 에 'wasm-unsafe-eval' 이 있어야 해요(nginx 설정, 플랫폼 쪽).

/** 사진의 긴 변을 이만큼으로 줄여 읽어요 — 아이패드 원본(4000px 안팎)은 느리고 글자 인식에도 득이 없어요. */
const MAX_SIDE = 2000;

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

/**
 * 사진을 바로 세우고(촬영 방향 정보 반영) 줄인 그림판으로 옮겨요. 사진 주소(object URL)를 만들지 않아요 —
 * CSP(img-src)도 blob: 을 허용하지 않고, 지울 주소가 남지 않아요. 열지 못하는 형식이면 null(원본을 그대로 넘겨요).
 */
async function toCanvas(file: Blob): Promise<HTMLCanvasElement | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return null;
  }
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    bitmap.close();
  }
}

/** 명함 사진에서 읽은 글자(줄바꿈 포함). 읽기 도구를 받지 못했거나 읽다가 실패하면 예외를 던져요. */
export async function readCardText(photo: Blob): Promise<string> {
  const canvas = await toCanvas(photo);
  // 화면 묶음에는 넣지 않고 처음 누를 때 받아요(목록 화면을 무겁게 하지 않게)
  const { createWorker, OEM } = await import("tesseract.js");
  let worker: Awaited<ReturnType<typeof createWorker>>;
  try {
    worker = await withTimeout(
      createWorker(["kor", "eng"], OEM.LSTM_ONLY, {
        workerPath: asset("/ocr/worker.min.js"),
        corePath: asset("/ocr/core"),
        langPath: asset("/ocr/lang"),
        // 일꾼을 blob: 주소가 아니라 같은 출처 파일로 띄워요(CSP worker-src 'self')
        workerBlobURL: false,
        gzip: true,
        cachePath: "gate-mgmt-ocr",
      }),
      LOAD_TIMEOUT_MS,
    );
  } catch (e) {
    if (canvas) canvas.width = canvas.height = 0;
    throw e;
  }
  try {
    const { data } = await withTimeout(worker.recognize(canvas ?? photo), READ_TIMEOUT_MS);
    return data.text;
  } finally {
    await worker.terminate();
    // 그림판 메모리도 바로 비워요
    if (canvas) canvas.width = canvas.height = 0;
  }
}
