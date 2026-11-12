// 명함을 서버가 읽기(UG-463). 기기 안 글자 읽기(card-ocr.ts · tesseract)는 줄이 붙어 읽히고(「Hong Gildong ACME Co)」) 라벨 · 도메인을 잘못 읽는 일이 잦아
// (E: → 6: · univs.ai → 「univs.c a」) 서버가 먼저 읽어요 — 줄인 사진을 보내면 네 칸 값(회사명 · 이름 · 이메일 · 연락처)만 돌려줘요.
// 서버가 읽지 못하면(꺼짐 503 · 경로 없음 404 · 오류 · 네트워크 · 25초) 화면은 전처럼 기기 안에서 읽어요(칩 포함 그대로).
// 서버 호출은 api.ts(readCardOnServer) — 여기서는 받아서 쓰기만 해요(순수 함수는 node 시험이 되게 브라우저 · 서버에 기대지 않아요).
import type { CardReadFields, CardReadResult } from "./api";
import { PREVIEW_QUALITY, PREVIEW_SIDE } from "./card-ocr.ts";
import { extractPhone, scannedEmailValue, type Chip, type ScanResult, type ScanValues } from "./card-scan.ts";

/** 서버로 보내는 사진 — 긴 변 · JPEG 품질(UG-463). 서버가 받는 크기는 풀어서 2 MiB 까지 */
export const UPLOAD_SIDE = 1568;
export const UPLOAD_QUALITY = 0.85;
export const UPLOAD_MAX_BYTES = 2 * 1024 * 1024;
/** 서버 답을 기다리는 한도 — 지나면 기기 안 읽기로 넘어가요(늦게 온 답은 버려요) */
export const SERVER_READ_TIMEOUT_MS = 25_000;

const JPEG_PREFIX = "data:image/jpeg;base64,";
// 제어 문자(줄바꿈 · 탭 등) — 칸 · 「작성 중」 저장이 받지 않아요(card-draft.ts 와 같은 범위)
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/g;
const EMAIL_SHAPE_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_CHARS_RE = /^[0-9 +()-]+$/;

