// 계정 만들기 창 한 번(열고 닫을 때까지)의 「작성 중」 명함 규칙(UG-451 기획 17009 · 반박 리뷰). 화면에 기대지 않는 순수 함수만 둬요.
// - 사진을 어떻게 보낼지(photoPlan)
// - 응답을 잃은 새 명함 저장을 서버 목록에서 찾기(resolveLostDraft) — 다른 명함을 잘못 잇지 않게 엄격하게
// - 저장 결과를 창의 기억(번호 · 서버 사진)에 반영하는 차례(recordSave)
// - 이메일 확인 결과로 남겨도 되는지(draftEmailGate · draftSaveGate · gateAtClose · ownDraftToDiscard — 이미 있는 계정의 이메일은 남기지 않아요, 기획 17022)
import type { CardDraft, CardDraftInput, CardDraftSaveResult, EmailCheck } from "./api";
// 값 import 는 .ts 까지 적어요 — `npm test`(Node 가 타입만 지우고 바로 실행)가 확장자 없는 경로를 찾지 못해요
import { photoForDraft, photoFromDraft } from "./card-draft.ts";
import { photoTag, type AutosaveResult } from "./draft-autosave.ts";

/**
 * 「작성 중」으로 보낼 사진. 서버는 photo · keepPhoto 가 둘 다 없으면 사진을 지워요(PUT 은 통째 바꾸기).
 * - 다시 찍어 읽는 중(scanning): 서버 사진을 그대로(keepPhoto) — 결과가 나오기 전에 지우지 않아요(재검토 R1).
 * - 화면 사진이 서버 사진과 같으면 keepPhoto(다시 올리지 않음), 새로 찍은 사진이면 그 사진(JPEG 만).
 * - 다시 찍기가 끝났는데 새 사진을 만들지 못함(HEIC 등 — 화면 사진이 비었음) · JPEG 가 아님: 사진 없이 —
 *   앞 명함(A)의 사진이 새 명함(B)의 칸과 함께 남지 않게(반박 리뷰 F4).
 */
export function photoPlan(photo: string | null, serverPhoto: string | null, scanning: boolean): { photo?: string; keepPhoto?: true } {
  if (scanning) return serverPhoto ? { keepPhoto: true } : {};
  if (!photo) return {};
  if (photo === serverPhoto) return { keepPhoto: true };
  const b64 = photoForDraft(photo);
  return b64 ? { photo: b64 } : {};
}

/**
 * 응답을 잃은 새 명함 저장들 — since 이후에 생긴 명함만 후보(이 창을 연 시각 − 시계 오차).
 * 받아들인 한계(재검토 R3): 하나로 정해지지 않거나(둘 이상) 끝내 찾지 못한 저장은 서버에 「작성 중」 하나로 남을 수 있어요(30일 뒤 서버가 지움).
 */
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

/**
 * 이메일 칸 값으로 본 「작성 중」 저장 가능 여부(UG-451 기획 17022 — 이미 있는 계정의 이메일은 「작성 중」으로 남기지 않아요).
 * - open = 남겨도 돼요: 이메일이 없거나 · 조회할 수 없는 모양(형식 오류 — 잘렸을 수 있는 메일 칩을 넣은 「tan@x.com · sg」 등)이거나 · 조회가 「새 계정」
 * - wait = 아직 몰라요: 조회 전 · 조회 중 · 조회 실패(연결 문제 등) — 자동 저장은 하지 않고 다음 변경 때 다시 조회해요
 * - existing = 이미 있는 계정(사용 중 · 해지 중 · 첫 로그인 전 발급 기록) — 자동 저장도 닫을 때 저장도 하지 않아요
 * email = 앞뒤 공백 뗀 칸 값, checkable = 조회할 수 있는 모양인지(화면의 EMAIL_RE), checked = 이 이메일(그대로 같은 글자)의 조회 결과 상태
 */
export type DraftEmailGate = "open" | "wait" | "existing";

export function draftEmailGate(email: string, checkable: boolean, checked: EmailCheck["status"] | null): DraftEmailGate {
  if (!email || !checkable) return "open";
  if (checked === null) return "wait";
  return checked === "new" ? "open" : "existing";
}

type CheckStatus = EmailCheck["status"];

