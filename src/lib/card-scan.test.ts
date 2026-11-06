// 명함 읽기 규칙(card-scan.ts) 시험 — `npm test`(node --test, Node 의 타입 지우기로 바로 실행).
// 예시 값은 모두 지어낸 것이에요(공개 저장소 — 실제 고객 · 회사 · 번호 금지).
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  chipEmailAddresses,
  confusableNote,
  emailHasConfusable,
  isEmailLikeChip,
  isJunkChip,
  isSuspectChip,
  isSuspectEmail,
  isSuspectValue,
  readLines,
  scanCard,
  tapChip,
} from "./card-scan.ts";

/** 화면(계정 만들기 창)의 이메일 형식 검사와 같은 식 */
const PAGE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  // 칩은 떨어진 앞 덩어리까지 읽은 그대로(기획 17022)
  assert.ok(split.chips.some((c) => c.text === "daeun · jung@x.co.kr" && c.value === "daeun · jung@x.co.kr" && c.suspect === true));
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
    // 「Seoul · kim@」 「UNIVS · kim@」(가운뎃점 + 한 낱말)은 최종 리뷰 R1 부터 의심 — 아래 R1 시험
    [["Seoul / kim@x.com"], "kim@x.com"],
    [["UNIVS / kim@x.com"], "kim@x.com"],
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

test("UG-451 16991 ⑦ 전화번호 모양이 아닌 번호는 라벨이 있어도 채우지 않아요(거꾸로 찍힌 명함)", () => {
  for (const line of ["4299400503160", "T. 4299400503160", "M 4299400503160", "Tel: 429 9400 503160", "HP 12345678901234", "T. 0101234 5678901"]) {
    assert.equal(card(line).values.phone, "", line);
  }
  // 거꾸로 읽힌 글자 사이에 섞여도
  assert.equal(card("ʇɐǝƃ", "T. 4299400503160", "M. 010-1234-5678").values.phone, "010-1234-5678");
  // 정상 번호는 그대로
  const ok: [string, string][] = [
    ["M. 01012345678", "01012345678"],
    ["T. 0212345678", "0212345678"],
    ["T. 02-123-4567", "02-123-4567"],
    ["Tel (02) 123-4567", "(02) 123-4567"],
    ["M. +82 10 1234 5678", "+82 10 1234 5678"],
    ["T +44 20 7946 0958", "+44 20 7946 0958"],
    ["Phone +1 (415) 555-0132", "+1 (415) 555-0132"],
    ["T. 415-555-0132", "415-555-0132"],
    ["M. 9123 4567", "9123 4567"],
    ["대표 1588-1234", "1588-1234"],
  ];
  for (const [line, phone] of ok) assert.equal(card(line).values.phone, phone, line);
});

test("UG-451 17005 끝 도메인 바로 뒤에 글자 · 숫자 · 기호가 붙으면 채우지 않아요(잘렸을 수 있어요)", () => {
  const suspect: [string, string][] = [
    // [읽은 줄, 칩 값(읽은 그대로 — 눌러 넣으면 형식 오류로 보여요)]
    ["marcus.wong@bluepeak.com-s&", "marcus.wong@bluepeak.com-s&"],
    ["E. marcus.wong@bluepeak.com-s&", "marcus.wong@bluepeak.com-s&"],
    ["kim@x.com&", "kim@x.com&"],
    ["kim@x.com58", "kim@x.com58"],
    ["kim@x.com-sg", "kim@x.com-sg"],
    ["kim@x.com_sg", "kim@x.com_sg"],
    ["kim@x.com/sg", "kim@x.com/sg"],
    ["kim@x.com#", "kim@x.com#"],
    ["kim@x.com-", "kim@x.com-"],
    ["kim@x.com.-", "kim@x.com.-"],
    ["kim@x.com,www.x.com", "kim@x.com,www.x.com"],
    // 라벨이 아닌 대문자 덩어리가 붙음(나라 도메인 앞 점을 놓침)
    ["kim@x.comSG", "kim@x.comSG"],
    ["kim@x.co.krKR", "kim@x.co.krKR"],
  ];
  for (const [line, value] of suspect) {
    assert.equal(isSuspectEmail(line), true, line);
    const r = card("Company-A", line, "M. 010-1234-5678");
    assert.equal(r.values.email, "", line);
    assert.equal(r.links.email, undefined, line);
    const chip = r.chips.find((c) => c.kind === "email");
    assert.ok(chip, line);
    assert.equal(chip.value, value, line);
    // 칩 글자는 읽은 그대로
    assert.ok(line.endsWith(chip.text.replace(/^E\. /, "")), line);
  }
  // 소문자로 붙은 나라 도메인(점을 놓침)도 오독으로 봐요
  for (const line of ["marcus.wong@bluepeak.comsg", "kim@x.cokr", "kim@x.netmy"]) {
    assert.equal(isSuspectEmail(line), true, line);
    assert.equal(card(line).values.email, "", line);
  }
  // 다른 정상 메일 칩이 있어도 비워요(규칙 그대로)
  assert.equal(card("sales@x.com", "marcus.wong@bluepeak.com-s&").values.email, "");
});

