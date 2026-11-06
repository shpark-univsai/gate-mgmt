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

test("UG-451 ③ 라벨 없는 숫자만 줄은 전화번호 모양(KR 0 시작 9~11자리 · 대표번호 · SG 8자리 · 82 · 65 나라 번호)일 때만", () => {
  assert.equal(card("11800 8083").values.phone, "");
  assert.equal(readLines("11800 8083").length, 0);
  // SG 8자리(3 · 6 · 8 · 9 시작) — 8 · 9 는 휴대전화 순위라 앞 줄의 6 번호보다 먼저
  assert.equal(card("9123 4567").values.phone, "9123 4567");
  assert.equal(card("6123 4567").values.phone, "6123 4567");
  assert.equal(card("6123 4567", "9123 4567").values.phone, "9123 4567");
  assert.equal(card("T. +65 6234 5678", "9123 4567").values.phone, "9123 4567");
  assert.equal(card("6123 4567", "T. +65 6234 5678").values.phone, "+65 6234 5678");
  assert.deepEqual(readLines("9123 4567\n6123 4567"), ["9123 4567", "6123 4567"]);
  // KR 대표번호 15xx · 16xx · 18xx 8자리
  assert.equal(card("1588-1234").values.phone, "1588-1234");
  assert.equal(card("1644 1234").values.phone, "1644 1234");
  assert.equal(card("1800 1234").values.phone, "1800 1234");
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
  for (const line of ["11800 8083", "### 123", "1234", "대표", "HR", "A"]) assert.equal(isJunkChip(line), true, line);
  for (const line of ["R&D 및 AI 팀", "B 동 3 층", "홍길동", "010-1234-5678", "02-123-4567", "T. 1234 5678", "UNIVS", "Lee", "DBS", "UOB", "IBK"]) {
    assert.equal(isJunkChip(line), false, line);
  }
  assert.deepEqual(readLines("HR\n11800 8083\nR&D 및 AI 팀\n대표\nDBS\nB 동 3 층\n02-123-4567"), [
    "R&D 및 AI 팀",
    "DBS",
    "B 동 3 층",
    "02-123-4567",
  ]);
});

test("UG-451 리뷰 · 의심 메일이 하나라도 있으면 다른 메일 칩으로 채우지 않아요", () => {
  const r = card("daeun jung@x.co.kr", "sales@x.co.kr");
  assert.equal(r.values.email, "");
  assert.equal(r.links.email, undefined);
  assert.equal(card("sales@x.co.kr", "kim@x.com. sg").values.email, "");
  assert.equal(card("sales@x.co.kr", "support@x.co.kr").values.email, "sales@x.co.kr");
});

test("UG-451 리뷰 · 가운뎃점 · 구분자로 나뉜 앞 조각 · 줄바꿈 잘림도 의심", () => {
  for (const line of ["daeun·jung@x.co.kr", "daeun・jung@x.co.kr", "daeun•jung@x.co.kr", "kim@x.com· sg"]) {
    assert.equal(isSuspectEmail(line), true, line);
    assert.equal(card(line).values.email, "", line);
  }
  // 띄어 쓴 「 · 」 는 줄을 먼저 나눠요 — 앞 조각이 한 덩어리이고 뒤 조각이 메일로 시작하면 의심
  const split = card("daeun · jung@x.co.kr");
  assert.equal(split.values.email, "");
  assert.ok(split.chips.some((c) => c.text === "jung@x.co.kr" && c.suspect === true));
  assert.equal(card("daeun / jung@x.co.kr").values.email, "");
  // 라벨 · 여러 낱말 조각은 그대로
  assert.equal(card("E · jung@x.co.kr").values.email, "jung@x.co.kr");
  assert.equal(card("Miraero Logis · jung@x.co.kr").values.email, "jung@x.co.kr");
  // 줄바꿈 잘림 — 앞 줄이 . _ - 로 끝나는 한 덩어리
  for (const above of ["daeun.", "daeun_", "daeun-"]) assert.equal(card(above, "jung@x.co.kr").values.email, "", above);
  assert.equal(card("daeun", "jung@x.co.kr").values.email, "jung@x.co.kr");
  assert.equal(card("Sales Dept.", "jung@x.co.kr").values.email, "jung@x.co.kr");
});

test("UG-451 리뷰 · 뒤 조각 규칙이 다음 주소 · 누리집을 막지 않아요", () => {
  for (const line of ["kim@x.com, www.x.com", "kim@x.com. www.x.com", "kim@x.com, lee@x.com"]) {
    assert.equal(isSuspectEmail(line), false, line);
    const r = card(line);
    assert.equal(r.values.email, "kim@x.com", line);
    assert.equal(r.chips[0].value, "kim@x.com", line);
  }
  assert.equal(isSuspectEmail("kim@x.com SG"), true);
  assert.equal(card("kim@x.com SG").values.email, "");
});

test("UG-451 리뷰 · 아주 긴 줄도 앞부분만 빨리 봐요", () => {
  const long = "a ".repeat(5000) + "kim@x.com";
  const t = Date.now();
  card(long);
  isSuspectEmail(long);
  assert.ok(Date.now() - t < 500);
});

test("UG-451 재확인 · 전화번호 · 대문자 낱말 조각과 법인 표시 · 누리집 줄 뒤 메일은 채워요", () => {
  const filled: [string[], string][] = [
    [["010-1234-5678 | kim@x.com"], "kim@x.com"],
    [["010-1234-5678 · kim@x.com"], "kim@x.com"],
    [["+65 9123 4567 / kim@x.com"], "kim@x.com"],
    [["Seoul · kim@x.com"], "kim@x.com"],
    [["UNIVS · kim@x.com"], "kim@x.com"],
    [["Sales | sales@x.com"], "sales@x.com"],
    [["Company-A Ltd.", "kim@x.com"], "kim@x.com"],
    [["Company-A Inc.", "kim@x.com"], "kim@x.com"],
    [["Ltd.", "kim@x.com"], "kim@x.com"],
    [["Inc.", "kim@x.com"], "kim@x.com"],
    [["Co.", "kim@x.com"], "kim@x.com"],
    [["Pte.", "kim@x.com"], "kim@x.com"],
    [["www.x.com.", "kim@x.com"], "kim@x.com"],
  ];
  for (const [lines, email] of filled) assert.equal(card(...lines).values.email, email, lines.join(" ↵ "));
});

test("UG-451 재확인 · 소문자 덩어리 조각 · 줄바꿈 잘림은 계속 의심", () => {
  for (const lines of [["daeun.", "jung@x.co.kr"], ["daeun_", "jung@x.co.kr"], ["daeun-", "jung@x.co.kr"], ["daeun · jung@x.co.kr"], ["daeun·jung@x.co.kr"], ["daeun | jung@x.co.kr"]]) {
    assert.equal(card(...lines).values.email, "", lines.join(" ↵ "));
  }
});
