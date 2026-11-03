// 「작성 중」 명함(UG-431 기획 16864) — 계정 만들기 창의 명함 상태(칩 · 칸 연결 · 사진)를 서버에 남기고 되살리는 변환.
// 화면에 기대지 않는 순수 함수만 둬요. 서버 호출은 api.ts(saveCardDraft · getCardDraft).
import type { Chip, ChipKind, ScanField, ScanLinks } from "./card-scan";

/** 칩 상태 — 명함에서 읽은 줄과 칸 연결(어느 칸에 어느 칩이 들어갔는지) */
export type ScanState = { chips: Chip[]; links: ScanLinks };

/** 서버가 받아 주는 칩 JSON 길이 상한(직렬화한 글자 수). 넘으면 칩 없이 남겨요 — 네 칸 · 사진은 그대로 */
export const CHIPS_JSON_MAX = 32768;
/** 저장 형식 판 — 형식을 바꾸면 올려요(옛 판은 칩 없이 열려요) */
const CHIPS_VERSION = 1;

const JPEG_PREFIX = "data:image/jpeg;base64,";
const CHIP_KINDS: readonly string[] = ["email", "phone", "other"] satisfies ChipKind[];
const FIELDS: readonly ScanField[] = ["company", "name", "email", "phone"];

/** 칩 상태 → 서버에 보낼 JSON. 상한을 넘으면 null(칩 없이 남겨요) */
export function chipsForDraft(scan: ScanState | null): { v: number; chips: Chip[]; links: ScanLinks } | null {
  if (!scan || scan.chips.length === 0) return null;
  const json = { v: CHIPS_VERSION, chips: scan.chips, links: scan.links };
  return JSON.stringify(json).length <= CHIPS_JSON_MAX ? json : null;
}

/**
 * 서버에 남긴 칩 JSON → 칩 상태. 다른 판 · 깨진 값이면 null(칩 없이 네 칸 · 사진만 열어요).
 * 저장한 것은 이 화면이지만 서버를 거쳐 온 값이라 모양을 하나씩 확인해요.
 */
export function scanFromDraft(json: unknown): ScanState | null {
  if (!json || typeof json !== "object") return null;
  const o = json as { v?: unknown; chips?: unknown; links?: unknown };
  if (o.v !== CHIPS_VERSION || !Array.isArray(o.chips) || o.chips.length === 0) return null;
  const chips: Chip[] = [];
  for (const c of o.chips as unknown[]) {
    if (!c || typeof c !== "object") return null;
    const { id, text, kind, value, fax } = c as Record<string, unknown>;
    if (typeof id !== "number" || typeof text !== "string" || typeof value !== "string") return null;
    if (typeof kind !== "string" || !CHIP_KINDS.includes(kind)) return null;
    chips.push({ id, text, kind: kind as ChipKind, value, ...(fax === true ? { fax: true } : {}) });
  }
  const ids = new Set(chips.map((c) => c.id));
  const links: ScanLinks = {};
  if (o.links && typeof o.links === "object") {
    for (const f of FIELDS) {
      const n = (o.links as Record<string, unknown>)[f];
      if (typeof n === "number" && ids.has(n)) links[f] = n;
    }
  }
  return { chips, links };
}

/** 창의 사진(data URL) → 서버에 보낼 순수 base64. JPEG 가 아니면(브라우저가 JPEG 로 만들지 못함) null — 서버가 받지 않아요(MGMT-111) */
export function photoForDraft(dataUrl: string | null): string | null {
  return dataUrl && dataUrl.startsWith(JPEG_PREFIX) ? dataUrl.slice(JPEG_PREFIX.length) : null;
}

/** 서버의 base64 JPEG → 창에 보여 줄 data URL */
export const photoFromDraft = (base64: string | null): string | null => (base64 ? JPEG_PREFIX + base64 : null);
