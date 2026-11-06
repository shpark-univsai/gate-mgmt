// 계정 만들기 창의 「작성 중」 규칙(draft-session.ts) 시험 — `npm test`. 반박 리뷰 F1 · F2 · F4 · F5 · F7.
// 예시 값은 모두 지어낸 것이에요(공개 저장소 — 실제 고객 · 회사 · 번호 금지).
import assert from "node:assert/strict";
import { test } from "node:test";

import type { CardDraft, CardDraftInput } from "./api.ts";
import {
  addLost,
  chipEmailsState,
  draftEmailGate,
  draftSaveGate,
  forNewDraft,
  gateAtClose,
  ownDraftToDiscard,
  lostCandidates,
  photoPlan,
  recordSave,
  resolveLostDraft,
  withoutFields,
  withoutPhoto,
  type DraftMemory,
  type LostSaves,
} from "./draft-session.ts";
import { chipEmailAddresses, isSuspectChip, isUnconfirmedSuspect, scanCard } from "./card-scan.ts";

const JPEG = "data:image/jpeg;base64,";
const ME = "sales.kim@example.com";
const T0 = Date.parse("2026-11-06T01:00:00Z");

function draft(id: string, over: Partial<CardDraft> = {}): CardDraft {
  return {
    id,
    company: "company-a",
    name: null,
    email: null,
    phone: null,
    language: null,
    hasPhoto: false,
    capturedAt: "",
    expiresAt: "",
    createdBy: ME,
    createdAt: new Date(T0 + 5_000).toISOString(),
    updatedBy: ME,
    updatedAt: "",
    ...over,
  };
}
const lost = (...inputs: CardDraftInput[]): LostSaves => ({ since: T0, inputs });

test("F4 사진: 서버 사진과 같을 때만 keepPhoto, 다시 찍기 시작 · 새 사진을 만들지 못하면 사진 없이", () => {
  const a = `${JPEG}QUFB`;
  const b = `${JPEG}QkJC`;
  assert.deepEqual(photoPlan(a, a, false), { keepPhoto: true });
  assert.deepEqual(photoPlan(b, a, false), { photo: "QkJC" });
  // R1 다시 찍어 읽는 중(화면 사진은 비워져요) — 결과가 나오기 전에는 서버 사진을 그대로(지우지 않아요)
  assert.deepEqual(photoPlan(null, a, true), { keepPhoto: true });
  assert.deepEqual(photoPlan(null, null, true), {}, "서버 사진이 없으면 읽는 중에도 사진 없이");
  // 다시 찍기가 끝났는데 새 명함(B)이 미리 보기를 만들지 못함(HEIC 등) — A 의 사진을 keepPhoto 로 남기지 않아요
  assert.deepEqual(photoPlan(null, a, false), {});
  // JPEG 가 아닌 사진은 보내지 않아요(서버가 받지 않아요)
  assert.deepEqual(photoPlan("data:image/png;base64,QUFB", null, false), {});
  assert.deepEqual(photoPlan(a, null, true), {}, "읽는 중에는 새 사진을 보내지 않아요");
});

test("F2 후보: 이 창을 연 뒤 내가 만든 명함 · 네 칸 · 사진 유무가 같은 것만", () => {
  const input = { company: "company-a" };
  const items = [
    draft("1"), // 맞음
    draft("2", { createdBy: "other@example.com" }), // 다른 직원
    draft("3", { createdAt: new Date(T0 - 1).toISOString() }), // 창을 열기 전
    draft("4", { name: "Hong" }), // 칸이 다름
    draft("5", { hasPhoto: true }), // 사진 유무가 다름
    draft("6", { createdBy: " Sales.Kim@Example.com " }), // 대소문자 · 공백은 같게
  ];
  assert.deepEqual(
    lostCandidates(items, lost(input), ME).map((c) => c.draft.id),
    ["1", "6"],
  );
  assert.deepEqual(lostCandidates(items, lost(), ME), [], "잃은 저장이 없으면 후보 없음");
  assert.deepEqual(lostCandidates(items, lost(input), ""), [], "직원을 모르면 후보 없음");
});

test("F2 하나로 정해질 때만 이어 써요 — 둘 이상이면 고르지 않아요", async () => {
  const photoOf = async () => null;
  const one = await resolveLostDraft({ lost: lost({ company: "company-a" }), me: ME, list: async () => [draft("1")], photoOf });
  assert.deepEqual(one, { kind: "found", id: "1" });
  const two = await resolveLostDraft({ lost: lost({ company: "company-a" }), me: ME, list: async () => [draft("1"), draft("2")], photoOf });
  assert.deepEqual(two, { kind: "ambiguous" });
  const none = await resolveLostDraft({ lost: lost({ company: "company-b" }), me: ME, list: async () => [draft("1")], photoOf });
  assert.deepEqual(none, { kind: "none" });
});

