// 「명함 다시 찍기」에서 직원이 넣은 값을 어떻게 할지(UG-451 기획 17118-1) — card-retake.ts. 예시 값은 모두 지어낸 것이에요(공개 저장소).
import assert from "node:assert/strict";
import { test } from "node:test";

import { isOnCard, retakeNote, retakeNoteText, retakePlan, retakeVerdict } from "./card-retake.ts";
import { scanCard, toChips, type ScanField, type ScanValues } from "./card-scan.ts";

const chips = (...lines: string[]) => toChips(lines.join("\n"));
const LABELS: Record<ScanField, string> = { company: "회사명", name: "이름", email: "고객 이메일", phone: "연락처" };

// 지어낸 두 사람의 명함
const CARD_A = ["주식회사 푸른별미디어", "한서윤 과장", "seoyun.han@pureunbyeol-media.co.kr", "010-5555-0142"];
const CARD_B = ["Northgate Analytics Pte. Ltd.", "Marcus Yeo", "marcus.yeo@northgate-analytics.com.sg", "+65 9555 0199"];

test("같은 사람 — 다시 찍은 명함의 이메일이 앞 명함에서 읽은 주소와 같음(대소문자만 달라도)", () => {
  const prev = { read: "seoyun.han@pureunbyeol-media.co.kr", field: "seoyun.han@pureunbyeol-media.co.kr", chips: chips(...CARD_A) };
  assert.equal(retakeVerdict(prev, { email: "seoyun.han@pureunbyeol-media.co.kr", chips: chips(...CARD_A) }), "same");
  assert.equal(retakeVerdict(prev, { email: "Seoyun.Han@Pureunbyeol-Media.CO.KR", chips: chips(...CARD_A) }), "same");
  assert.equal(retakeVerdict({ ...prev, read: "  SEOYUN.HAN@pureunbyeol-media.co.kr " }, { email: "seoyun.han@pureunbyeol-media.co.kr", chips: [] }), "same");
});

test("같은 사람 — 직원이 잘못 읽힌 주소를 손으로 고친 뒤 다시 찍어 제대로 읽힘(칸의 주소와 같음)", () => {
  const prev = { read: "seoyun.han@pureunbyeo1-media.co.kr", field: "seoyun.han@pureunbyeol-media.co.kr", chips: chips(...CARD_A) };
  assert.equal(retakeVerdict(prev, { email: "seoyun.han@pureunbyeol-media.co.kr", chips: chips(...CARD_A) }), "same");
  // 앞 명함에서 주소를 못 읽어 직원이 직접 친 경우(읽은 주소 없음)
  assert.equal(retakeVerdict({ read: "", field: "seoyun.han@pureunbyeol-media.co.kr", chips: [] }, { email: "seoyun.han@pureunbyeol-media.co.kr", chips: [] }), "same");
});

test("다른 사람 — 다시 찍은 명함의 이메일이 앞 명함의 주소(읽은 것 · 칸)와 다름", () => {
  const prev = { read: "seoyun.han@pureunbyeol-media.co.kr", field: "seoyun.han@pureunbyeol-media.co.kr", chips: chips(...CARD_A) };
  assert.equal(retakeVerdict(prev, { email: "marcus.yeo@northgate-analytics.com.sg", chips: chips(...CARD_B) }), "different");
  // 직원이 이메일 칸을 고쳤어도 · 비웠어도 앞 명함에서 읽은 주소로 견줘요
  assert.equal(retakeVerdict({ ...prev, field: "" }, { email: "marcus.yeo@northgate-analytics.com.sg", chips: [] }), "different");
  assert.equal(retakeVerdict({ ...prev, field: "seoyun@personal.example" }, { email: "marcus.yeo@northgate-analytics.com.sg", chips: [] }), "different");
  // 같은 회사 동료(한 글자만 다른 주소)도 다른 사람이에요
  assert.equal(retakeVerdict(prev, { email: "seoyun.kan@pureunbyeol-media.co.kr", chips: [] }), "different");
  // 「이어서 만들기」로 연 명함 — 읽은 주소를 몰라 칸의 주소로 견줘요
  assert.equal(retakeVerdict({ read: "", field: "seoyun.han@pureunbyeol-media.co.kr", chips: [] }, { email: "marcus.yeo@northgate-analytics.com.sg", chips: [] }), "different");
});

