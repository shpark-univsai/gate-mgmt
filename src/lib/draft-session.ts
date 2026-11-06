// 계정 만들기 창 한 번(열고 닫을 때까지)의 「작성 중」 명함 규칙(UG-451 기획 17009 · 반박 리뷰). 화면에 기대지 않는 순수 함수만 둬요.
// - 사진을 어떻게 보낼지(photoPlan)
// - 응답을 잃은 새 명함 저장을 서버 목록에서 찾기(resolveLostDraft) — 다른 명함을 잘못 잇지 않게 엄격하게
// - 저장 결과를 창의 기억(번호 · 서버 사진)에 반영하는 차례(recordSave)
import type { CardDraft, CardDraftInput, CardDraftSaveResult } from "./api";
// 값 import 는 .ts 까지 적어요 — `npm test`(Node 가 타입만 지우고 바로 실행)가 확장자 없는 경로를 찾지 못해요
import { photoForDraft, photoFromDraft } from "./card-draft.ts";
import { photoTag, type AutosaveResult } from "./draft-autosave.ts";

/**
 * 「작성 중」으로 보낼 사진 — 화면 사진이 서버 명함의 사진과 같을 때만 keepPhoto(다시 올리지 않음).
 * 새로 찍은 사진이면 그 사진(JPEG 만), 읽는 중이거나 화면에 사진이 없으면(다시 찍기를 시작함 · 새 사진을 만들지 못함) 사진 없이 —
 * 앞 명함(A)의 사진이 새 명함(B)의 칸과 함께 남지 않게 해요(반박 리뷰 F4). 지난 촬영의 사진을 keepPhoto 로 남기는 일은 없어요.
 */
export function photoPlan(photo: string | null, serverPhoto: string | null, scanning: boolean): { photo?: string; keepPhoto?: true } {
  if (scanning || !photo) return {};
  if (photo === serverPhoto) return { keepPhoto: true };
  const b64 = photoForDraft(photo);
  return b64 ? { photo: b64 } : {};
}

/** 응답을 잃은 새 명함 저장들 — since 이후에 생긴 명함만 후보(이 창을 연 시각 − 시계 오차) */
export type LostSaves = { since: number; inputs: readonly CardDraftInput[] };
/** 서버 · 브라우저 시계 차이를 봐주는 폭 */
export const LOST_CLOCK_SKEW_MS = 60_000;
/** 기억해 둘 응답 잃은 저장 수 — 가장 최근 몇 개면 충분해요 */
export const LOST_MAX = 5;

/** 응답을 잃은 저장을 하나 더 기억해요(가장 최근 LOST_MAX 개) */
export const addLost = (lost: LostSaves, input: CardDraftInput): LostSaves => ({ ...lost, inputs: [...lost.inputs, input].slice(-LOST_MAX) });

const same = (a: string | null | undefined, b: string | undefined) => (a ?? "") === (b ?? "");

/**
 * 후보 — 지금 직원(me, 소문자)이 since 이후에 만든 명함 중 응답을 잃은 저장 하나와 네 칸 · 사진 유무가 같은 것.
 * 함께 맞은 저장(inputs)을 돌려줘요 — 사진이 있으면 그 사진과도 견줘요(resolveLostDraft).
 */
export function lostCandidates(items: readonly CardDraft[], lost: LostSaves, me: string): { draft: CardDraft; inputs: CardDraftInput[] }[] {
  if (!me || lost.inputs.length === 0) return [];
  return items.flatMap((d) => {
    if (d.createdBy.trim().toLowerCase() !== me) return [];
    const created = Date.parse(d.createdAt);
    if (!Number.isFinite(created) || created < lost.since) return [];
    const inputs = lost.inputs.filter(
      (i) => same(d.company, i.company) && same(d.name, i.name) && same(d.email, i.email) && same(d.phone, i.phone) && d.hasPhoto === !!i.photo,
    );
    return inputs.length > 0 ? [{ draft: d, inputs }] : [];
  });
}

/** found = 하나로 정해짐 / none = 없음 / ambiguous = 둘 이상이라 고르지 않음 / error = 목록 · 사진을 받지 못함(없다는 뜻이 아니에요) */
export type LostLookup = { kind: "found"; id: string } | { kind: "none" } | { kind: "ambiguous" } | { kind: "error" };