test("F2 목록 · 사진을 받지 못하면 error(없다는 뜻이 아니에요)", async () => {
  const listFails = await resolveLostDraft({
    lost: lost({ company: "company-a" }),
    me: ME,
    list: async () => {
      throw new Error("offline");
    },
    photoOf: async () => null,
  });
  assert.deepEqual(listFails, { kind: "error" });
  const photoFails = await resolveLostDraft({
    lost: lost({ company: "company-a", photo: "QUFB" }),
    me: ME,
    list: async () => [draft("1", { hasPhoto: true })],
    photoOf: async () => {
      throw new Error("offline");
    },
  });
  assert.deepEqual(photoFails, { kind: "error" });
});

test("F2 사진이 있으면 사진까지 같아야 해요(같은 칸의 다른 명함 사진은 아님)", async () => {
  const items = [draft("1", { hasPhoto: true }), draft("2", { hasPhoto: true })];
  const photos: Record<string, string> = { "1": "QUFB", "2": "QkJC" };
  const r = await resolveLostDraft({
    lost: lost({ company: "company-a", photo: "QkJC" }),
    me: ME,
    list: async () => items,
    photoOf: async (id) => photos[id],
  });
  assert.deepEqual(r, { kind: "found", id: "2" });
  const gone = await resolveLostDraft({ lost: lost({ company: "company-a", photo: "QkJC" }), me: ME, list: async () => items, photoOf: async () => null });
  assert.deepEqual(gone, { kind: "none" });
});

test("F1 번호부터 챙겨요 — 성공하면 번호 · 서버 사진을 기억하고, 그사이 명함이 끝났으면 방금 남긴 명함은 지울 것", () => {
  const mem: DraftMemory = { id: null, serverPhoto: null, ended: false };
  const ok = (id: string) => ({ ok: true as const, draft: draft(id) });
  assert.deepEqual(recordSave(mem, { company: "company-a", photo: "QUFB" }, ok("7")), { result: "saved", orphan: null });
  assert.equal(mem.id, "7");
  assert.equal(mem.serverPhoto, `${JPEG}QUFB`);
  recordSave(mem, { company: "company-a", keepPhoto: true }, ok("7"));
  assert.equal(mem.serverPhoto, `${JPEG}QUFB`, "keepPhoto 면 사진 그대로");
  recordSave(mem, { company: "company-a" }, ok("7"));
  assert.equal(mem.serverPhoto, null, "사진 없이 남기면 서버 사진도 없어요");
  // 계정을 만들었거나 다 쓴 뒤 끝난 저장 — 되살아난 명함은 지울 것으로
  const ended: DraftMemory = { id: null, serverPhoto: null, ended: true };
  assert.deepEqual(recordSave(ended, { company: "company-a" }, ok("8")), { result: "stop", orphan: "8" });
  assert.equal(ended.id, null);
});

test("F1 · F7 실패: 명함 없어짐 · 로그인 끊김 · 끝난 뒤면 끄고, 그 밖은 다음 변경 때 다시", () => {
  const mem: DraftMemory = { id: "7", serverPhoto: null, ended: false };
  assert.equal(recordSave(mem, {}, { ok: false, reason: "not_found" }).result, "stop");
  assert.equal(recordSave(mem, {}, { ok: false, reason: "session" }).result, "stop");
  assert.equal(recordSave(mem, {}, { ok: false, reason: "failed" }).result, "failed");
  assert.equal(recordSave(mem, {}, { ok: false, reason: "photo" }).result, "failed");
  assert.equal(recordSave({ ...mem, ended: true }, {}, { ok: false, reason: "failed" }).result, "stop");
  assert.equal(mem.id, "7", "실패는 번호를 바꾸지 않아요");
});

test("F7 대체: 칸을 받지 않으면 메일 언어 · 칩 · 사진만, 사진을 받지 않으면 사진만 빼요", () => {
  const chips = { v: 1, chips: [], links: {} };
  assert.deepEqual(withoutFields({ company: "x", language: "ko", chips, photo: "QUFB" }), { language: "ko", chips, photo: "QUFB" });
  assert.deepEqual(withoutFields({ company: "x", keepPhoto: true }), { keepPhoto: true });
  assert.equal(withoutFields({ company: "x", language: "en" }), null, "남길 것이 없으면 null");
  assert.deepEqual(withoutPhoto({ company: "x", photo: "QUFB" }), { company: "x" });
  assert.deepEqual(withoutPhoto({ company: "x", keepPhoto: true }), { company: "x" });
});