test("UG-451 17005 맺음 기호 · 띄어쓰기 · 라벨만 붙은 주소는 그대로 채워요", () => {
  const ok: [string, string][] = [
    ["kim@x.com", "kim@x.com"],
    ["kim@x.com.", "kim@x.com"],
    ["kim@x.com,", "kim@x.com"],
    ["kim@x.com;", "kim@x.com"],
    ["kim@x.com|", "kim@x.com"],
    ["(kim@x.com)", "kim@x.com"],
    ["<kim@x.com>", "kim@x.com"],
    ["\"kim@x.com\"", "kim@x.com"],
    ["E: kim@x.com).", "kim@x.com"],
    ["kim@x.com T. 02-123-4567", "kim@x.com"],
    ["kim@x.com, www.x.com", "kim@x.com"],
    ["kim@x.comTel", "kim@x.com"],
    ["kim@x.comFax", "kim@x.com"],
    ["kim@x.com.sg", "kim@x.com.sg"],
    ["kim@x.co.kr", "kim@x.co.kr"],
    ["kim@company-a.network", "kim@company-a.network"],
  ];
  for (const [line, email] of ok) {
    assert.equal(isSuspectEmail(line), false, line);
    assert.equal(card(line).values.email, email, line);
  }
});

test("UG-451 17005 리뷰 · 끝 도메인에 붙은 라벨은 떼고 라벨 뒤는 보지 않아요", () => {
  const ok: [string, string][] = [
    ["kim@x.comTel:02-123-4567", "kim@x.com"],
    ["kim@x.comTel:+65 6123 4567", "kim@x.com"],
    ["kim@x.comTel)02-123-4567", "kim@x.com"],
    ["kim@x.comM:010-1234-5678", "kim@x.com"],
    ["kim@x.comM.010-1234-5678", "kim@x.com"],
    ["kim@x.comT:6123 4567", "kim@x.com"],
    ["kim@x.comT +65 6123 4567", "kim@x.com"],
    ["kim@x.co.krTel02-123-4567", "kim@x.co.kr"],
    ["kim@x.co.krTel.02-123-4567", "kim@x.co.kr"],
    ["kim@x.comTEL. 02-123-4567", "kim@x.com"],
    ["E:kim@x.comWeb:www.x.com", "kim@x.com"],
    ["E-mail:kim@x.co.krHomepage:www.x.co.kr", "kim@x.co.kr"],
    // 한글 라벨도 붙어 읽히면 떼요
    ["kim@x.com전화02-123-4567", "kim@x.com"],
    ["kim@x.co.kr휴대폰010-1234-5678", "kim@x.co.kr"],
    ["kim@x.com팩스:02-123-4568", "kim@x.com"],
    ["kim@x.com홈페이지", "kim@x.com"],
    ["kim@x.co.kr홈페이지:www.x.co.kr", "kim@x.co.kr"],
  ];
  for (const [line, email] of ok) {
    assert.equal(isSuspectEmail(line), false, line);
    assert.equal(card(line).values.email, email, line);
  }
});

test("UG-451 17005 리뷰 · 한 글자 대문자는 뒤가 전화번호일 때만 라벨 — 아니면 잘린 끝 도메인일 수 있어요", () => {
  for (const line of ["tan@bluepeak.coM", "kim@x.neT", "kim@x.orG", "kim@x.coE", "kim@x.coP", "kim@x.coH", "kim@x.coF", "kim@x.coT", "kim@x.comT/02-123-4567"]) {
    assert.equal(isSuspectEmail(line), true, line);
    assert.equal(card(line).values.email, "", line);
  }
  // 칩 값은 읽은 그대로(잘린 주소가 조용히 들어가지 않게)
  assert.equal(card("tan@bluepeak.coM").chips[0].value, "tan@bluepeak.coM");
});

test("UG-451 17005 리뷰 · 주소 바로 앞에 붙은 글자 · 기호가 있으면 채우지 않아요", () => {
  for (const line of [
    "hong:gildong@x.com",
    "hong'gildong@x.com",
    "hong—gildong@x.com",
    "hong，gildong@x.com",
    "hong。gildong@x.com",
    "hong/gildong@x.com",
    "hong(gildong@x.com",
    "hong)gildong@x.com",
    "hong홍gildong@x.com",
    "hong;gildong@x.com",
    "hong*gildong@x.com",
  ]) {
    assert.equal(isSuspectEmail(line), true, line);
    const r = card(line);
    assert.equal(r.values.email, "", line);
    // 칩 값은 앞 덩어리까지 읽은 그대로
    assert.equal(r.chips[0].value, line, line);
  }
  // 줄 처음 · 공백 · 여는 괄호 · 따옴표 · 메일 라벨 끝은 괜찮아요
  const ok: [string, string][] = [
    ["E:kim@x.com", "kim@x.com"],
    ["E)kim@x.com", "kim@x.com"],
    ["E.kim@x.com", "kim@x.com"],
    ["Email:kim@x.com", "kim@x.com"],
    ["E-mail:kim@x.com", "kim@x.com"],
    ["Mail:kim@x.com", "kim@x.com"],
    ["이메일:kim@x.com", "kim@x.com"],
    ["메일kim@x.com", "kim@x.com"],
    ["(kim@x.com)", "kim@x.com"],
    ["[kim@x.com]", "kim@x.com"],
    ["「kim@x.com」", "kim@x.com"],
    ["“kim@x.com”", "kim@x.com"],
    ["Email: (kim@x.com)", "kim@x.com"],
    ["hong-gildong@x.com", "hong-gildong@x.com"],
  ];
  for (const [line, email] of ok) {
    assert.equal(isSuspectEmail(line), false, line);
    assert.equal(card(line).values.email, email, line);
  }
  // 구분자로 나뉜 조각은 그대로(기존 규칙)
  for (const [lines, email] of [
    [["UNIVS | kim@x.com"], "kim@x.com"],
    [["010-1234-5678 · kim@x.com"], "kim@x.com"],
    [["Email: kim@x.com"], "kim@x.com"],
  ] as [string[], string][]) {
    assert.equal(card(...lines).values.email, email, lines.join(" ↵ "));
  }
});

