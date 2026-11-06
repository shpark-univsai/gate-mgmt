// 명함 읽기 규칙(card-scan.ts) 시험 — `npm test`(node --test, Node 의 타입 지우기로 바로 실행).
// 예시 값은 모두 지어낸 것이에요(공개 저장소 — 실제 고객 · 회사 · 번호 금지).
import assert from "node:assert/strict";
import { test } from "node:test";

import { emailHasConfusable, isJunkChip, isSuspectEmail, readLines, scanCard } from "./card-scan.ts";

const card = (...lines: string[]) => scanCard(lines.join("\n"));

test("UG-451 ② 앞 덩어리가 공백 · 쉼표 · 점으로 떨어진 주소는 채우지 않아요", () => {
  for (const line of [
    "daeun jung@miraero-logis.co.kr",
    "daeun,jung@miraero-logis.co.kr",
    "daeun. jung@miraero-logis.co.kr",
    "E. daniel tan@northwind-analytics.com",
  ]) {
    assert.equal(isSuspectEmail(line), true, line);
    const r = card("Miraero Logis", line, "M. 010-1234-5678");
    assert.equal(r.values.email, "", line);
    assert.equal(r.links.email, undefined, line);
    // 칩은 읽은 그대로 남아요
    assert.ok(r.chips.some((c) => c.kind === "email" && line.endsWith(c.text.replace(/^E\. /, ""))), line);
  }
});

test("UG-451 ② 잘렸을 수 있는 주소 칩의 값은 읽은 그대로(눌러 넣으면 형식 오류로 보여요)", () => {
  const r = card("daeun jung@miraero-logis.co.kr");
  assert.equal(r.chips[0].value, "daeun jung@miraero-logis.co.kr");
  const r2 = card("marcus.wong@bluepeak.com. sg");
  assert.equal(r2.chips[0].value, "marcus.wong@bluepeak.com. sg");
});

test("UG-451 ② 끝 도메인 뒤 깨진 조각(. sg · .58 · . kr)이 있으면 채우지 않아요", () => {
  for (const line of [
    "daniel tan@northwind-analytics.com. sg",
    "marcus.wong@bluepeak.com. sg",
    "jin.lee@company-a.co.kr.58",
    "jin.lee@company-a.co. kr",
    "jin.lee@company-a.co kr",
  ]) {
    assert.equal(isSuspectEmail(line), true, line);
    assert.equal(card(line).values.email, "", line);
  }
});

test("UG-451 ② 끝 도메인 오독(.cor)은 채우지 않아요", () => {
  assert.equal(isSuspectEmail("sales@bridgemedia.cor"), true);
  assert.equal(card("sales@bridgemedia.cor").values.email, "");
});

test("UG-451 ② 정상 주소 · 라벨 · 문장 끝 점 · 앞 전화번호는 그대로 채워요", () => {
  const ok: [string, string][] = [
    ["daeun.jung@miraero-logis.co.kr", "daeun.jung@miraero-logis.co.kr"],
    ["E. marcus.wong@bluepeak.com.sg", "marcus.wong@bluepeak.com.sg"],
    ["E daeun.jung@miraero-logis.co.kr", "daeun.jung@miraero-logis.co.kr"],
    ["Email. user1@example.com", "user1@example.com"],
    ["E-mail user1@example.com", "user1@example.com"],
    ["E.user1@example.com", "user1@example.com"],
    ["이메일 user1@example.com", "user1@example.com"],
    ["user1@example.com.", "user1@example.com"],
    ["010-1234-5678 user1@example.com", "user1@example.com"],
    ["user1@example.comTel", "user1@example.com"],
  ];
  for (const [line, email] of ok) {
    assert.equal(isSuspectEmail(line), false, line);
    assert.equal(card(line).values.email, email, line);
  }
});