test("F5 새 명함으로 다시 남길 값 — keepPhoto 는 서버에 있던 사진을 다시 올려요", () => {
  assert.deepEqual(forNewDraft({ company: "x", keepPhoto: true }, `${JPEG}QUFB`), { company: "x", photo: "QUFB" });
  assert.deepEqual(forNewDraft({ company: "x", keepPhoto: true }, null), { company: "x" });
  assert.deepEqual(forNewDraft({ company: "x", photo: "QkJC" }, `${JPEG}QUFB`), { company: "x", photo: "QkJC" });
});

test("응답 잃은 저장은 가장 최근 5개만 기억해요", () => {
  let l: LostSaves = { since: T0, inputs: [] };
  for (let i = 0; i < 7; i++) l = addLost(l, { company: `c${i}` });
  assert.deepEqual(
    l.inputs.map((i) => i.company),
    ["c2", "c3", "c4", "c5", "c6"],
  );
  assert.equal(l.since, T0);
});

test("UG-451 17022 · 이메일 확인이 「새 계정」으로 끝나기 전에는 자동 저장하지 않아요", () => {
  // 이메일이 없거나 조회할 수 없는 모양이면 이메일 걱정이 없어요 — 남겨요
  assert.equal(draftEmailGate("", false, null), "open");
  assert.equal(draftEmailGate("tan@bluepeak.com · sg", false, null), "open");
  // 조회 전 · 조회 중 · 조회 실패(결과 없음) — 기다려요(명함 읽기가 채운 이메일도)
  assert.equal(draftEmailGate("kim@example.com", true, null), "wait");
  // 새 계정이면 남겨요
  assert.equal(draftEmailGate("kim@example.com", true, "new"), "open");
  // 이미 있는 계정 — 사용 중 · 해지 중 · 첫 로그인 전
  for (const s of ["in_use", "closing", "pending"] as const) assert.equal(draftEmailGate("kim@example.com", true, s), "existing", s);
});

test("UG-451 17022 · 닫을 때 다시 확인해도 모르면 전처럼 남겨요", () => {
  assert.equal(gateAtClose("open"), "open");
  assert.equal(gateAtClose("existing"), "existing");
  assert.equal(gateAtClose("wait"), "open");
});

test("UG-451 17022 리뷰 F3 · 명함 칩의 메일 주소 확인 결과", () => {
  assert.equal(chipEmailsState([], {}), "clear");
  assert.equal(chipEmailsState(["a@example.com"], {}), "unknown");
  assert.equal(chipEmailsState(["a@example.com"], { "a@example.com": "new" }), "clear");
  assert.equal(chipEmailsState(["a@example.com", "b@example.com"], { "a@example.com": "new" }), "unknown");
  for (const s of ["in_use", "closing", "pending"] as const) {
    assert.equal(chipEmailsState(["a@example.com", "b@example.com"], { "b@example.com": s }), "existing", s);
  }
  // 대소문자는 다른 주소예요(UG-421)
  assert.equal(chipEmailsState(["A@example.com"], { "a@example.com": "new" }), "unknown");
});

test("UG-451 17022 리뷰 F3 · 칸 이메일 + 명함 칩 이메일로 「작성 중」 저장 여부", () => {
  const OCR = "user2@example.com";
  const gate = (email: string, fieldStatus: "new" | "in_use" | null, known: Record<string, "new" | "in_use" | "pending" | "closing">, chipEmails = [OCR]) =>
    draftSaveGate({ email, checkable: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), fieldStatus, chipEmails, known });
  // 명함이 채운 주소가 이미 있는 계정 — 칸에 있으면 existing, 칸을 지워도 existing(사진 · 칩에 그 주소가 남아요)
  assert.equal(gate(OCR, "in_use", { [OCR]: "in_use" }), "existing");
  assert.equal(gate("", null, { [OCR]: "in_use" }), "existing");
  assert.equal(gate("tan@x.com | sg", null, { [OCR]: "in_use" }), "existing");
  // 칸에 다른 주소를 넣어 「새 계정」으로 확인되면 다시 남겨요 — 확인 전이면 기다려요
  assert.equal(gate("new.user@example.com", "new", { [OCR]: "in_use" }), "open");
  assert.equal(gate("new.user@example.com", null, { [OCR]: "in_use" }), "wait");
  // 칩 주소를 아직 확인하지 못함(명함을 읽은 바로 뒤 · 확인 실패) — 칸이 비어도 바로 남기지 않아요
  assert.equal(gate("", null, {}), "wait");
  // 칩 주소가 모두 새 주소면 칸이 비어도 남겨요
  assert.equal(gate("", null, { [OCR]: "new" }), "open");
  // 칸 주소의 결과는 칩 주소를 확인한 결과(known)에서도 찾아요
  assert.equal(gate(OCR, null, { [OCR]: "new" }), "open");
  assert.equal(gate(OCR, null, { [OCR]: "in_use" }), "existing");
  // 명함 없음 — 칸만 봐요(전과 같아요)
  assert.equal(gate("", null, {}, []), "open");
  assert.equal(gate("kim@example.com", null, {}, []), "wait");
  assert.equal(gate("kim@example.com", "new", {}, []), "open");
  assert.equal(gate("kim@example.com", "in_use", {}, []), "existing");
});