test("UG-451 17005 리뷰 · 공백 · 구분자 · 줄바꿈으로 떨어진 1~2글자 꼬리가 있으면 채우지 않아요", () => {
  for (const lines of [
    ["tan@bluepeak.com · sg"],
    ["tan@bluepeak.com • sg"],
    ["tan@bluepeak.com / sg"],
    ["tan@bluepeak.com | sg"],
    ["tan@bluepeak.com|sg"],
    ["kim@x.com sg."],
    ["tan@bluepeak.com SG)"],
    ["tan@bluepeak.com Sg"],
    ["tan@bluepeak.com S G"],
    ["tan@bluepeak.co m.sg"],
    ["tan@bluepeak.co m"],
    ["tan@bluepeak.com", "sg"],
    ["tan@bluepeak.com", ".sg"],
    ["tan@bluepeak.com.", "sg"],
    ["tan@bluepeak.co", "m.sg"],
    ["E. tan@bluepeak.com", "SG", "T. +65 6123 4567"],
  ]) {
    const r = card(...lines);
    assert.equal(r.values.email, "", lines.join(" ↵ "));
    assert.equal(r.links.email, undefined, lines.join(" ↵ "));
    assert.ok(r.chips.some((c) => c.kind === "email"), lines.join(" ↵ "));
  }
  // 라벨 + 번호 · 3글자 이상 낱말 · 다음 줄이 다른 내용이면 그대로
  const filled: [string[], string][] = [
    [["kim@x.com T. 02-123-4567"], "kim@x.com"],
    [["kim@x.com M +65 9123 4567"], "kim@x.com"],
    [["kim@x.com, www.x.com"], "kim@x.com"],
    [["kim@x.com / www.x.com"], "kim@x.com"],
    [["kim@x.com Tel 02-123-4567"], "kim@x.com"],
    [["kim@x.com (영업)"], "kim@x.com"],
    [["kim@x.com", "www.x.com"], "kim@x.com"],
    [["kim@x.com", "T. 02-123-4567"], "kim@x.com"],
    [["kim@x.com", "Seoul, Korea"], "kim@x.com"],
    [["kim@x.com", "서울시 중구"], "kim@x.com"],
  ];
  for (const [lines, email] of filled) assert.equal(card(...lines).values.email, email, lines.join(" ↵ "));
});

test("UG-451 17005 리뷰 · 전각 맺음 기호는 채우고, 붙은 괄호 글 · 소문자 라벨 · .cm 은 비워요", () => {
  for (const line of ["kim@x.com）", "kim@x.com。", "kim@x.com、", "kim@x.com，", "kim@x.com；", "kim@x.com：", "kim@x.com."]) {
    assert.equal(card(line).values.email, "kim@x.com", line);
  }
  for (const line of ["kim@x.co.kr(대표)", "kim@x.co.kr（대표）", "Email: kim@x.co.kr(영업팀)", "kim@x.comtel 02-123-4567", "kim@x.comfax", "tan@bluepeak.cm", "tan@bluepeak.om"]) {
    assert.equal(isSuspectEmail(line), true, line);
    assert.equal(card(line).values.email, "", line);
  }
});

test("UG-451 17005 재리뷰 · co · ne · or 뒤에 붙은 대문자는 라벨이어도 의심(.com · .net · .org 끝 글자일 수 있어요)", () => {
  for (const line of [
    "kim@x.coM 010-1234-5678",
    "kim@x.coM.010-1234-5678",
    "kim@x.coM)010-1234-5678",
    "kim@x.coM +65 9123 4567",
    "kim@x.neT 02-123-4567",
    "kim@x.orG 02-123-4567",
    "kim@x.coC 010-1234-5678",
    "kim@x.coH.P 010-1234-5678",
    "kim@x.coTel 02-123-4567",
    "kim@x.coMobile 010-1234-5678",
    "kim@x.coMail",
    "kim@x.co M 010-1234-5678",
    "kim@x.ne T 02-123-4567",
  ]) {
    assert.equal(card(line).values.email, "", line);
  }
  // com · net · org · co.kr 뒤 라벨은 그대로 떼고 채워요
  const ok: [string, string][] = [
    ["kim@x.comM.010-1234-5678", "kim@x.com"],
    ["kim@x.comT +65 6123 4567", "kim@x.com"],
    ["kim@x.netTel 02-123-4567", "kim@x.net"],
    ["kim@x.co.krM.010-1234-5678", "kim@x.co.kr"],
    ["kim@x.co", "kim@x.co"],
    ["kim@x.co Tel 02-123-4567", "kim@x.co"],
  ];
  // .co 뒤에 띄어 쓴 한 글자 라벨(T · M · G)은 「.com」의 m 이 떨어진 것과 구별이 안 돼 비워요(안전 쪽 결정)
  assert.equal(card("kim@x.co T. 02-123-4567").values.email, "");
  for (const [line, email] of ok) assert.equal(card(line).values.email, email, line);
});