test("UG-451 ③ 휴대전화 라벨 → 전화 라벨 → 라벨 없음 순서", () => {
  assert.equal(card("T. +65 6123 4567", "M. +65 9123 4567").values.phone, "+65 9123 4567");
  assert.equal(card("Tel 02-123-4567", "HP 010-1234-5678").values.phone, "010-1234-5678");
  assert.equal(card("전화 02-123-4567", "휴대폰 010-9876-5432").values.phone, "010-9876-5432");
  assert.equal(card("02-123-4567", "T. 031-765-4321").values.phone, "031-765-4321");
  assert.equal(card("Mobile: +65 6123 4567", "Tel: +65 6234 5678").values.phone, "+65 6123 4567");
  // 라벨이 없어도 번호가 휴대전화 모양이면 휴대전화 순위
  assert.equal(card("T. 02-123-4567", "010-1234-5678").values.phone, "010-1234-5678");
  // 한 줄에 여럿(라벨로 나뉨)
  assert.equal(card("T. 02-123-4567 M. 010-1234-5678 F. 02-123-4568").values.phone, "010-1234-5678");
});

test("UG-451 ③ UEN · 사업자 · Reg · 팩스 번호는 쓰지 않아요", () => {
  const sg = card("Bluepeak Pte. Ltd.", "UEN 201812345K", "F. +65 6123 4568");
  assert.equal(sg.values.phone, "");
  assert.ok(sg.chips.some((c) => c.text === "UEN 201812345K" && c.kind === "other"));
  assert.equal(card("201812345K").values.phone, "");
  assert.equal(card("Co. Reg. No. 201812345", "T. +65 6123 4567").values.phone, "+65 6123 4567");
  assert.equal(card("Registration 2018 1234 5678").values.phone, "");
  assert.equal(card("사업자등록번호 123-45-67890").values.phone, "");
  assert.equal(card("팩스 02-123-4568", "Fax 02-123-4569").values.phone, "");
  assert.equal(card("Fax 02-123-4569", "T 02-123-4567").values.phone, "02-123-4567");
});

test("UG-451 ③ 라벨 없는 숫자만 줄은 전화번호 모양(0 시작 9~11자리 · 82 · 65 나라 번호)일 때만", () => {
  assert.equal(card("11800 8083").values.phone, "");
  assert.equal(card("1234 5678").values.phone, "");
  assert.equal(card("02 123 4567").values.phone, "02 123 4567");
  assert.equal(card("010 1234 5678").values.phone, "010 1234 5678");
  assert.equal(card("65 9123 4567").values.phone, "65 9123 4567");
  // + · 괄호가 있으면 숫자만 줄이 아니에요
  assert.equal(card("+65 6123 4567").values.phone, "+65 6123 4567");
});

test("UG-451 ④ 헷갈리는 글자 안내는 로컬 부분에 숫자 · 로마자가 섞였을 때만", () => {
  assert.equal(emailHasConfusable("rachel.kim@example.com"), false);
  assert.equal(emailHasConfusable("daniel@example.com"), false);
  assert.equal(emailHasConfusable("yoon.jl0110@example.com"), true);
  assert.equal(emailHasConfusable("kim01@example.com"), true);
  assert.equal(emailHasConfusable("user@company-0l.com"), false);
});

test("UG-451 ⑤ 짧은 잡음 줄은 칩에서 빼요", () => {
  for (const line of ["11800 8083", "### 123", "1234", "대표", "HR", "PIE", "A"]) assert.equal(isJunkChip(line), true, line);
  for (const line of ["R&D 및 AI 팀", "B 동 3 층", "홍길동", "010-1234-5678", "02-123-4567", "T. 1234 5678", "UNIVS", "Lee"]) {
    assert.equal(isJunkChip(line), false, line);
  }
  assert.deepEqual(readLines("PIE\n11800 8083\nR&D 및 AI 팀\n대표\nB 동 3 층\n02-123-4567"), ["R&D 및 AI 팀", "B 동 3 층", "02-123-4567"]);
});
