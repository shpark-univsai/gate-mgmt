// 서버가 읽은 명함 값 다듬기 · 결과 모양(UG-463) — card-read.ts. 예시 값은 모두 지어낸 것이에요(공개 저장소).
import assert from "node:assert/strict";
import { test } from "node:test";

import { base64Bytes, isKoreanValues, serverChips, serverScan, serverValues } from "./card-read.ts";
import { retakePlan, retakeVerdict } from "./card-retake.ts";

const fields = (f: Partial<Record<"company" | "name" | "email" | "phone", string | null>>) => ({
  company: null,
  name: null,
  email: null,
  phone: null,
  ...f,
});

test("값 다듬기 — 줄바꿈 · 겹친 공백 · mailto · 도메인 대문자", () => {
  const v = serverValues(fields({ company: " Company\nA  Ltd. ", name: "Jane  Doe", email: "mailto:Jane.Doe@Company-A.COM ", phone: "M: +82-10-5555-0101" }));
  assert.equal(v.company, "Company A Ltd.");
  assert.equal(v.name, "Jane Doe");
  assert.equal(v.email, "jane.doe@company-a.com");
  assert.equal(v.phone, "+82-10-5555-0101");
});

test("메일 모양이 아니거나 번호가 아니면 비워요", () => {
  const v = serverValues(fields({ email: "jane at company-a", phone: "call me" }));
  assert.equal(v.email, "");
  assert.equal(v.phone, "");
  assert.deepEqual(serverValues(fields({})), { company: "", name: "", email: "", phone: "" });
});

test("결과 모양 — 칩 없음, 다 비면 unreadable", () => {
  const empty = serverScan(serverValues(fields({})));
  assert.equal(empty.outcome, "unreadable");
  assert.equal(empty.korean, false);
  const r = serverScan(serverValues(fields({ company: "주식회사 가나다", email: "user1@company-a.com" })));
  assert.equal(r.outcome, "found");
  assert.deepEqual(r.chips, []);
  assert.equal(r.found, 1);
  assert.equal(r.korean, true);
});

test("한글 명함 — 회사명 · 이름 한글 · .kr · 010 / +82", () => {
  const blank = { company: "", name: "", email: "", phone: "" };
  assert.equal(isKoreanValues({ ...blank, name: "홍길동" }), true);
  assert.equal(isKoreanValues({ ...blank, email: "user1@company-a.co.kr" }), true);
  assert.equal(isKoreanValues({ ...blank, phone: "010-5555-0101" }), true);
  assert.equal(isKoreanValues({ ...blank, phone: "+82 10 5555 0101" }), true);
  assert.equal(isKoreanValues({ ...blank, company: "Company A", phone: "+65 9555 0101" }), false);
});

test("다시 찍기 견주기 — 서버 값으로 만든 칩으로 같은 사람 · 다른 사람을 가려요", () => {
  const a = serverValues(fields({ company: "Company A", name: "Jane Doe", email: "jane@company-a.com" }));
  const b = serverValues(fields({ company: "Company B", name: "John Roe", email: "john@company-b.com" }));
  const prev = { read: a.email, field: a.email, chips: [] };
  assert.equal(retakeVerdict(prev, { email: a.email, chips: serverChips(a), readable: true }), "same");
  assert.equal(retakeVerdict(prev, { email: b.email, chips: serverChips(b), readable: true }), "different");
  // 다른 사람 — 직원이 넣은 이름은 새 명함에 없으면 비우고, 새 명함에 그대로 있으면 남겨요
  assert.deepEqual(retakePlan("different", { name: "Jane Doe" }, serverChips(b)).release, ["name"]);
  assert.deepEqual(retakePlan("different", { company: "Company B" }, serverChips(b)).release, []);
});

test("base64 바이트 수", () => {
  assert.equal(base64Bytes("QUJD"), 3);
  assert.equal(base64Bytes("QUI="), 2);
  assert.equal(base64Bytes("QQ=="), 1);
});