test("UG-451 17005 재리뷰 · 떨어진 꼬리는 나라 도메인 모양일 때만 — 부서 · 직함 · 짧은 잡음은 채워요", () => {
  const filled: [string[], string][] = [
    [["kim@x.com (HQ)"], "kim@x.com"],
    [["kim@x.com / IT"], "kim@x.com"],
    [["kim@x.com | PR"], "kim@x.com"],
    [["kim@x.com · VP"], "kim@x.com"],
    [["kim@x.com Jr."], "kim@x.com"],
    [["kim@x.com (Mr)"], "kim@x.com"],
    [["E kim@x.com HR"], "kim@x.com"],
    ...["HR", "M", "M.", "T", "KT", "SK", "LG", "AI", "QR", "Go", "J.K", "UX UI", "ee", "i", "IT Team"].map(
      (next): [string[], string] => [["kim@x.com", next], "kim@x.com"],
    ),
  ];
  for (const [lines, email] of filled) assert.equal(card(...lines).values.email, email, lines.join(" ↵ "));
  for (const lines of [
    ["kim@x.com KR"],
    ["tan@bluepeak.com s"],
    ["tan@bluepeak.com · SG"],
    ["kim@x.com / lee@y.com sg"],
    ["kim@x.com", "sg"],
    ["kim@x.com", "S G"],
    ["kim@x.com", "my"],
    ["kim@x.com, lee@y.com", "sg"],
    ["tan@bluepeak.co", "m.sg"],
  ]) {
    assert.equal(card(...lines).values.email, "", lines.join(" ↵ "));
  }
});

test("UG-451 17005 재리뷰 · 메일 라벨 끝은 대소문자 · 전각 기호 · ▶ · > 도 받아요", () => {
  for (const line of [
    "E-MAIL:kim@x.com",
    "e-mail:kim@x.com",
    "mail:kim@x.com",
    "e:kim@x.com",
    "e.mail:kim@x.com",
    "E-mail：kim@x.com",
    "이메일：kim@x.com",
    "Mail to:kim@x.com",
    "Email▶kim@x.com",
    "E>kim@x.com",
    "E:(kim@x.com)",
  ]) {
    assert.equal(isSuspectEmail(line), false, line);
    assert.equal(card(line).values.email, "kim@x.com", line);
  }
  for (const line of ["✉kim@x.com", "©kim@x.com", "®kim@x.com", "Tel 02-123-4567/kim@x.com"]) {
    assert.equal(card(line).values.email, "", line);
  }
});

test("UG-451 17005 최종 확인 · co · ne · or 뒤에 띄어 쓴 1~2글자 토막이 오면 비워요", () => {
  for (const line of [
    "kim@x.co rn",
    "kim@x.co rm",
    "kim@x.co om",
    "kim@x.ne tt",
    "kim@x.or g",
    "kim@x.co rn 010-1234-5678",
    "kim@x.co · rn",
    "kim@x.co / om",
    "kim@x.co|rn",
    "kim@x.co (rn)",
  ]) {
    assert.equal(card(line).values.email, "", line);
  }
  // 다음 줄이 토막 하나뿐 — co · ne · or 로 끝난 주소만
  for (const lines of [["kim@x.co", "rn"], ["kim@x.co", "m"], ["kim@x.ne", "t."], ["kim@x.or", "(g)"]]) {
    assert.equal(card(...lines).values.email, "", lines.join(" ↵ "));
  }
  for (const lines of [["kim@x.com", "rn"], ["kim@x.co.kr", "M"], ["kim@x.co", "Tel 02-123-4567"], ["kim@x.co", "www.x.co"]]) {
    assert.equal(card(...lines).values.email, lines[0], lines.join(" ↵ "));
  }
  const filled: [string, string][] = [
    ["kim@x.co.kr rn", "kim@x.co.kr"],
    ["kim@x.com rn", "kim@x.com"],
    ["kim@x.com Dr", "kim@x.com"],
    ["kim@x.co Tel 02-123-4567", "kim@x.co"],
    ["kim@x.net Fax 02-123-4568", "kim@x.net"],
  ];
  for (const [line, email] of filled) assert.equal(card(line).values.email, email, line);
});