/** 명함 칩의 메일 주소들을 확인한 결과 — clear = 모두 새 주소, unknown = 아직 확인하지 못한 주소가 있음, existing = 이미 있는 계정의 주소가 있음 */
export type ChipEmailsState = "clear" | "unknown" | "existing";

/** known = 이 창에서 확인한 이메일(적힌 그대로) → 결과 */
export function chipEmailsState(emails: readonly string[], known: Readonly<Record<string, CheckStatus>>): ChipEmailsState {
  let unknown = false;
  for (const e of emails) {
    const s = known[e];
    if (s === undefined) unknown = true;
    else if (s !== "new") return "existing";
  }
  return unknown ? "unknown" : "clear";
}

/**
 * 「작성 중」으로 남겨도 되는지 — 이메일 칸과 명함 칩의 메일 주소를 함께 봐요(UG-451 기획 17022 · 반박 리뷰 F3 · F4).
 * 1. 이메일 칸(draftEmailGate): 확인 전 · 실패면 wait, 이미 있는 계정이면 existing
 * 2. 칸 이메일이 「새 계정」으로 확인됐으면 open — 명함에 다른 주소가 있어도 직원이 고른 주소예요
 * 3. 칸이 비었거나 형식이 아니면 명함 칩의 메일 주소로: 하나라도 이미 있는 계정이면 existing(이 명함은 있는 고객 것 — 칸을 지워도
 *    사진 · 칩에 그 주소가 남아요), 아직 확인 못 한 주소가 있으면 wait, 모두 새 주소면 open
 *    (2 의 칸 이메일이 의심 칩 값 · 잘린 꼬리 주소면(fieldSuspect) 「새 계정」이어도 3 으로 가요)
 * fieldStatus = 칸 이메일의 확인 결과(없으면 known 에서 찾아요), chipEmails = 명함 칩의 메일 주소(chipEmailAddresses)
 */
export function draftSaveGate(args: {
  email: string;
  checkable: boolean;
  fieldStatus: CheckStatus | null;
  chipEmails: readonly string[];
  known: Readonly<Record<string, CheckStatus>>;
  /** 명함에 잘렸을 수 있는 메일 칩이 있는지(isSuspectChip) */
  suspectChips?: boolean;
  /** 칸 값이 의심 칩 값 · 그 칩에서 뽑은 잘린 주소와 같은지(isSuspectValue) */
  fieldSuspect?: boolean;
}): DraftEmailGate {
  const fieldStatus = args.fieldStatus ?? args.known[args.email] ?? null;
  const field = draftEmailGate(args.email, args.checkable, fieldStatus);
  if (field !== "open") return field;
  const fieldNew = !!args.email && args.checkable && !args.fieldSuspect && fieldStatus === "new";
  if (fieldNew) return "open";
  const chips = chipEmailsState(args.chipEmails, args.known);
  if (chips === "existing") return "existing";
  // 4. 잘렸을 수 있는 메일 칩이 있으면 잘린 꼬리 주소의 확인 결과로 정하지 않아요(최종 리뷰 R2) —
  //    칸에 의심이 아닌 주소가 「새 계정」으로 확인될 때까지 기다려요(닫을 때는 gateAtClose 가 전처럼 남겨요)
  if (args.suspectChips) return "wait";
  return chips === "unknown" ? "wait" : "open";
}

/**
 * 닫을 때 — 기다리던 확인을 한 번 더 해 다시 정한 뒤에도 모르면(확인 실패) 전처럼 남겨요 —
 * 직원이 찍고 친 값이 사라지는 쪽이 더 나빠서예요(연결이 끊겼으면 남기기도 실패해 [다시 시도] [그래도 닫기]가 떠요).
 */
export function gateAtClose(gate: DraftEmailGate): "open" | "existing" {
  return gate === "existing" ? "existing" : "open";
}

/**
 * 이미 있는 계정의 이메일이라 닫을 때 지울 명함 — 이 창의 자동 저장이 새로 만든 명함(own)만이에요.
 * 이어서 만들기로 연 원래 명함은 그대로 둬요(직원이 목록에서 정해요).
 */
export function ownDraftToDiscard(id: string | null, own: ReadonlySet<string>): string | null {
  return id !== null && own.has(id) ? id : null;
}