test("UG-451 17022 · 이미 있는 계정이면 이 창의 자동 저장이 만든 명함만 지워요(이어서 만든 원래 명함은 그대로)", () => {
  const own = new Set(["41"]);
  assert.equal(ownDraftToDiscard("41", own), "41");
  assert.equal(ownDraftToDiscard("7", own), null); // 이어서 만들기로 연 명함
  assert.equal(ownDraftToDiscard(null, own), null);
});

test("UG-451 최종 리뷰 R2 · 잘렸을 수 있는 메일 칩이 있으면 잘린 꼬리 주소로 정하지 않고 칸 주소가 「새 계정」일 때까지 기다려요", () => {
  const TAIL = "jung@x.co.kr"; // 「daeun · jung@x.co.kr」에서 뽑은 잘린 주소
  const gate = (email: string, fieldStatus: "new" | null, known: Record<string, "new" | "in_use">, fieldSuspect = false) =>
    draftSaveGate({ email, checkable: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), fieldStatus, chipEmails: [TAIL], known, suspectChips: true, fieldSuspect });
  // 꼬리 주소가 「새 계정」이어도 칸이 비었거나 의심 값이면 기다려요
  assert.equal(gate("", null, { [TAIL]: "new" }), "wait");
  assert.equal(gate("daeun · jung@x.co.kr", null, { [TAIL]: "new" }), "wait");
  assert.equal(gate(TAIL, "new", { [TAIL]: "new" }, true), "wait");
  // 칸에 고친 주소가 「새 계정」으로 확인되면 남겨요 — 확인 전이면 기다려요
  assert.equal(gate("daeun.jung@x.co.kr", "new", { [TAIL]: "new" }), "open");
  assert.equal(gate("daeun.jung@x.co.kr", null, { [TAIL]: "new" }), "wait");
  // 꼬리 주소가 있는 계정이면 전처럼 existing(이 창의 자동 저장 명함을 지워요)
  assert.equal(gate("", null, { [TAIL]: "in_use" }), "existing");
  // 닫을 때는 기다림을 전처럼 남김으로
  assert.equal(gateAtClose(gate("", null, { [TAIL]: "new" })), "open");
});

test("UG-451 17030 · 「명함과 같은 주소예요」로 확인한 의심 값은 의심이 아닌 주소처럼 「새 계정」이면 남겨요", () => {
  const { chips } = scanCard("Sales · kim@acme.com");
  // 이 창에서 따로 확인한 주소는 없어요 — 칸 주소의 확인 결과(fieldStatus)만으로 정해지게
  const known: Record<string, "new" | "in_use"> = {};
  const gate = (email: string, fieldStatus: "new" | "in_use" | null, confirmed: string | null) =>
    draftSaveGate({
      email,
      checkable: true,
      fieldStatus,
      chipEmails: chipEmailAddresses(chips),
      known,
      suspectChips: chips.some(isSuspectChip),
      fieldSuspect: isUnconfirmedSuspect(email, chips, confirmed),
    });
  // 확인 전: 「새 계정」이어도 기다려요
  assert.equal(gate("kim@acme.com", "new", null), "wait");
  // 확인 후: 「새 계정」으로 확인되면 남겨요(대소문자 · 앞뒤 공백 없이 같은 값), 확인 전이면 기다려요
  assert.equal(gate("kim@acme.com", "new", "kim@acme.com"), "open");
  assert.equal(gate("Kim@acme.com", "new", "kim@ACME.com "), "open");
  assert.equal(gate("kim@acme.com", null, "kim@acme.com"), "wait");
  // 이미 있는 계정이면 전처럼 existing(남기지 않고 이 창의 자동 저장 명함은 지워요)
  assert.equal(gate("kim@acme.com", "in_use", "kim@acme.com"), "existing");
  // 다른 값을 확인했으면(칸이 바뀜) 확인이 아니에요
  assert.equal(gate("kim@acme.com", "new", "lee@acme.com"), "wait");
  assert.equal(isUnconfirmedSuspect("kim@acme.com", chips, "lee@acme.com"), true);
  assert.equal(isUnconfirmedSuspect("lee@acme.com", chips, null), false);
});