test("UG-451 17022 · 잘렸을 수 있는 주소 칩은 떨어진 앞 덩어리 · 꼬리까지 읽은 그대로 보이고 그대로 넣어요", () => {
  // [읽은 줄들, 칩 글자, 칩 값]
  const cases: [string[], string, string][] = [
    // 같은 줄의 나라 도메인 꼬리(구분자로 나뉘어 칩에서 떨어졌던 것)
    [["tan@bluepeak.com · sg"], "tan@bluepeak.com · sg", "tan@bluepeak.com · sg"],
    [["tan@bluepeak.com / sg"], "tan@bluepeak.com / sg", "tan@bluepeak.com / sg"],
    [["tan@bluepeak.com • sg"], "tan@bluepeak.com • sg", "tan@bluepeak.com • sg"],
    // 붙어 읽힌 「|」는 띄어 써요 — 공백이 있어야 형식 검사에 걸려요
    [["tan@bluepeak.com|sg"], "tan@bluepeak.com | sg", "tan@bluepeak.com | sg"],
    [["tan@bluepeak.com | sg"], "tan@bluepeak.com | sg", "tan@bluepeak.com | sg"],
    // 다음 줄 꼬리는 띄어 이어요
    [["tan@bluepeak.com", "sg"], "tan@bluepeak.com sg", "tan@bluepeak.com sg"],
    [["tan@bluepeak.com.", "sg"], "tan@bluepeak.com. sg", "tan@bluepeak.com. sg"],
    [["tan@bluepeak.co", "m.sg"], "tan@bluepeak.co m.sg", "tan@bluepeak.co m.sg"],
    // 앞 메일 라벨은 칩 글자에는 남고 값에서는 빠져요
    [["E. tan@bluepeak.com", "SG", "T. +65 6123 4567"], "E. tan@bluepeak.com SG", "tan@bluepeak.com SG"],
    // co · ne · or 뒤 토막(같은 줄 구분자 · 라벨로 나뉨 · 다음 줄)
    [["kim@x.co | rn"], "kim@x.co | rn", "kim@x.co | rn"],
    [["kim@x.co M 010-1234-5678"], "kim@x.co M", "kim@x.co M"],
    [["kim@x.co", "rn"], "kim@x.co rn", "kim@x.co rn"],
    // 구분자 · 줄바꿈으로 떨어진 앞 덩어리
    [["daeun / jung@x.co.kr"], "daeun / jung@x.co.kr", "daeun / jung@x.co.kr"],
    [["daeun|jung@x.co.kr"], "daeun | jung@x.co.kr", "daeun | jung@x.co.kr"],
    [["daeun.", "jung@x.co.kr"], "daeun. jung@x.co.kr", "daeun. jung@x.co.kr"],
    // 나뉘지 않은 줄(전부터 읽은 그대로) — 붙은 잡음 · 앞에 붙은 글자 · 띄어 쓴 토막
    [["kim@bluepeak.com-s&"], "kim@bluepeak.com-s&", "kim@bluepeak.com-s&"],
    [["hong:gildong@x.com"], "hong:gildong@x.com", "hong:gildong@x.com"],
    [["kim@x.co m"], "kim@x.co m", "kim@x.co m"],
    [["tan@bluepeak.com sg"], "tan@bluepeak.com sg", "tan@bluepeak.com sg"],
  ];
  for (const [lines, text, value] of cases) {
    const label = lines.join(" ↵ ");
    const r = card(...lines);
    assert.equal(r.values.email, "", label);
    const chip = r.chips.find((c) => c.kind === "email");
    assert.ok(chip, label);
    assert.equal(chip.text, text, label);
    assert.equal(chip.value, value, label);
    // 눌러 넣는 값은 형식 검사(화면의 EMAIL_RE)에 걸리거나, 걸리지 않으면 칸 값 경고(isSuspectValue)로 막혀요 — 빼는 경우 없이
    assert.ok(!PAGE_EMAIL_RE.test(value) || isSuspectValue(value, r.chips), label);
    // 칩을 누르면 이 값이 이메일 칸에 들어가요
    const tap = tapChip(chip, r.links, r.values, null);
    assert.deepEqual(tap.set, { field: "email", value }, label);
  }
});

test("UG-451 17022 · 의심이 아닌 메일 칩은 전처럼 뽑은 주소", () => {
  for (const [lines, value] of [
    [["kim@x.com T. 02-123-4567"], "kim@x.com"],
    [["E. kim@x.com"], "kim@x.com"],
    [["kim@x.com / www.x.com"], "kim@x.com"],
    [["kim@x.com", "Seoul, Korea"], "kim@x.com"],
  ] as [string[], string][]) {
    const r = card(...lines);
    assert.equal(r.values.email, value, lines.join(" ↵ "));
    assert.equal(r.chips.find((c) => c.kind === "email")?.value, value, lines.join(" ↵ "));
  }
  // 한 줄에 주소가 둘이고 하나에만 꼬리가 붙었으면 그 칩만 꼬리까지 — 다른 칩은 뽑은 주소(채우지는 않아요)
  const two = card("kim@x.com / tan@y.com · sg");
  assert.equal(two.values.email, "");
  assert.deepEqual(
    two.chips.filter((c) => c.kind === "email").map((c) => c.value),
    ["kim@x.com", "tan@y.com · sg"],
  );
});