/** base64 글자 → 풀었을 때 바이트 수 */
export function base64Bytes(b64: string): number {
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

const clean = (v: string | null) => (v ?? "").replace(CONTROL_RE, " ").replace(/\s+/g, " ").trim();

/**
 * 서버가 읽은 값 → 칸에 넣을 값(못 읽은 칸은 ""). 기기 안 읽기가 칸에 넣는 모양과 맞춰요 —
 * 이메일은 공백 · 「mailto:」를 떼고 메일 모양일 때만(scannedEmailValue — 도메인 소문자), 연락처는 번호만 뽑아(extractPhone) 칸이 받는 글자일 때만.
 * 모양이 아니면 비워요 — 칸 아래 「메일 주소를 찾지 못했습니다」로 직원이 직접 넣어요.
 */
export function serverValues(fields: CardReadFields): ScanValues {
  const email = clean(fields.email).replace(/\s+/g, "").replace(/^mailto:/i, "");
  const phoneRaw = clean(fields.phone);
  const phone = extractPhone(phoneRaw) || phoneRaw;
  return {
    company: clean(fields.company),
    name: clean(fields.name),
    email: EMAIL_SHAPE_RE.test(email) ? scannedEmailValue(email) : "",
    phone: PHONE_CHARS_RE.test(phone) ? phone : "",
  };
}

/**
 * 한글 명함인지(메일 언어 「한국어」, 기획 17118-2) — card-scan.ts isKoreanCard 의 칸 값 규칙과 같아요:
 * 회사명 · 이름에 한글 · 이메일이 .kr · 연락처가 010 · +82 로 시작
 */
export function isKoreanValues(values: ScanValues): boolean {
  if (/[가-힣]/.test(values.company) || /[가-힣]/.test(values.name)) return true;
  if (/\.kr$/i.test(values.email)) return true;
  return /^010/.test(values.phone.replace(/\D/g, "")) || /^\+82/.test(values.phone.replace(/[\s(]/g, ""));
}

/**
 * 서버가 읽은 값 → 기기 안 읽기의 결과 모양(scanCard 의 ScanResult) — 화면이 같은 채우기 규칙(빈 칸 · 앞 명함이 채운 그대로인 칸만)을 쓰게.
 * 칩은 없어요(chips = [] — 읽은 줄을 보여 주지도 「작성 중」에 남기지도 않아요). 네 칸이 모두 비면 unreadable(「명함을 읽지 못했습니다」).
 */
export function serverScan(values: ScanValues): ScanResult {
  const found = (values.email ? 1 : 0) + (values.phone ? 1 : 0);
  const any = Object.values(values).some((v) => v !== "");
  return {
    chips: [],
    values,
    links: {},
    outcome: any ? "found" : "unreadable",
    found,
    korean: any && isKoreanValues(values),
    confidence: 100,
    upright: true,
    sparse: false,
    weak: false,
  };
}

/**
 * 다시 찍은 명함이 앞 명함과 같은 사람인지 볼 때만 쓰는 칩(card-retake.ts — retakeVerdict · retakePlan 이 칩으로 견줘요).
 * 화면에 보여 주지 않고 저장하지도 않아요.
 */
export function serverChips(values: ScanValues): Chip[] {
  const chips: Chip[] = [];
  const add = (text: string, kind: Chip["kind"]) => text && chips.push({ id: chips.length + 1, text, kind, value: text });
  add(values.company, "other");
  add(values.name, "other");
  add(values.email, "email");
  add(values.phone, "phone");
  return chips;
}

// 페이지를 연 동안 서버에 명함 읽기가 없다고 답했는지(503 · 404) — 그 뒤로는 부르지 않고 바로 기기 안에서 읽어요(느린 호출을 되풀이하지 않게)
let unavailable = false;

/** 서버에 물어볼지 — 이 페이지에서 「없음」 답을 받은 적이 없으면 */
export const serverReadAvailable = () => !unavailable;

/** 비트맵을 긴 변 maxSide 로 줄인 그림판. 그리지 못하면 null */
function drawScaled(bitmap: ImageBitmap, maxSide: number): HTMLCanvasElement | null {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function toDataUrl(canvas: HTMLCanvasElement | null, quality: number): string | null {
  if (!canvas) return null;
  try {
    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    canvas.width = canvas.height = 0;
  }
}

/** 2 MiB 를 넘으면 품질 · 크기를 줄여 다시 — 보통 명함은 첫 단계(1568 · 0.85)에서 수백 KB 예요 */
const UPLOAD_STEPS: readonly [number, number][] = [
  [UPLOAD_SIDE, UPLOAD_QUALITY],
  [UPLOAD_SIDE, 0.7],
  [1280, 0.7],
  [1024, 0.6],
];

/**
 * 찍은 사진 → 서버로 보낼 사진(data: 접두사 없는 base64 JPEG, 풀어서 2 MiB 이하)과 창에 둘 비교용 사진(card-ocr 와 같은 크기 · 품질의 data URL).
 * 사진을 바로 세워(촬영 방향 정보) 줄여요. 브라우저가 열지 못한 사진(HEIC 등)이면 둘 다 null — 화면이 기기 안 읽기로 넘어가요(형식 안내는 그쪽이 해요).
 * JPEG 를 만들지 못하면(브라우저가 PNG 로 돌려줌) upload 는 null 이에요.
 */
export async function prepareUpload(file: Blob): Promise<{ upload: string | null; preview: string | null }> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return { upload: null, preview: null };
  }
  try {
    let preview: string | null = null;
    try {
      preview = toDataUrl(drawScaled(bitmap, PREVIEW_SIDE), PREVIEW_QUALITY);
    } catch {
      preview = null;
    }
    let upload: string | null = null;
    for (const [side, quality] of UPLOAD_STEPS) {
      let url: string | null;
      try {
        url = toDataUrl(drawScaled(bitmap, side), quality);
      } catch {
        break;
      }
      if (!url || !url.startsWith(JPEG_PREFIX)) break;
      const b64 = url.slice(JPEG_PREFIX.length);
      if (base64Bytes(b64) <= UPLOAD_MAX_BYTES) {
        upload = b64;
        break;
      }
    }
    return { upload, preview };
  } finally {
    bitmap.close();
  }
}

/** 서버가 읽은 결과 — values = 칸에 넣을 값(다듬은 것), preview = 창에 둘 비교용 사진 */
export type ServerReading = { values: ScanValues; preview: string | null };

/**
 * 명함 사진을 서버가 읽어요. 읽지 못하면 null — 화면이 기기 안 읽기로 넘어가요.
 * - 사진을 열지 못함 · JPEG 로 만들지 못함 · 2 MiB 안으로 줄이지 못함 → null(서버에 보내지 않아요)
 * - 서버가 「없음」(503 · 404) → null, 이 페이지에서는 더 부르지 않아요(serverReadAvailable)
 * - 그 밖의 실패 · SERVER_READ_TIMEOUT_MS 초과 · cancel(창 닫기) → null. 한도가 지나면 요청을 끊고, 늦게 온 답은 쓰지 않아요
 * call = 서버 호출(api.ts readCardOnServer — 시험에서는 바꿔 끼워요)
 */
export async function readOnServer(
  file: Blob,
  call: (photo: string, signal: AbortSignal) => Promise<CardReadResult>,
  cancel?: AbortSignal,
  timeoutMs: number = SERVER_READ_TIMEOUT_MS,
): Promise<ServerReading | null> {
  if (unavailable || cancel?.aborted) return null;
  const { upload, preview } = await prepareUpload(file);
  if (!upload || cancel?.aborted) return null;
  const ctrl = new AbortController();
  const onCancel = () => ctrl.abort();
  cancel?.addEventListener("abort", onCancel);
  let timer: ReturnType<typeof setTimeout> | undefined;
  // 한도가 지나면 요청을 끊고 바로 null — 재발급처럼 신호가 닿지 않는 단계에 걸려 있어도 기다리지 않아요
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      ctrl.abort();
      resolve(null);
    }, timeoutMs);
  });
  const stopped = new Promise<null>((resolve) => ctrl.signal.addEventListener("abort", () => resolve(null)));
  try {
    const r = await Promise.race([call(upload, ctrl.signal).catch((): CardReadResult => ({ ok: false, reason: "failed" })), timeout, stopped]);
    if (!r || ctrl.signal.aborted) return null;
    if (!r.ok) {
      if (r.reason === "unavailable") unavailable = true;
      return null;
    }
    return { values: serverValues(r.fields), preview };
  } finally {
    clearTimeout(timer);
    cancel?.removeEventListener("abort", onCancel);
  }
}