test("잘렸을 수 있는 주소 — 읽은 그대로의 글자(로마자 · 숫자 · @)로 견줘요", () => {
  const clean = "seoyun.han@pureunbyeol-media.co.kr";
  // 다시 찍은 명함의 주소가 잘려 읽힘(칸은 비워요) — 앞 덩어리 · 꼬리까지 이으면 같은 주소
  const headCut = chips("주식회사 푸른별미디어", "seoyun · han@pureunbyeol-media.co.kr");
  assert.equal(scanCard("seoyun · han@pureunbyeol-media.co.kr").values.email, "");
  assert.equal(retakeVerdict({ read: clean, field: clean, chips: [] }, { email: "", chips: headCut }), "same");
  const tailCut = chips("marcus.yeo@northgate-analytics.com · sg");
  assert.equal(retakeVerdict({ read: "marcus.yeo@northgate-analytics.com.sg", field: "", chips: [] }, { email: "", chips: tailCut }), "same");
  // 앞 명함이 잘려 읽혔고(칸 빔 · 읽은 주소 없음) 다시 찍어 제대로 읽힘
  assert.equal(retakeVerdict({ read: "", field: "", chips: headCut }, { email: clean, chips: [] }), "same");
  // 두 번 다 같은 모양으로 잘려 읽힘
  assert.equal(retakeVerdict({ read: "", field: "", chips: headCut }, { email: "", chips: headCut }), "same");
  // 잘린 주소가 다른 사람 것 — 성씨가 같은 동료의 꼬리 주소(han@…)만으로는 같은 사람으로 보지 않아요
  const colleague = chips("minjae · han@pureunbyeol-media.co.kr");
  assert.equal(retakeVerdict({ read: clean, field: clean, chips: [] }, { email: "", chips: colleague }), "different");
  assert.equal(retakeVerdict({ read: "", field: "", chips: headCut }, { email: "", chips: colleague }), "different");
  assert.equal(retakeVerdict({ read: clean, field: clean, chips: [] }, { email: "", chips: tailCut }), "different");
  // 형식이 깨져 메일 칩이 되지 못한 줄(「marcus@northgate sg」)도 메일 모양 글자로 견줘요
  const broken = chips("Northgate Analytics", "marcus@northgate sg");
  assert.equal(retakeVerdict({ read: "marcus@northgate.sg", field: "", chips: [] }, { email: "", chips: broken }), "same");
  assert.equal(retakeVerdict({ read: clean, field: "", chips: [] }, { email: "", chips: broken }), "different");
});

test("알 수 없음 — 한쪽에 견줄 메일 모양 글자가 없음", () => {
  const clean = "seoyun.han@pureunbyeol-media.co.kr";
  // 다시 찍은 명함을 못 읽음 · 메일이 없는 명함
  assert.equal(retakeVerdict({ read: clean, field: clean, chips: chips(...CARD_A) }, { email: "", chips: [] }), "unknown");
  assert.equal(retakeVerdict({ read: clean, field: clean, chips: [] }, { email: "", chips: chips("주식회사 푸른별미디어", "한서윤 과장", "010-5555-0142") }), "unknown");
  // 앞 명함의 주소를 모름(못 읽음 · 칸 빔 · 칸에 주소 아닌 글자)
  assert.equal(retakeVerdict({ read: "", field: "", chips: [] }, { email: clean, chips: [] }), "unknown");
  assert.equal(retakeVerdict({ read: "", field: "seoyun.han", chips: chips("한서윤 과장") }, { email: clean, chips: [] }), "unknown");
  assert.equal(retakeVerdict({ read: "", field: "", chips: [] }, { email: "", chips: [] }), "unknown");
});

test("새 명함에 그대로 적힌 값인지 — 회사명 · 이름은 읽은 줄 안에, 이메일 · 연락처는 칩 값으로", () => {
  const card = chips(...CARD_A, "T. 02-555-0113");
  assert.equal(isOnCard("name", "한서윤", card), true);
  assert.equal(isOnCard("name", "한 서 윤", card), true);
  assert.equal(isOnCard("name", "서윤", card), true);
  assert.equal(isOnCard("name", "한서연", card), false);
  assert.equal(isOnCard("name", "한", card), false); // 한 글자는 보지 않아요
  assert.equal(isOnCard("company", "푸른별미디어", card), true);
  assert.equal(isOnCard("company", "주식회사 푸른별 미디어", card), true);
  assert.equal(isOnCard("company", "Northgate Analytics", card), false);
  assert.equal(isOnCard("company", "northgate analytics", chips(...CARD_B)), true);
  assert.equal(isOnCard("email", "SEOYUN.HAN@pureunbyeol-media.co.kr", card), true);
  assert.equal(isOnCard("email", "han@pureunbyeol-media.co.kr", card), false);
  assert.equal(isOnCard("email", "seoyun.han", card), false);
  assert.equal(isOnCard("phone", "010 5555 0142", card), true);
  assert.equal(isOnCard("phone", "02-555-0113", card), true);
  assert.equal(isOnCard("phone", "010-5555-0143", card), false);
  assert.equal(isOnCard("phone", "5555", card), false); // 짧은 숫자는 보지 않아요
  assert.equal(isOnCard("name", "한서윤", []), false);
});