test("UG-451 17022 리뷰 F1 · 메일 라벨이 앞에 붙어도 떨어진 앞 덩어리를 봐요", () => {
  const cases: [string[], string][] = [
    [["E. daeun · jung@x.co.kr"], "daeun · jung@x.co.kr"],
    [["E. daeun / jung@x.co.kr"], "daeun / jung@x.co.kr"],
    [["E.daeun · jung@x.co.kr"], "daeun · jung@x.co.kr"],
    [["Email: daeun / jung@x.co.kr"], "daeun / jung@x.co.kr"],
    [["E daeun | jung@x.co.kr"], "daeun | jung@x.co.kr"],
    [["이메일 daeun · jung@x.co.kr"], "daeun · jung@x.co.kr"],
    [["M. 010-1234-5678 E. daeun · jung@x.co.kr"], "daeun · jung@x.co.kr"],
    [["E. daeun.", "jung@x.co.kr"], "daeun. jung@x.co.kr"],
    [["E: daeun.", "jung@x.co.kr"], "daeun. jung@x.co.kr"],
    [["daeun.", "E. jung@x.co.kr"], "daeun. jung@x.co.kr"],
    [["daeun.", "E: jung@x.co.kr"], "daeun. jung@x.co.kr"],
  ];
  for (const [lines, value] of cases) {
    const label = lines.join(" ↵ ");
    const r = card(...lines);
    assert.equal(r.values.email, "", label);
    const chip = r.chips.find((c) => c.kind === "email");
    assert.equal(chip?.value, value, label);
    assert.equal(chip?.suspect, true, label);
  }
  // 라벨만 있는 앞 조각 · 라벨 뒤가 메일 앞부분이 아닌 덩어리는 그대로 채워요
  assert.equal(card("E · jung@x.co.kr").values.email, "jung@x.co.kr");
  assert.equal(card("E. Miraero Logis · jung@x.co.kr").values.email, "jung@x.co.kr");
  assert.equal(card("eunji", "jung@x.co.kr").values.email, "jung@x.co.kr");
});

test("UG-451 17022 리뷰 F2 · 의심 칩 값은 형식 검사에 걸리거나 칸 값 경고로 막혀요", () => {
  const corpus: string[][] = [
    ["kim@x.coM"], ["kim@x.coM 010-1234-5678"], ["kim@x.neT 02-123-4567"], ["kim@x.orG"], ["kim@x.comSG"], ["kim@x.cm"], ["kim@x.om"],
    ["kim@x.cor"], ["kim@x.con"], ["kim@x.comsg"], ["kim@x.comtel 02-1"], ["tan@x.com·sg"], ["tan@x.com(sg)"], ["tan@x.com.58"],
    ["tan@x.com-s&"], ["tan@x.com&"], ["tan@x.com58"], ["hong:gildong@x.com"], ["daeun,jung@x.co.kr"], ["daeun·jung@x.co.kr"],
    ["daeun jung@x.co.kr"], ["hong—gildong@x.com"], ["hong(gildong@x.com"], ["tan@x.com,sg"], ["tan@x.com;sg"], ["tan@x.com/sg"],
    ["tan@x.com•sg"], ["tan@x.co|m"], ["tan@x.co·m"], ["tan@x.co(rn)"], ["tan@x.co,rn"], ["tan@x.co/rn"], ["tan@x.com", ".sg"],
    ["tan@x.co", "(m)"], ["E.tan@x.com · sg"], ["Email:tan@x.com|sg"], ["daeun_", "jung@x.co.kr"], ["daeun-", "jung@x.co.kr"],
    ["kim@x.com,www.x.com"], ["kim@x.com/www.x.com"], ["tan@bluepeak.com.", "sg"], ["tan@x.com S G"], ["tan@x.com|SG"],
    ["E. daeun · jung@x.co.kr"], ["daeun.", "E. jung@x.co.kr"],
  ];
  let suspects = 0;
  for (const lines of corpus) {
    const r = card(...lines);
    for (const c of r.chips.filter(isSuspectChip)) {
      suspects++;
      assert.ok(!PAGE_EMAIL_RE.test(c.value) || isSuspectValue(c.value, r.chips), `${lines.join(" ↵ ")} → ${c.value}`);
      // 앞뒤 공백을 떼고 대소문자 없이 봐요(기획 17030) — 글자가 달라지면 풀려요
      if (PAGE_EMAIL_RE.test(c.value)) {
        assert.equal(isSuspectValue(` ${c.value} `, r.chips), true);
        assert.equal(isSuspectValue(c.value.toUpperCase(), r.chips), true);
        assert.equal(isSuspectValue(c.value.toLowerCase(), r.chips), true);
        assert.equal(isSuspectValue(`${c.value}x`, r.chips), false);
      }
    }
  }
  assert.ok(suspects >= corpus.length);
  // 의심이 아닌 칩 값 · 빈 칸은 막지 않아요
  const ok = card("kim@x.com T. 02-123-4567");
  assert.equal(isSuspectValue("kim@x.com", ok.chips), false);
  assert.equal(isSuspectValue("", card("kim@x.cm").chips), false);
});

test("UG-451 17022 리뷰 · 여는 괄호 · 따옴표 안의 떨어진 앞 덩어리도 의심", () => {
  for (const lines of [["(daeun · jung@x.co.kr)"], ["「daeun · jung@x.co.kr」"], ["daeun.", "(jung@x.co.kr)"], ["daeun.", "<jung@x.co.kr>"], ["(daeun.", "jung@x.co.kr"]]) {
    const label = lines.join(" ↵ ");
    const r = card(...lines);
    assert.equal(r.values.email, "", label);
    const chip = r.chips.find((c) => c.kind === "email");
    assert.equal(chip?.suspect, true, label);
    // 값은 공백이 들어간 읽은 그대로 — 형식 검사에 걸려요
    assert.equal(PAGE_EMAIL_RE.test(chip?.value ?? ""), false, label);
  }
  // 괄호만 있는 주소 · 가운뎃점이 아닌 구분자의 대문자 덩어리는 전처럼 채워요(「Daeun · jung@」은 최종 리뷰 R1 부터 의심)
  assert.equal(card("(kim@x.com)").values.email, "kim@x.com");
  assert.equal(card("Daeun / jung@x.co.kr").values.email, "jung@x.co.kr");
});