/**
 * 응답을 잃은 새 명함 저장이 서버에 남았는지 찾아요(반박 리뷰 F2) — 같은 직원의 다른 명함을 덮어쓰거나 계정 만들기에 붙여 지우지 않게:
 * 이 창을 연 뒤 생긴 내 명함 · 네 칸과 사진 유무가 같고, 사진이 있으면 사진도 같은 것. 딱 하나일 때만 그 명함이에요.
 * photoOf = 명함 사진(없어졌으면 null, 받지 못하면 예외)
 */
export async function resolveLostDraft(args: {
  lost: LostSaves;
  me: string;
  list: () => Promise<readonly CardDraft[]>;
  photoOf: (id: string) => Promise<string | null>;
}): Promise<LostLookup> {
  const { lost, me } = args;
  if (!me || lost.inputs.length === 0) return { kind: "none" };
  let items: readonly CardDraft[];
  try {
    items = await args.list();
  } catch {
    return { kind: "error" };
  }
  const hits: string[] = [];
  for (const c of lostCandidates(items, lost, me)) {
    if (!c.draft.hasPhoto) {
      hits.push(c.draft.id);
      continue;
    }
    let photo: string | null;
    try {
      photo = await args.photoOf(c.draft.id);
    } catch {
      return { kind: "error" };
    }
    const tag = photoTag(photo);
    if (tag && c.inputs.some((i) => photoTag(i.photo) === tag)) hits.push(c.draft.id);
  }
  if (hits.length === 0) return { kind: "none" };
  if (hits.length > 1) return { kind: "ambiguous" };
  return { kind: "found", id: hits[0] };
}

/** 창이 기억하는 「작성 중」 명함 — id = 서버 명함 번호, serverPhoto = 그 명함의 사진(data URL), ended = 계정을 만들었거나 다 씀 */
export type DraftMemory = { id: string | null; serverPhoto: string | null; ended: boolean };

/**
 * 자동 저장 결과를 기억에 반영해요(반박 리뷰 F1 — 번호를 먼저 챙겨요). sent = 실제로 서버에 보낸 값.
 * 성공했는데 그사이 명함이 끝났으면(계정을 만듦 · 다 씀) 방금 남긴 명함은 지울 것(orphan)으로 돌려줘요 — 되살아난 「작성 중」이 남지 않게.
 */
export function recordSave(
  mem: DraftMemory,
  sent: CardDraftInput,
  res: CardDraftSaveResult,
): { result: AutosaveResult; orphan: string | null } {
  if (res.ok) {
    if (mem.ended) return { result: "stop", orphan: res.draft.id };
    mem.id = res.draft.id;
    if (sent.photo) mem.serverPhoto = photoFromDraft(sent.photo);
    else if (!sent.keepPhoto) mem.serverPhoto = null;
    return { result: "saved", orphan: null };
  }
  if (mem.ended || res.reason === "not_found" || res.reason === "session") return { result: "stop", orphan: null };
  return { result: "failed", orphan: null };
}

/**
 * 닫을 때 저장의 PJ-101(칸 값을 받지 않음) 대체 — 네 칸 없이 메일 언어 · 칩 · 사진만. 남길 것이 없으면 null.
 * 자동 저장도 같은 대체를 써요(반박 리뷰 F7).
 */
export function withoutFields(input: CardDraftInput): CardDraftInput | null {
  const { language, chips, photo, keepPhoto } = input;
  if (!photo && !keepPhoto && !chips) return null;
  return {
    ...(language ? { language } : {}),
    ...(chips ? { chips } : {}),
    ...(photo ? { photo } : keepPhoto ? { keepPhoto } : {}),
  };
}

/**
 * 새 명함으로 다시 남길 값(F5 — 이 창이 만든 명함을 다른 직원이 지움). keepPhoto 는 새 명함에 남을 사진이 없으니
 * 서버에 있던 사진(serverPhoto)을 다시 올려요. 그 사진을 모르면 사진 없이.
 */
export function forNewDraft(input: CardDraftInput, serverPhoto: string | null): CardDraftInput {
  if (!input.keepPhoto) return input;
  const rest = withoutPhoto(input);
  const b64 = photoForDraft(serverPhoto);
  return b64 ? { ...rest, photo: b64 } : rest;
}

/** 사진을 받지 않음(너무 큼 · JPEG 아님) — 사진 없이 */
export function withoutPhoto(input: CardDraftInput): CardDraftInput {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 사진만 빼요
  const { photo, keepPhoto, ...rest } = input;
  return rest;
}