test("할 일 — 같은 사람이면 그대로, 다른 사람이면 새 명함에 없는 값은 비우고, 알 수 없으면 그대로 두고 알려요", () => {
  const staff: Partial<ScanValues> = { company: "푸른별미디어", name: "한서윤", email: "seoyun@personal.example", phone: "010-5555-0142" };
  assert.deepEqual(retakePlan("same", staff, chips(...CARD_B)), { verdict: "same", release: [], stale: [] });
  // 기획 17118-1 — 다른 사람 명함: 앞 사람의 회사명 · 이름 · 이메일 · 연락처가 어느 칸에도 남지 않아요
  assert.deepEqual(retakePlan("different", staff, chips(...CARD_B)), { verdict: "different", release: ["company", "name", "email", "phone"], stale: [] });
  // 다른 사람이라도 새 명함에 그대로 적힌 값은 남겨요 — 같은 회사 동료의 회사명, 같은 명함인데 주소가 다르게 읽힌 경우의 이름
  const colleague = chips("주식회사 푸른별미디어", "문지후 대리", "jihu.moon@pureunbyeol-media.co.kr", "010-5555-0177");
  assert.deepEqual(retakePlan("different", staff, colleague).release, ["name", "email", "phone"]);
  const misread = chips("주식회사 푸른별미디어", "한서윤 과장", "seoyun.han@pureunbyeo1-media.co.kr", "010-5555-0142");
  assert.deepEqual(retakePlan("different", { company: "푸른별미디어", name: "한서윤" }, misread).release, []);
  // 알 수 없음 — 지우지 않고, 새 명함에서 찾지 못한 값만 알려요. 못 읽은 명함이면 모든 값
  assert.deepEqual(retakePlan("unknown", staff, chips("주식회사 푸른별미디어", "한서윤 과장")), { verdict: "unknown", release: [], stale: ["email", "phone"] });
  assert.deepEqual(retakePlan("unknown", staff, []), { verdict: "unknown", release: [], stale: ["company", "name", "email", "phone"] });
  // 직원이 넣은 값이 없으면(빈 칸 · 공백) 할 일도 없어요
  assert.deepEqual(retakePlan("different", {}, chips(...CARD_B)), { verdict: "different", release: [], stale: [] });
  assert.deepEqual(retakePlan("unknown", { name: "  " }, []), { verdict: "unknown", release: [], stale: [] });
});

test("안내 — 지운 칸 · 남긴 칸의 이름을 알리고, 직원이 그 칸을 고치면 내려가요", () => {
  const after: ScanValues = { company: "Northgate Analytics Pte. Ltd.", name: "", email: "marcus.yeo@northgate-analytics.com.sg", phone: "+65 9555 0199" };
  const released = retakeNote({ verdict: "different", release: ["company", "name"], stale: [] }, after);
  assert.deepEqual(released, { kind: "released", values: { company: "Northgate Analytics Pte. Ltd.", name: "" } });
  assert.equal(
    retakeNoteText(released, after, LABELS),
    "앞 명함과 이메일이 달라 직접 입력한 값(회사명 · 이름)을 지웠습니다. 이 명함에서 읽은 값을 확인해 주세요.",
  );
  // 이름을 직원이 새로 넣으면 이름은 빠지고, 회사명도 고치면 안내가 내려가요
  assert.equal(
    retakeNoteText(released, { ...after, name: "Marcus Yeo" }, LABELS),
    "앞 명함과 이메일이 달라 직접 입력한 값(회사명)을 지웠습니다. 이 명함에서 읽은 값을 확인해 주세요.",
  );
  assert.equal(retakeNoteText(released, { ...after, name: "Marcus Yeo", company: "Northgate" }, LABELS), null);
  const kept: ScanValues = { company: "", name: "한서윤", email: "", phone: "010-5555-0142" };
  const stale = retakeNote({ verdict: "unknown", release: [], stale: ["name", "phone"] }, kept);
  assert.equal(retakeNoteText(stale, kept, LABELS), "직접 입력한 값(이름 · 연락처)은 그대로 두었습니다. 이 명함과 맞는지 확인해 주세요.");
  assert.equal(retakeNoteText(stale, { ...kept, name: "", phone: "" }, LABELS), null);
  // 알릴 칸이 없으면 안내도 없어요
  assert.equal(retakeNote({ verdict: "same", release: [], stale: [] }, after), null);
  assert.equal(retakeNoteText(null, after, LABELS), null);
});

test("기획 17118-1 의 경우 — 앞 명함에서 이름을 직접 넣은 뒤 다른 사람 명함으로 다시 찍음", () => {
  const a = scanCard(CARD_A.join("\n"));
  const b = scanCard(CARD_B.join("\n"));
  assert.equal(a.values.email, "seoyun.han@pureunbyeol-media.co.kr");
  assert.equal(b.values.email, "marcus.yeo@northgate-analytics.com.sg");
  // 직원이 이름을 직접 넣음(앞 명함은 이름을 채우지 못함)
  const verdict = retakeVerdict({ read: a.values.email, field: a.values.email, chips: a.chips }, { email: b.values.email, chips: b.chips });
  assert.equal(verdict, "different");
  assert.deepEqual(retakePlan(verdict, { name: "한서윤" }, b.chips).release, ["name"]);
  // 같은 명함을 다시 찍으면 직원이 넣은 이름은 그대로예요
  const again = retakeVerdict({ read: a.values.email, field: a.values.email, chips: a.chips }, { email: a.values.email, chips: a.chips });
  assert.deepEqual(retakePlan(again, { name: "한서윤" }, a.chips), { verdict: "same", release: [], stale: [] });
});