test("UG-451 17022 리뷰 · @ 앞이 점으로 시작 · 끝나거나 점이 겹치면 의심(읽은 그대로 칩, 칸 값 경고)", () => {
  for (const lines of [["daeun", ".jung@x.co.kr"], [".jung@x.co.kr"], ["kim.@x.com"], ["kim..lee@x.com"]]) {
    const label = lines.join(" ↵ ");
    const r = card(...lines);
    assert.equal(r.values.email, "", label);
    const chip = r.chips.find((c) => c.kind === "email");
    assert.ok(chip && isSuspectChip(chip), label);
    assert.equal(chip?.value, lines[lines.length - 1], label);
    assert.equal(isSuspectValue(chip?.value ?? "", r.chips), true, label);
  }
  // 점이 가운데 하나씩인 주소 · 붙은 메일 라벨(「E.jung@」)은 그대로 채워요
  assert.equal(card("kim.lee@x.com").values.email, "kim.lee@x.com");
  assert.equal(card("E.jung@x.com").values.email, "jung@x.com");
});

test("UG-451 최종 리뷰 R1 · 가운뎃점으로 이어진 덩어리는 대소문자 · 가운데 점과 상관없이 의심, 「낱말.」 ↵ 메일 줄도", () => {
  for (const lines of [
    ["John · Smith@acme.com"],
    ["E. John · Smith@acme.com"],
    ["Daeun · Jung@x.co.kr"],
    ["daeun.kim · jung@x.co.kr"],
    ["Daeun • jung@x.co.kr"],
    ["Sales · kim@x.com"],
    ["Seoul · kim@x.com"],
    ["UNIVS · kim@x.com"],
    ["John.", "Smith@acme.com"],
    ["Director.", "kim@x.com"],
  ]) {
    const label = lines.join(" ↵ ");
    const r = card(...lines);
    assert.equal(r.values.email, "", label);
    assert.ok(r.chips.some((c) => c.kind === "email" && c.suspect === true), label);
  }
  // 다른 구분자의 대문자 덩어리 · 전화번호 · 누리집 · 회사 · 호칭 약어 · 여러 낱말 줄은 전처럼 채워요
  const filled: [string[], string][] = [
    [["HR / hr@x.com"], "hr@x.com"],
    [["Sales | kim@x.com"], "kim@x.com"],
    [["M 010-1234-5678 · E kim@x.com"], "kim@x.com"],
    [["010-1234-5678 · kim@x.com"], "kim@x.com"],
    [["www.x.com · kim@x.com"], "kim@x.com"],
    [["web: www.x.com · mail: kim@x.com"], "kim@x.com"],
    [["E · kim@x.com"], "kim@x.com"],
    [["Ltd.", "kim@x.com"], "kim@x.com"],
    [["Inc.", "kim@x.com"], "kim@x.com"],
    [["Head of Sales.", "kim@x.com"], "kim@x.com"],
    [["www.x.com.", "kim@x.com"], "kim@x.com"],
    // 한 글자 라벨 · 메일 라벨 줄(「E.」 「M.」 「Email.」)
    [["E.", "kim@x.com"], "kim@x.com"],
    [["M.", "kim@x.com"], "kim@x.com"],
    [["Email.", "kim@x.com"], "kim@x.com"],
  ];
  for (const [lines, email] of filled) assert.equal(card(...lines).values.email, email, lines.join(" ↵ "));
});

test("UG-451 최종 리뷰 R3 · 의심 칩에서 뽑은 잘린 주소를 그대로 쳐도 막아요(주소 전체 대소문자 없이 — 기획 17030)", () => {
  const cases: [string[], string][] = [
    [["tan@x.com · sg"], "tan@x.com"],
    [["daeun · jung@x.co.kr"], "jung@x.co.kr"],
    [["kim@x.coM"], "kim@x.co"],
    [["John · Smith@acme.com"], "Smith@acme.com"],
  ];
  for (const [lines, candidate] of cases) {
    const { chips } = card(...lines);
    assert.equal(isSuspectValue(candidate, chips), true, candidate);
    assert.equal(isSuspectValue(` ${candidate} `, chips), true, candidate);
    const at = candidate.lastIndexOf("@");
    assert.equal(isSuspectValue(candidate.slice(0, at + 1) + candidate.slice(at + 1).toUpperCase(), chips), true, `${candidate} 도메인 대문자`);
    // @ 앞 대소문자만 바꿔도 막아요(기획 17030 — 「Kim@acme.com」), 한 글자라도 다르면 풀려요
    assert.equal(isSuspectValue(candidate.slice(0, at).toUpperCase() + candidate.slice(at), chips), true, `${candidate} @ 앞 대문자`);
    assert.equal(isSuspectValue(candidate.toLowerCase(), chips), true, `${candidate} 소문자`);
    assert.equal(isSuspectValue(`x${candidate}`, chips), false, candidate);
  }
  // 고친 주소는 막지 않아요
  assert.equal(isSuspectValue("tan@x.com.sg", card("tan@x.com · sg").chips), false);
  assert.equal(isSuspectValue("daeun.jung@x.co.kr", card("daeun · jung@x.co.kr").chips), false);
  // 의심이 아닌 칩의 주소는 막지 않아요
  assert.equal(isSuspectValue("kim@x.com", card("kim@x.com T. 02-123-4567").chips), false);
});

test("UG-451 17030 ② 의심 주소는 대소문자만 바꿔도 막아요(「Kim@acme.com」)", () => {
  for (const lines of [["Sales · kim@acme.com"], ["CEO · kim@acme.com"], ["Seoul · kim@acme.com"], ["Director.", "kim@acme.com"], ["kim@acme.com | sg"], ["kim@acme.com KR"]]) {
    const { chips, values } = card(...lines);
    assert.equal(values.email, "", lines.join(" ↵ "));
    for (const v of ["kim@acme.com", "Kim@acme.com", "KIM@ACME.COM", "kim@Acme.Com", " Kim@acme.com "]) {
      assert.equal(isSuspectValue(v, chips), true, `${lines.join(" ↵ ")} · ${v}`);
    }
    assert.equal(isSuspectValue("kim@acme.co", chips), false, lines.join(" ↵ "));
  }
});

test("UG-451 17030 ③ 형식이 깨진 메일 모양 글자(@ 양옆 글자)도 메일 모양으로 봐요", () => {
  const broken = card("lena@koh sg");
  assert.equal(broken.values.email, "");
  assert.equal(broken.chips.some(isEmailLikeChip), true);
  assert.equal(card("Lena Koh", "lena@koh sg").chips.some(isEmailLikeChip), true);
  assert.equal(card("1004@naver com").chips.some(isEmailLikeChip), true);
  assert.equal(card("kim@x.com").chips.some(isEmailLikeChip), true);
  // @ 한쪽이 비었으면 메일 모양이 아니에요(@ 앞뒤 띄어쓰기는 읽을 때 붙여요 — 「a @ b」 → 「a@b」)
  for (const t of ["@acme", "acme@", "(@)", "Lena Koh"]) {
    assert.equal(card(t).chips.some(isEmailLikeChip), false, t);
  }
});

test("UG-451 17030 ④ 명함에서 채우거나 칩을 눌러 넣는 메일 주소는 전체 소문자(의심 칩은 읽은 그대로)", () => {
  const r = card("USER1+X@EXAMPLE.COM", "010-1234-5678");
  assert.equal(r.values.email, "user1+x@example.com");
  const chip = r.chips.find((c) => c.kind === "email")!;
  // 칩 글자는 읽은 그대로 보여요
  assert.equal(chip.text, "USER1+X@EXAMPLE.COM");
  // 칩을 눌러 넣어도 소문자
  const tap = tapChip(chip, {}, { company: "", name: "", email: "", phone: "" }, null);
  assert.deepEqual(tap.set, { field: "email", value: "user1+x@example.com" });
  assert.deepEqual(chipEmailAddresses(r.chips), ["user1+x@example.com"]);
  assert.equal(card("E. Kim.Lee@Acme.Co.Kr").values.email, "kim.lee@acme.co.kr");
  // 잘렸을 수 있는 칩은 읽은 그대로 넣어요(명함과 견줘 고치게)
  const suspect = card("Sales · Kim@Acme.com");
  const sc = suspect.chips.find(isSuspectChip)!;
  const st = tapChip(sc, {}, { company: "", name: "", email: "", phone: "" }, null);
  assert.equal(st.set?.value, sc.value);
  assert.notEqual(st.set?.value, st.set?.value.toLowerCase());
});

test("UG-451 반박 리뷰 M1 · 소문자로 넣은 주소의 헷갈리는 글자는 칩이 읽은 그대로로 판단 · 강조해요", () => {
  const marks = (n: ReturnType<typeof confusableNote>) => n.parts.filter((p) => p.confusable).map((p) => p.text).join("");
  for (const [read, chars] of [
    ["Iee77@x.com", "i"],
    ["yoon.jI0110@x.com", "i0110"],
    ["kimO1@x.com", "o1"],
  ] as const) {
    const { values, chips } = card(read);
    const value = values.email;
    assert.equal(value, read.toLowerCase(), read);
    const chip = chips.find((c) => c.kind === "email")!;
    const note = confusableNote(value, chip.value);
    assert.equal(note.confusable, true, read);
    // 보여 주는 글자는 칸 값(소문자) 그대로, 강조 위치는 읽은 글자 기준
    assert.equal(note.parts.map((p) => p.text).join(""), value, read);
    assert.equal(marks(note), chars, read);
  }
  // 소문자 값만 보면 I 가 빠져 안내가 없어요 — 직원이 친 값(read 없음 · 다른 값)은 칸 값 그대로 판단
  assert.equal(confusableNote("iee77@x.com").confusable, false);
  assert.equal(confusableNote("iee78@x.com", "Iee77@x.com").confusable, false);
  assert.equal(marks(confusableNote("kimo1@x.com")), "1");
  assert.equal(confusableNote("rachel@x.com", "Rachel@x.com").confusable, false);
});
