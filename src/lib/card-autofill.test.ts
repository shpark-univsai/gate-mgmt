// 회사명 · 이름 자동 채움(UG-451 기획 17100) · 못 읽은 명함 판정(기획 17106 — 파일 뒤쪽) · 반박 리뷰 재현 표본 시험 — card-scan.ts 의 scanCard(글자, 줄 점수).
// 예시 값은 모두 지어낸 것이에요(공개 저장소 — 실제 고객 · 회사 · 이름 · 번호 금지).
import assert from "node:assert/strict";
import { test } from "node:test";

import { isSettled, needsRetry, pickReading, type ReadingScore } from "./card-rotate.ts";
import { COMPANY_FILL_CONF, NAME_FILL_CONF, emailDomainName, scanCard, type OcrLine } from "./card-scan.ts";

/** 명함 한 줄 — 글자만(점수 93), [글자, 줄 점수], [글자, 줄 점수, {낱말: 점수}] */
type Line = string | [string, number] | [string, number, Record<string, number>];

const GOOD = 95;

/** 지어낸 명함 줄 → 글자 읽기 도구가 준 모양(글자 · 줄 · 낱말 점수)으로 읽은 결과 */
function read(...lines: Line[]) {
  const rows = lines.map((l) => (typeof l === "string" ? ([l, GOOD, {}] as const) : ([l[0], l[1], l[2] ?? {}] as const)));
  const ocr: OcrLine[] = rows.map(([text, confidence, per]) => ({
    text: `${text}\n`,
    confidence,
    words: text.split(" ").map((w) => ({ text: w, confidence: per[w] ?? confidence })),
  }));
  return scanCard(rows.map(([text]) => text).join("\n"), ocr);
}

/**
 * 표본 — truth = 명함에 실제로 적힌 회사명 · 이름(없으면 ""), fill = 채워야 하는 값("" = 비워야 함).
 * 목표는 「틀리게 채움 0」 — 채운 값은 truth 와 같아야 하고, 애매한 명함은 비워요.
 */
type Sample = { name: string; lines: Line[]; truth: { company: string; name: string }; fill: { company: string; name: string }; korean?: boolean };

const SAMPLES: Sample[] = [
  {
    name: "한글 명함 — 법인 표시 · 이름 · 직함(따로 줄)",
    lines: ["주식회사 가나다테크", "김민수", "팀장", "M. 010-1234-5678", "E. minsu.kim@ganadatech.co.kr", "서울특별시 강남구 테헤란로 1"],
    truth: { company: "주식회사 가나다테크", name: "김민수" },
    fill: { company: "주식회사 가나다테크", name: "김민수" },
    korean: true,
  },
  {
    name: "홀로 있는 이름이 조직 · 장소 끝말(동 · 원 · 도 …)로 끝남 — 장소 낱말과 가를 수 없어 비움",
    lines: ["주식회사 가나다테크", "홍길동", "팀장", "M. 010-1234-5678", "E. gildong.hong@ganadatech.co.kr"],
    truth: { company: "주식회사 가나다테크", name: "홍길동" },
    fill: { company: "주식회사 가나다테크", name: "" },
    korean: true,
  },
  {
    name: "같은 이름도 직함이 붙은 줄이면 채움(홍길동 팀장 · 이지원 과장)",
    lines: ["주식회사 가나다테크", "홍길동 팀장", "M. 010-1234-5678", "E. gildong.hong@ganadatech.co.kr"],
    truth: { company: "주식회사 가나다테크", name: "홍길동" },
    fill: { company: "주식회사 가나다테크", name: "홍길동" },
    korean: true,
  },
  {
    name: "한글 명함 — (주) · 이름과 직함이 한 줄 · 부서 줄",
    lines: ["(주)한빛물산", "박서준 과장", "영업팀", "T. 02-123-4567", "sj.park@hanbit-trade.co.kr"],
    truth: { company: "(주)한빛물산", name: "박서준" },
    fill: { company: "(주)한빛물산", name: "박서준" },
    korean: true,
  },
  {
    name: "한글 명함 — 이름 | 직함 | 번호가 한 줄",
    lines: ["㈜새봄상사", "최지우 | 팀장 | 010-2345-6789", "jiwoo@saebom-corp.kr"],
    truth: { company: "㈜새봄상사", name: "최지우" },
    fill: { company: "㈜새봄상사", name: "최지우" },
    korean: true,
  },
  {
    name: "한글 · 영어 이름이 함께 — 한글 이름을 채우고, 법인명이 둘이면 회사명은 비움",
    lines: ["김민수", "Kim Minsu", "가나다 주식회사", "Ganada Co., Ltd.", "minsu@ganada.co.kr", "010-1234-5678"],
    truth: { company: "가나다 주식회사", name: "김민수" },
    fill: { company: "", name: "김민수" },
    korean: true,
  },
  {
    name: "띄어 쓴 한글 이름",
    lines: ["주식회사 다온물류", "정 다 은", "대리", "daeun.jung@daon-logis.co.kr", "010-3456-7890"],
    truth: { company: "주식회사 다온물류", name: "정다은" },
    fill: { company: "주식회사 다온물류", name: "정다은" },
    korean: true,
  },
  {
    name: "두 글자 성씨의 네 글자 이름",
    lines: ["주식회사 하늘소프트", "남궁민수 책임", "minsu@haneul-soft.co.kr", "010-4567-8901"],
    truth: { company: "주식회사 하늘소프트", name: "남궁민수" },
    fill: { company: "주식회사 하늘소프트", name: "남궁민수" },
    korean: true,
  },
  {
    name: "영문 명함(싱가포르식 Pte. Ltd.)",
    lines: [
      "BluePeak Logistics Pte. Ltd.",
      "Tan Wei Ling",
      "Regional Sales Manager",
      "M +65 9123 4567",
      "weiling.tan@bluepeak.com.sg",
      "1 Harbour Road #12-01 Singapore 123456",
    ],
    truth: { company: "BluePeak Logistics Pte. Ltd.", name: "Tan Wei Ling" },
    fill: { company: "BluePeak Logistics Pte. Ltd.", name: "Tan Wei Ling" },
    korean: false,
  },
  {
    name: "영문 명함 — 법인 표시 없음 · 이메일 도메인과 같은 이름",
    lines: ["Northwind Analytics", "Daniel Tan", "Head of Data", "daniel.tan@northwind-analytics.com", "+65 6123 4567", "www.northwind-analytics.com"],
    truth: { company: "Northwind Analytics", name: "Daniel Tan" },
    fill: { company: "Northwind Analytics", name: "Daniel Tan" },
    korean: false,
  },
  {
    name: "영문 명함 — 로고 글자 한 줄이 도메인과 같음",
    lines: ["BLUEPEAK", "Marcus Wong", "Operations", "marcus.wong@bluepeak.com.sg", "+65 8123 4567"],
    truth: { company: "BLUEPEAK", name: "Marcus Wong" },
    fill: { company: "BLUEPEAK", name: "Marcus Wong" },
  },
  {
    name: "영문 명함 — Inc. · 이름 뒤 쉼표 직함",
    lines: ["Acme Robotics Inc.", "Rachel Lim, Director", "rachel@acme-robotics.com", "+1 415-555-0132"],
    truth: { company: "Acme Robotics Inc.", name: "Rachel Lim" },
    fill: { company: "Acme Robotics Inc.", name: "Rachel Lim" },
  },
  {
    name: "영문 명함 — 성이 Ng · 전부 대문자 이름",
    lines: ["Lumen Works Corp.", "NG WEI JIE", "weijie.ng@lumenworks.com", "+65 9234 5678"],
    truth: { company: "Lumen Works Corp.", name: "NG WEI JIE" },
    fill: { company: "Lumen Works Corp.", name: "NG WEI JIE" },
  },
  {
    name: "공용 메일 도메인 — 회사명 근거로 쓰지 않음",
    lines: ["Lena Koh", "Freelance Designer", "Koh Studio", "lena.koh@gmail.com", "9123 4567"],
    truth: { company: "Koh Studio", name: "Lena Koh" },
    fill: { company: "", name: "Lena Koh" },
  },
  {
    name: "공용 메일 도메인(naver) — 도메인과 같은 낱말 줄이 있어도 회사명 아님",
    lines: ["Naver Cafe Lovers", "윤하늘", "haneul@naver.com", "010-5678-9012"],
    truth: { company: "", name: "윤하늘" },
    fill: { company: "", name: "윤하늘" },
  },
  {
    name: "직함만 있는 명함 — 이름 줄 없음",
    lines: ["Acme Trading Co., Ltd.", "Sales Manager", "Key Account", "sales@acme-trading.com", "02-555-0100"],
    truth: { company: "Acme Trading Co., Ltd.", name: "" },
    fill: { company: "Acme Trading Co., Ltd.", name: "" },
  },
  {
    name: "직함만 있는 한글 명함",
    lines: ["주식회사 누리봄", "대표이사", "경영지원", "ceo@nuribom.co.kr", "02-555-0101"],
    truth: { company: "주식회사 누리봄", name: "" },
    fill: { company: "주식회사 누리봄", name: "" },
  },
  {
    name: "한글 이름 후보가 둘",
    lines: ["주식회사 가람", "김민수", "이서연", "minsu@garam.co.kr", "010-6789-0123"],
    truth: { company: "주식회사 가람", name: "김민수" },
    fill: { company: "주식회사 가람", name: "" },
  },
  {
    name: "법인 표시 줄이 둘(한글 · 영문 법인명)",
    lines: ["주식회사 가람", "Garam Inc.", "김민수", "minsu@garam.co.kr", "010-6789-0123"],
    truth: { company: "주식회사 가람", name: "김민수" },
    fill: { company: "", name: "김민수" },
  },
  {
    name: "글자 인식 점수가 낮은 회사명 · 이름 줄 — 이름을 맞춰 볼 이메일이 없으면(대표 메일함) 비움",
    lines: [["주식회사 가나다테크", 62], ["김민수", 55], "M. 010-1234-5678", "contact@ganadatech.co.kr"],
    truth: { company: "주식회사 가나다테크", name: "김민수" },
    fill: { company: "", name: "" },
    korean: true,
  },
  {
    name: "기획 17118-3 — 점수가 낮은 한글 이름도 이메일 @ 앞과 맞으면 채움(회사명은 그대로 비움)",
    lines: [["주식회사 가나다테크", 62], ["김민수", 55], "M. 010-1234-5678", "minsu.kim@ganadatech.co.kr"],
    truth: { company: "주식회사 가나다테크", name: "김민수" },
    fill: { company: "", name: "김민수" },
    korean: true,
  },
  {
    name: "줄 점수는 높아도 낱말 하나의 점수가 낮음(틀린 글자가 섞였을 수 있음)",
    lines: [["BluePeak Logistics Pte. Ltd.", 93, { Logistics: 61 }], ["Tan Wei Ling", 93, { Wei: 70 }], "weiling.tan@bluepeak.com.sg", "+65 9123 4567"],
    truth: { company: "BluePeak Logistics Pte. Ltd.", name: "Tan Wei Ling" },
    fill: { company: "", name: "" },
  },
  {
    name: "깨진 글자 — 한글 이름을 로마자로 잘못 읽음 · 깨진 줄",
    lines: [["Sau TH", 41], ["은 이아7 났", 38], ["SRT $e ud an 헤르 PIE AR", 35], "주식회사 가나다테크", "gildong.hong@ganadatech.co.kr", "010-1234-5678"],
    truth: { company: "주식회사 가나다테크", name: "홍길동" },
    fill: { company: "주식회사 가나다테크", name: "" },
  },
  {
    name: "줄 끝 잡글자(점수 낮은 조각)는 떼고 채움 — 「를 0」",
    lines: [["주식회사 한빛테크를 0", 71, { 주식회사: 94, 한빛테크를: 92, "0": 31 }], "서하준", "hajun@hanbit-tech.co.kr", "010-7890-1234"],
    truth: { company: "주식회사 한빛테크", name: "서하준" },
    fill: { company: "주식회사 한빛테크", name: "서하준" },
  },
  {
    name: "줄 끝 기호 · 토막",
    lines: [["Acme Robotics Inc. ~ ud", 60, { Acme: 92, Robotics: 90, "Inc.": 91, "~": 20, ud: 25 }], ["Rachel Lim ㅣ", 70, { Rachel: 93, Lim: 90, ㅣ: 30 }], "rachel@acme-robotics.com", "+1 415-555-0132"],
    truth: { company: "Acme Robotics Inc.", name: "Rachel Lim" },
    fill: { company: "Acme Robotics Inc.", name: "Rachel Lim" },
  },
  {
    name: "줄 끝 한 글자의 점수가 높음 — 이름의 일부일 수 있어 비움",
    lines: ["주식회사 채널 A", "문가을", "gaeul@channel-a.co.kr", "010-8901-2345"],
    truth: { company: "주식회사 채널 A", name: "문가을" },
    fill: { company: "", name: "문가을" },
  },
  {
    name: "법인 표시 줄에 직함 · 이름이 함께(한 줄)",
    lines: ["주식회사 가람 대표이사 김민수", "minsu@garam.co.kr", "010-6789-0123"],
    truth: { company: "주식회사 가람", name: "김민수" },
    fill: { company: "", name: "" },
  },
  {
    name: "법인 표시가 든 한 줄 꼬리말(주소 · 번호)",
    lines: ["주식회사 가람 서울시 강남구 테헤란로 123", "김민수", "minsu@garam.co.kr", "010-6789-0123"],
    truth: { company: "주식회사 가람", name: "김민수" },
    fill: { company: "", name: "김민수" },
  },
  {
    name: "이름 같은 직함 · 지명 줄(Sales Manager · Hong Kong · Marina Bay)",
    lines: ["Lumen Works Corp.", "Sales Manager", "Hong Kong", "Marina Bay", "info@lumenworks.com", "+852 2123 4567"],
    truth: { company: "Lumen Works Corp.", name: "" },
    fill: { company: "Lumen Works Corp.", name: "" },
  },
  {
    name: "이메일이 뒷받침하지 않는 영어 두 낱말 줄(이름 줄을 못 읽은 명함의 상호)",
    lines: ["Golden Dragon", "info@gd-foods.com", "+65 6234 5678"],
    truth: { company: "Golden Dragon", name: "" },
    fill: { company: "", name: "" },
  },
  {
    name: "성씨 글자로 시작하는 세 글자 한글 상호 + 영어 이름 — 상호도 이름 후보로 세어, 어느 쪽이 이름인지 몰라 비움",
    lines: ["이노벨", "Tan Wei Ling", "weiling.tan@innobell.sg", "+65 9345 6789"],
    truth: { company: "이노벨", name: "Tan Wei Ling" },
    fill: { company: "", name: "" },
  },
  {
    name: "이름 모양의 한글 상호 + 영어 이름(성씨 표기가 다름) — 어느 쪽이 이름인지 몰라 비움",
    lines: ["한서진", "Tan Wei Ling", "weiling.tan@hanseojin.sg", "+65 9345 6789"],
    truth: { company: "한서진", name: "Tan Wei Ling" },
    fill: { company: "", name: "" },
  },
  {
    name: "개인 도메인(이름과 같은 도메인) — 회사명 · 이름 모두 비움",
    lines: ["Tan Wei Ling", "hello@tanweiling.com", "+65 9456 7890"],
    truth: { company: "", name: "Tan Wei Ling" },
    fill: { company: "", name: "" },
  },
  {
    name: "도메인 이름을 띄어 쓴 두 낱말 상호(이름 모양) — 비움",
    lines: ["Blue Peak", "Marcus Wong", "marcus.wong@bluepeak.com.sg", "+65 8123 4567"],
    truth: { company: "Blue Peak", name: "Marcus Wong" },
    fill: { company: "", name: "Marcus Wong" },
  },
  {
    name: "도메인 이름이 든 줄이 둘(로고 · 상호)",
    lines: ["BLUEPEAK", "BluePeak Logistics", "Marcus Wong", "marcus.wong@bluepeak.com.sg", "+65 8123 4567"],
    truth: { company: "BluePeak Logistics", name: "Marcus Wong" },
    fill: { company: "", name: "Marcus Wong" },
  },
  {
    name: "의심 주소로 이메일을 비운 명함 — 도메인 근거를 쓰지 않음",
    lines: ["Miraero Logis", "정다은", "daeun jung@miraero-logis.co.kr", "M. 010-1234-5678"],
    truth: { company: "Miraero Logis", name: "정다은" },
    // 영어 두 낱말 줄(상호)이 이름 모양이라, 한글 이름과 같은 사람인지(성씨 표기) 확인되지 않아 이름도 비워요
    fill: { company: "", name: "" },
  },
  {
    name: "두 글자 이름 + 직함 — 채우지 않음",
    lines: ["주식회사 가람", "김민 대리", "min@garam.co.kr", "010-6789-0123"],
    truth: { company: "주식회사 가람", name: "김민" },
    fill: { company: "주식회사 가람", name: "" },
  },
  {
    name: "성씨 글자로 시작하지만 이름이 아닌 낱말(연락처 · 기술지원 · 서비스)",
    lines: ["주식회사 가람", "연락처", "기술지원", "서비스", "help@garam.co.kr", "02-555-0102"],
    truth: { company: "주식회사 가람", name: "" },
    fill: { company: "주식회사 가람", name: "" },
  },
  {
    name: "성씨로 시작하지 않는 한글 낱말(상호 · 직무) + 이름",
    lines: ["카라멜", "디자인", "한지민", "jimin@caramel-design.kr", "010-9012-3456"],
    truth: { company: "카라멜", name: "한지민" },
    fill: { company: "", name: "한지민" },
  },
  {
    name: "영문 명함의 한글 주소 한 줄 — 한글 명함 아님",
    lines: ["Acme Robotics Inc.", "Rachel Lim", "Engineering Lead", "서울시 강남구 테헤란로 1", "rachel@acme-robotics.com", "+65 9123 4567"],
    truth: { company: "Acme Robotics Inc.", name: "Rachel Lim" },
    fill: { company: "Acme Robotics Inc.", name: "Rachel Lim" },
    korean: false,
  },
  {
    name: "기획 17118-2 — 같은 영문 명함도 연락처가 +82 면 메일 언어는 한국어",
    lines: ["Acme Robotics Inc.", "Rachel Lim", "Engineering Lead", "서울시 강남구 테헤란로 1", "rachel@acme-robotics.com", "+82 10-1234-5678"],
    truth: { company: "Acme Robotics Inc.", name: "Rachel Lim" },
    fill: { company: "Acme Robotics Inc.", name: "Rachel Lim" },
    korean: true,
  },
];

test("UG-451 17100 표본 — 틀리게 채우는 경우 0, 채울 값 · 비울 값이 정한 그대로", (t) => {
  let right = 0;
  let wrong = 0;
  let blank = 0;
  for (const s of SAMPLES) {
    const r = read(...s.lines);
    for (const field of ["company", "name"] as const) {
      const got = r.values[field];
      if (got === "") blank++;
      else if (got === s.truth[field]) right++;
      else wrong++;
      assert.equal(got, s.fill[field], `${s.name} — ${field}`);
      // 채운 칸은 그 줄의 칩과 이어져요(「칸에 들어간 줄은 진한 칩」), 비운 칸은 이어진 칩이 없어요
      assert.equal(r.links[field] !== undefined, got !== "", `${s.name} — ${field} 칩 연결`);
    }
    if (s.korean !== undefined) assert.equal(r.korean, s.korean, `${s.name} — 한글 명함`);
  }
  t.diagnostic(`표본 ${SAMPLES.length}장 · 칸 ${SAMPLES.length * 2}개: 맞게 채움 ${right} · 비움 ${blank} · 틀리게 채움 ${wrong}`);
  assert.equal(wrong, 0);
});

test("UG-451 17100 점수를 모르면(도구가 줄 점수를 주지 않음) 회사명 · 이름은 채우지 않아요 — 이메일 · 연락처는 전처럼", () => {
  const text = ["주식회사 가나다테크", "김민수", "M. 010-1234-5678", "minsu.kim@ganadatech.co.kr"].join("\n");
  for (const r of [scanCard(text), scanCard(text, null)]) {
    assert.equal(r.values.company, "");
    assert.equal(r.values.name, "");
    assert.equal(r.values.email, "minsu.kim@ganadatech.co.kr");
    assert.equal(r.values.phone, "010-1234-5678");
    // 메일 언어는 채운 이메일(.kr) · 연락처(010)로 골라요(기획 17118-2) — 점수가 없어도
    assert.equal(r.korean, true);
  }
});

test("UG-451 17100 점수 기준 — 낱말이 모두 기준 이상일 때만 채워요(이름 · 회사명 기준은 따로)", () => {
  // 이름을 맞춰 볼 수 없는 이메일(대표 메일함)일 때 — 맞춰 볼 수 있으면 점수가 낮아도 채워요(기획 17118-3, 아래 시험)
  const card = (company: number, name: number, email = "contact@ganadatech.co.kr") =>
    read(["주식회사 가나다테크", company], ["김민수", name], "010-1234-5678", email).values;
  assert.equal(card(COMPANY_FILL_CONF, NAME_FILL_CONF).company, "주식회사 가나다테크");
  assert.equal(card(COMPANY_FILL_CONF, NAME_FILL_CONF).name, "김민수");
  assert.equal(card(COMPANY_FILL_CONF - 1, NAME_FILL_CONF).company, "");
  assert.equal(card(COMPANY_FILL_CONF, NAME_FILL_CONF - 1).name, "");
  assert.equal(card(COMPANY_FILL_CONF, NAME_FILL_CONF - 1, "minsu.kim@ganadatech.co.kr").name, "김민수");
  // 회사명은 이메일과 맞춰 보지 않아요 — 점수가 낮으면 그대로 비워요
  assert.equal(card(COMPANY_FILL_CONF - 1, NAME_FILL_CONF - 1, "minsu.kim@ganadatech.co.kr").company, "");
});

test("UG-451 반박 리뷰 2 — 틀리게 읽은 이름이 낱말 점수 80대로 나와도 채우지 않아요(「박서준」 → 「박서순」 · 박 93 · 서 93 · 순 87)", () => {
  const r = scanCard(["(주)한빛물산", "박서순 과장", "010-2345-6789", "sj.park@hanbit-trade.co.kr"].join("\n"), [
    { text: "(주)한빛물산\n", confidence: 94, words: [{ text: "(주)한빛물산", confidence: 94 }] },
    {
      text: "박서순 과장\n",
      confidence: 91,
      words: [
        { text: "박", confidence: 93 },
        { text: "서", confidence: 93 },
        { text: "순", confidence: 87 },
        { text: "과장", confidence: 95 },
      ],
    },
    { text: "010-2345-6789\n", confidence: 92, words: [{ text: "010-2345-6789", confidence: 92 }] },
    { text: "sj.park@hanbit-trade.co.kr\n", confidence: 91, words: [{ text: "sj.park@hanbit-trade.co.kr", confidence: 91 }] },
  ]);
  assert.equal(r.values.name, "");
  assert.ok(NAME_FILL_CONF >= 90);
});

test("UG-451 17100 규칙 2 — 잡글자는 칸에 채울 때만 떼고 칩은 읽은 그대로", () => {
  const r = read(["주식회사 한빛테크를 0", 71, { 주식회사: 94, 한빛테크를: 92, "0": 31 }], "서하준", "hajun@hanbit-tech.co.kr", "010-7890-1234");
  assert.equal(r.values.company, "주식회사 한빛테크");
  const chip = r.chips.find((c) => c.id === r.links.company);
  assert.equal(chip?.text, "주식회사 한빛테크를 0");
  // 법인 표시의 마침표 · (주)는 떼지 않아요
  for (const line of ["Acme Robotics Co., Ltd.", "Acme Robotics Inc.", "Acme Robotics Pte. Ltd.", "한빛테크 (주)", "한빛테크 ㈜"]) {
    assert.equal(read(line, "서하준", "hajun@hanbit-tech.co.kr", "010-7890-1234").values.company, line, line);
  }
  // 대문자 두 글자 · 숫자 두 자리로 끝나는 이름은 조각이 아니에요
  for (const line of ["주식회사 한빛 AI", "주식회사 카페 24"]) {
    assert.equal(read(line, "서하준", "hajun@hanbit-tech.co.kr", "010-7890-1234").values.company, line, line);
  }
  // 뗄 조각의 점수를 모르거나(낱말을 맞추지 못함) 조각이 넷 이상이면 채우지 않아요
  assert.equal(read(["주식회사 한빛테크 a b c d", 60, { 주식회사: 94, 한빛테크: 92, a: 20, b: 20, c: 20, d: 20 }], "hajun@hanbit-tech.co.kr", "010-7890-1234").values.company, "");
});

test("UG-451 17100 이메일 도메인의 등록 이름 — 공용 메일 · 짧은 이름은 쓰지 않아요", () => {
  assert.equal(emailDomainName("kim@bluepeak.com.sg"), "bluepeak");
  assert.equal(emailDomainName("lee@mail.company-a.co.kr"), "company-a");
  assert.equal(emailDomainName("user1@example.io"), "example");
  for (const email of [
    "a@gmail.com",
    "a@naver.com",
    "a@daum.net",
    "a@hanmail.net",
    "a@kakao.com",
    "a@outlook.com",
    "a@hotmail.com",
    "a@yahoo.co.kr",
    "a@icloud.com",
    "a@me.com",
    "a@lg.com",
    "no-at-sign",
  ]) {
    assert.equal(emailDomainName(email), null, email);
  }
});

test("UG-451 17100 규칙 6 — 한글 명함 판정", () => {
  // 채운 이름이 한글
  assert.equal(read("Acme Robotics Inc.", "김민수", "minsu@acme-robotics.com", "010-1234-5678").korean, true);
  // 이름은 못 채웠어도 또렷한 글자 줄의 절반 이상이 한글
  assert.equal(read("가나다테크", "기술연구소 책임연구원", "www.ganadatech.co.kr", "info@ganadatech.co.kr", "02-555-0100").korean, true);
  // 한글 줄이 하나뿐 · 점수 낮은 한글 줄은 세지 않아요
  assert.equal(read("Acme Robotics Inc.", "Engineering Lead", "서울시 강남구", "info@acme-robotics.com", "02-555-0100").korean, false);
  assert.equal(read(["가나다테크 영업본부", 50], ["기술연구소 책임연구원", 45], "info@ganadatech.com", "02-555-0100").korean, false);
});

test("UG-451 기획 17118-2 — 메일 언어: 채운 회사명 · 이름에 한글, 그 밖에는 이메일 .kr · 연락처 010 · +82", () => {
  // 기획이 본 경우 — 회사명은 한글로 채워졌는데 이름 줄의 점수가 낮아 이름을 못 채움(또렷한 한글 줄이 회사명 하나뿐). 전에는 English 였어요
  const low = { 온: 71, 서: 93, 윤: 84 };
  const planner = read("주식회사 푸른별미디어", ["온서윤", 80, low], "hello@pureunbyeol-media.com", "+65 6123 4567");
  assert.equal(planner.values.company, "주식회사 푸른별미디어");
  assert.equal(planner.values.name, "");
  assert.equal(planner.korean, true);
  const marked = read("(주)새솔소프트웨어", ["문지후 과장", 74, { 과장: 20 }], "hello@saesol-soft.com", "+65 6123 4567");
  assert.equal(marked.values.company, "(주)새솔소프트웨어");
  assert.equal(marked.korean, true);
  // 한글을 채우지 못했어도 이메일이 .kr 로 끝나거나(대소문자 없이) 연락처가 010 · +82 로 시작하면 한국어
  const english = (email: string, phone: string) => read("Acme Robotics Inc.", ["Engineering Lead", 93], email, phone);
  assert.equal(english("info@acme-robotics.co.kr", "+65 6123 4567").korean, true);
  assert.equal(english("info@acme-robotics.kr", "+65 6123 4567").korean, true);
  assert.equal(english("INFO@ACME-ROBOTICS.CO.KR", "+65 6123 4567").korean, true);
  assert.equal(english("info@acme-robotics.com", "010-5555-0142").korean, true);
  assert.equal(english("info@acme-robotics.com", "M. 010 5555 0142").korean, true);
  assert.equal(english("info@acme-robotics.com", "+82 10 5555 0142").korean, true);
  assert.equal(english("info@acme-robotics.com", "+82-2-555-0142").korean, true);
  // 그 밖에는 처음 값(English) — .kr 이 가운데에만 있는 주소 · 02 번호 · 다른 나라 번호 · 82 로 시작하는 싱가포르 번호
  assert.equal(english("info@acme-robotics.com", "02-555-0142").korean, false);
  assert.equal(english("info@acme.kr.example.com", "+65 6123 4567").korean, false);
  assert.equal(english("info@acme-robotics.com.sg", "8210 5550").korean, false);
  assert.equal(english("info@krobotics.com", "+65 8201 0555").korean, false);
  // 잘렸을 수 있어 이메일 칸을 비웠어도 읽은 메일 줄의 주소가 .kr 이면 한국어(칸은 비어 있어요)
  const cut = read("Acme Robotics Inc.", ["Engineering Lead", 93], "seoyun · on@acme-robotics.co.kr", "+65 6123 4567");
  assert.equal(cut.values.email, "");
  assert.equal(cut.korean, true);
  // 팩스 번호(채우지 않는 번호)는 보지 않아요
  assert.equal(english("info@acme-robotics.com", "F. 010-5555-0142").korean, false);
  // 못 읽은 명함은 언어를 고르지 않아요(한글 줄이 또렷해도)
  const unreadable = read("주식회사 푸른별미디어", "온서윤 과장", "서울시 가상구 예시로 1");
  assert.equal(unreadable.outcome, "unreadable");
  assert.equal(unreadable.korean, false);
});

test("UG-451 기획 17118-3 — 점수가 낮은 한글 이름: 이메일 @ 앞 · 영문 이름 줄과 맞을 때만 채워요", () => {
  // 기획이 본 두 경우 — 직함이 붙은 이름 줄 · 홀로 있는 이름 줄, 글자는 맞게 읽었지만 낱말 점수가 90 아래
  const titled = (email: string, ...more: Line[]) =>
    read("주식회사 푸른별미디어", ["문지후 과장", 81, { 문지후: 84, 과장: 62 }], ...more, email, "010-5555-0142").values.name;
  const alone = (email: string, ...more: Line[]) =>
    read("주식회사 푸른별미디어", ["한서윤", 72, { 한서윤: 72 }], ...more, email, "010-5555-0142").values.name;
  // 이메일 @ 앞 — 이름.성 · 성.이름 · 붙여 씀 · 하이픈 · 숫자 · 성 이니셜 + 이름 · 이름 + 성 이니셜, 표기 변형(moon · mun, jihu · jihoo, seoyun · seoyoon · suhyun 아님)
  for (const email of ["jihu.moon@pureunbyeol-media.co.kr", "moon.jihu@pureunbyeol-media.co.kr", "jihumoon@pureunbyeol-media.co.kr", "ji-hu.moon@pureunbyeol-media.co.kr", "jihoo_mun85@pureunbyeol-media.co.kr", "mjihu@pureunbyeol-media.co.kr", "jihum@pureunbyeol-media.co.kr", "JIHU.MOON@PUREUNBYEOL-MEDIA.CO.KR"]) {
    assert.equal(titled(email), "문지후", email);
  }
  for (const email of ["seoyun.han@pureunbyeol-media.co.kr", "han.seoyoon@pureunbyeol-media.co.kr", "hseoyun@pureunbyeol-media.co.kr"]) {
    assert.equal(alone(email), "한서윤", email);
  }
  // 한 음절이 다른 이름(서연)의 주소는 근거가 아니에요
  assert.equal(alone("seoyeon.han@pureunbyeol-media.co.kr"), "");
  // 공용 메일이어도 @ 앞이 이름이면 근거예요
  assert.equal(alone("seoyun.han@gmail.com"), "한서윤");
  // 맞춰 볼 수 없으면 전처럼 비워요 — 대표 메일함 · 이름만 · 성씨만 · 이니셜만 · 이름 이니셜 + 성 · 다른 사람 이름
  for (const email of ["hello@pureunbyeol-media.co.kr", "jihu@pureunbyeol-media.co.kr", "moon@pureunbyeol-media.co.kr", "jm@pureunbyeol-media.co.kr", "mjh@pureunbyeol-media.co.kr", "jh.moon@pureunbyeol-media.co.kr", "jihun.moon@pureunbyeol-media.co.kr", "jiho.moon@pureunbyeol-media.co.kr", "jihu.min@pureunbyeol-media.co.kr"]) {
    assert.equal(titled(email), "", email);
  }
  // 영문 이름 줄 — 성이 앞이든 뒤든, 대문자 · 하이픈 · 띄어 쓴 이름. 이메일은 맞춰 볼 수 없는 주소
  for (const en of ["Jihu Moon", "Moon Jihu", "MOON Jihu", "Moon Ji-hu", "Ji Hu Moon", "JIHOO MUN"]) {
    assert.equal(titled("hello@pureunbyeol-media.co.kr", en), "문지후", en);
  }
  // 성씨만 맞는 영문 이름 줄(다른 이름)은 근거가 아니에요 — 높은 점수면 전처럼 채우지만(성씨가 맞는 영문 줄) 낮은 점수는 비워요
  assert.equal(titled("hello@pureunbyeol-media.co.kr", "Jihun Moon"), "");
  assert.equal(titled("hello@pureunbyeol-media.co.kr", "Mina Moon"), "");
  // 잘렸을 수 있어 비운 이메일은 근거로 쓰지 않아요(영문 이름 줄은 근거가 돼요)
  assert.equal(titled("jihu · moon@pureunbyeol-media.co.kr"), "");
  assert.equal(titled("jihu · moon@pureunbyeol-media.co.kr", "Jihu Moon"), "문지후");
  // 점수가 아주 낮아도(하한 없음) 모든 음절이 맞으면 채워요 — 직함 낱말의 점수는 이름과 상관없어요
  assert.equal(read("주식회사 푸른별미디어", ["문지후 과장", 40, { 문지후: 31, 과장: 20 }], "jihu.moon@pureunbyeol-media.co.kr", "010-5555-0142").values.name, "문지후");
  // 채운 이름은 그 줄의 칩과 이어져요
  const r = read("주식회사 푸른별미디어", ["문지후 과장", 81, { 문지후: 84 }], "jihu.moon@pureunbyeol-media.co.kr", "010-5555-0142");
  assert.equal(r.chips.find((c) => c.id === r.links.name)?.text, "문지후 과장");
  // 줄의 점수를 모르면(도구가 주지 않음) 전처럼 채우지 않아요
  assert.equal(scanCard(["주식회사 푸른별미디어", "문지후 과장", "jihu.moon@pureunbyeol-media.co.kr", "010-5555-0142"].join("\n")).values.name, "");
});

test("UG-451 기획 17118-3 — 틀리게 읽은 이름은 이메일과 한 음절이라도 어긋나 채워지지 않아요(「박서준」 → 「박서순」 + seojun.park@)", () => {
  const misread = (name: string, email: string, ...more: Line[]) =>
    read("(주)한빛물산", [`${name} 과장`, 88, { [name]: 87 }], ...more, email, "010-2345-6789").values.name;
  assert.equal(misread("박서준", "seojun.park@hanbit-trade.co.kr"), "박서준");
  // 읽힌 한글 그대로의 로마자로 대조해요 — 준 ↔ 순 · 춘, 서 ↔ 세 · 사, 박 ↔ 방
  for (const wrong of ["박서순", "박서춘", "박세준", "박사준", "방서준", "박서중"]) {
    assert.equal(misread(wrong, "seojun.park@hanbit-trade.co.kr"), "", wrong);
    assert.equal(misread(wrong, "contact@hanbit-trade.co.kr", "Seojun Park"), "", `${wrong} — 영문 이름 줄`);
  }
  // 모양이 비슷해 서로 잘못 읽히는 글자끼리는 같은 표기가 되지 않아요 — 태 ↔ 대 · 필 ↔ 빌 · 재 ↔ 제 · 은 ↔ 운 · 휘 ↔ 희 · 현 ↔ 헌 · 영 ↔ 엉
  assert.equal(misread("박대윤", "taeyoon.park@hanbit-trade.co.kr"), "");
  assert.equal(misread("박제윤", "jaeyoon.park@hanbit-trade.co.kr"), "");
  assert.equal(misread("박지운", "jieun.park@hanbit-trade.co.kr"), "");
  assert.equal(misread("박지은", "jiun.park@hanbit-trade.co.kr"), "");
  assert.equal(misread("박지휘", "jihee.park@hanbit-trade.co.kr"), "");
  assert.equal(misread("박지헌", "jihyun.park@hanbit-trade.co.kr"), "");
  // 틀리게 읽힌 성씨도 — 성 이니셜 꼴(j + 이름)은 첫 글자만 봐요(받아들인 것: 정 ↔ 장 은 이니셜이 같아요)
  assert.equal(misread("방서준", "pseojun@hanbit-trade.co.kr"), "");
  assert.equal(misread("김서준", "pseojun@hanbit-trade.co.kr"), "");
});

test("UG-451 17100 도구의 낱말이 띄어쓰기와 달라도(한글을 낱자 · 토막으로 나눠 줌) 점수를 맞춰 봐요", () => {
  const line = (text: string, words: [string, number][], confidence = 90): OcrLine => ({
    text: `${text}\n`,
    confidence,
    words: words.map(([t, c]) => ({ text: t, confidence: c })),
  });
  const rest = [line("서하준", [["서하준", 95]]), line("hajun@hanbit-tech.co.kr", [["hajun@hanbit-tech.co.kr", 92]]), line("010-7890-1234", [["010-7890-1234", 93]])];
  const scan = (first: OcrLine) => scanCard([first, ...rest].map((l) => l.text.trim()).join("\n"), [first, ...rest]);
  // 「가」 「나」 「다」 「테크」로 나뉜 낱말
  assert.equal(scan(line("주식회사 가나다테크", [["주식회사", 93], ["가", 93], ["나", 93], ["다", 93], ["테크", 97]])).values.company, "주식회사 가나다테크");
  // 그 가운데 하나라도 점수가 낮으면 비워요
  assert.equal(scan(line("주식회사 가나다테크", [["주식회사", 93], ["가", 93], ["나", 58], ["다", 93], ["테크", 97]])).values.company, "");
  // 줄 끝 잡글자 — 「를」이 따로 읽힌 낱말이어도, 붙어 읽힌 낱말이어도 떼요
  assert.equal(scan(line("주식회사 한빛테크를 0", [["주식회사", 94], ["한빛", 91], ["테크", 90], ["를", 41], ["0", 30]], 70)).values.company, "주식회사 한빛테크");
  assert.equal(scan(line("주식회사 한빛테크를 0", [["주식회사", 94], ["한빛테크를", 92], ["0", 30]], 70)).values.company, "주식회사 한빛테크");
  // 잡글자 조각의 점수가 높으면(이름의 일부일 수 있음) 비워요
  assert.equal(scan(line("주식회사 한빛테크를 0", [["주식회사", 94], ["한빛테크를", 92], ["0", 88]], 88)).values.company, "");
});

test("UG-451 17106 읽은 결과 — 채움(found) · 확인 못 함(unsure) · 못 읽음(unreadable)", () => {
  // 이메일이나 연락처를 하나라도 채웠으면 found
  assert.equal(read("홍길동", "gildong.hong@ganadatech.co.kr").outcome, "found");
  assert.equal(read("홍길동", "010-1234-5678").outcome, "found");
  // 채운 것은 없지만 메일 모양 줄을 또렷이 읽음 — 직원이 읽은 줄에서 골라요
  const unsure = read("주식회사 다온물류", "정다은", "daeun jung@daon-logis.co.kr");
  assert.equal(unsure.outcome, "unsure");
  assert.equal(unsure.found, 0);
  assert.equal(unsure.values.email, "");
  assert.ok(unsure.chips.some((c) => c.kind === "email"));
  // 이때도 또렷한 회사명 · 이름은 채워요
  assert.equal(unsure.values.company, "주식회사 다온물류");
  assert.equal(unsure.values.name, "정다은");
  // 형식이 깨진 메일 모양 줄(@ 양옆에 글자)도 또렷하면 unsure
  assert.equal(read("Lena Koh", "lena@koh sg").outcome, "unsure");
});

test("UG-451 17106 거꾸로 · 옆으로 찍힌 명함 — 우연히 잡힌 @ 줄(점수 낮음)은 읽은 것으로 치지 않고, 아무것도 채우지 않아요", () => {
  const r = read(["LZ9S-ɥEZL-OLO 'W", 31], ["ɹʞ'oɔ'ɥɔǝʇ@buoɥ", 28], ["wo lo@ɯo sb", 35], ["주식회사 가나다테크", 44], ["홍길동", 40], ["눔lo 묵운", 22]);
  assert.equal(r.outcome, "unreadable");
  assert.equal(r.found, 0);
  assert.deepEqual(r.values, { company: "", name: "", email: "", phone: "" });
  assert.deepEqual(r.links, {});
  assert.equal(r.korean, false);
  // 깨진 줄은 칩으로 돌려주지 않아요 · 바로 놓인 명함으로 보이지 않아 돌려 읽을 대상이에요
  assert.deepEqual(r.chips, []);
  assert.equal(r.upright, false);
  assert.equal(r.sparse, false);
});

test("UG-451 17106 점수 낮은 줄에서 찾은 번호 · 주소는 찾은 것으로 치지 않아요 — 거꾸로 찍힌 전화번호가 숫자로 읽혀도 못 읽은 명함", () => {
  // 지어낸 명함을 거꾸로 돌려 실제 도구로 읽힌 모양 — 전화번호 자리가 「95-7601-010」으로 읽혔어요(줄 점수 26)
  const r = read(["| Zi2lela 즌몸운 |*로늘롱|", 48], ["Dro yoelepeues@®@3uoy Suop|is", 13], ["8/95-7601-010 ‘NN", 26], ["으르우", 55], ["ㄴ『추그", 38]);
  assert.equal(r.outcome, "unreadable");
  assert.equal(r.found, 0);
  assert.deepEqual(r.values, { company: "", name: "", email: "", phone: "" });
  assert.deepEqual(r.links, {});
  // 옆으로 찍힌 명함의 짧은 깨진 줄은 줄 점수가 높게 나오기도 해요 — 낱말 점수가 낮으면 메일 후보로 치지 않아요
  const sideways = read(["x m 를 qm", 72, { x: 65 }], ["mn @ 의 눅", 72, { mn: 70, "@": 10, 의: 60, 눅: 44 }], ["Eo <Q = lo", 58]);
  assert.equal(sideways.outcome, "unreadable");
  assert.deepEqual(sideways.chips, []);
  // 점수를 모르면 전처럼 모양만 봐요
  assert.equal(scanCard("8/95-7601-010 ‘NN").values.phone, "95-7601-010");
  // 또렷이 읽은 주소가 있으면, 점수 낮은 줄의 번호도 전처럼 채워요(읽은 명함)
  const mixed = read("gildong.hong@ganadatech.co.kr", ["M. 010-1234-5678", 52]);
  assert.equal(mixed.outcome, "found");
  assert.equal(mixed.found, 1);
  assert.equal(mixed.values.phone, "010-1234-5678");
});

test("UG-451 17106 이메일 · 연락처가 없는 사진은 줄이 또렷해도 못 읽은 것 — 회사명 · 이름 · 메일 언어를 채우지 않아요", () => {
  const r = read("주식회사 가나다테크", "김민수", "팀장", "서울특별시 강남구", ["Tx dg ㅁ 3", 31], ["은 이아7 났", 28]);
  assert.equal(r.outcome, "unreadable");
  assert.deepEqual(r.values, { company: "", name: "", email: "", phone: "" });
  assert.equal(r.korean, false);
  // 바로 놓인 명함(또렷이 읽은 글자 줄이 둘 이상)이면 또렷이 읽은 줄의 칩만 남겨요(반박 리뷰 3) — 돌려 읽지도 않아요
  assert.equal(r.upright, true);
  assert.deepEqual(
    r.chips.map((c) => c.text),
    ["주식회사 가나다테크", "김민수", "서울특별시 강남구"],
  );
  // 또렷한 줄이 하나뿐이면 바로 놓인 명함인지 알 수 없어요 — 칩을 남기지 않아요
  const one = read("주식회사 가나다테크", ["Tx dg ㅁ 3", 31], ["은 이아7 났", 28]);
  assert.equal(one.upright, false);
  assert.deepEqual(one.chips, []);
});

test("UG-451 반박 리뷰 4 — 글자가 거의 읽히지 않은 사진(뒷면 · 빈 사진)은 sparse", () => {
  assert.equal(read(["ab", 40]).sparse, true);
  assert.equal(read(["- ·", 30], ["x1", 35]).sparse, true);
  assert.equal(read(["LZ9S-ɥEZL-OLO 'W", 31], ["ɹʞ'oɔ'ɥɔǝʇ@buoɥ", 28]).sparse, false);
  // 점수를 모르면 판단하지 않아요
  assert.equal(scanCard("ab").sparse, false);
});

/** 낱말 점수를 하나씩 적은 줄 */
const L = (text: string, confidence: number, words: [string, number][]): OcrLine => ({
  text: `${text}\n`,
  confidence,
  words: words.map(([t, c]) => ({ text: t, confidence: c })),
});
const scanLines = (...lines: OcrLine[]) => scanCard(lines.map((l) => l.text.trim()).join("\n"), lines);

test("UG-451 반박 리뷰 3 — found 는 값을 이루는 낱말 점수로만 판정해요(아이콘 조각 · 라벨 · 줄 점수는 보지 않음)", () => {
  const company = L("(주)한빛물산", 94, [["(주)한빛물산", 94]]);
  const person = L("박서준 과장", 95, [["박서준", 95], ["과장", 96]]);
  // 그린 아이콘 + 2° 기울임: 아이콘이 「®」 「©」로 읽히고 그 조각 점수가 낮음 — 번호는 또렷(89)
  const a = scanLines(company, person, L("® 010-2345-6789", 74, [["®", 58], ["010-2345-6789", 89]]), L("© sj.park@hanbit-trade.co. kr", 68, [["©", 43], ["sj.park@hanbit-trade.co.", 75], ["kr", 72]]));
  assert.equal(a.outcome, "found");
  assert.equal(a.values.phone, "010-2345-6789");
  assert.equal(a.values.email, ""); // 「.co. kr」 — 잘렸을 수 있는 주소라 전처럼 비워요(칩은 남아요)
  assert.ok(a.chips.some((c) => c.kind === "email"));
  // 기호 아이콘 + 절반 해상도: 줄 점수는 52 · 55 지만 값 낱말은 91 · 70
  const b = scanLines(company, person, L("= 010-2345-6789", 52, [["=", 12], ["010-2345-6789", 91]]), L("® sj.park@hanbit-trade.co.kr", 55, [["®", 40], ["sj.park@hanbit-trade.co.kr", 70]]));
  assert.equal(b.outcome, "found");
  assert.equal(b.found, 2);
  assert.equal(b.values.phone, "010-2345-6789");
  assert.equal(b.values.email, "sj.park@hanbit-trade.co.kr");
  // 영문 명함 12° 기울임: Mobile 줄은 또렷(87 · 94 · 94 · 85), Tel 줄만 깨짐
  const c = scanLines(
    L("BluePeak Logistics Pte. Ltd.", 80, [["BluePeak", 85], ["Logistics", 78], ["Pte.", 80], ["Ltd.", 77]]),
    L("Mobile +65 9123 4567", 90, [["Mobile", 87], ["+65", 94], ["9123", 94], ["4567", 85]]),
    L("Te| +6S 6l23 4S6?", 38, [["Te|", 41], ["+6S", 30], ["6l23", 44], ["4S6?", 22]]),
  );
  assert.equal(c.outcome, "found");
  assert.equal(c.values.phone, "+65 9123 4567");
  // 값 낱말 점수가 낮으면 전처럼 찾은 것으로 치지 않아요(거꾸로 찍힌 번호)
  const d = scanLines(L("8/95-7601-010 ‘NN", 60, [["8/95-7601-010", 26], ["‘NN", 90]]));
  assert.equal(d.outcome, "unreadable");
  // 거꾸로 찍힌 번호가 숫자로 또렷이 읽힌 경우(실제 도구: 「+65 6123 4567」 → 「/957 6619 59+」 73 · 73 · 92) — 나라 · 한국 · 싱가포르 번호 모양이 아니고
  // 이메일도 또렷한 줄도 없으면 찾은 것으로 치지 않아요(돌려 읽어요)
  const flipped = [L("/957 6619 59+", 79, [["/957", 73], ["6619", 73], ["59+", 92]]), L("woo'sonAjeue-puimyyiou@uel’siuep", 0, [["woo'sonAjeue-puimyyiou@uel’siuep", 0]])];
  assert.equal(scanLines(...flipped).outcome, "unreadable");
  // 같은 모양(나눠 쓴 숫자 묶음)이고 점수가 낮아도, 바로 놓인 명함이면(또렷한 글자 줄이 둘 이상) 전처럼 채워요 — 미국 번호 · 아이콘 옆 번호
  const us = scanLines(L("Acme Robotics Inc.", 94, [["Acme", 94], ["Robotics", 93], ["Inc.", 95]]), L("Rachel Lim", 95, [["Rachel", 95], ["Lim", 96]]), L("T. 415-555-0132", 60, [["T.", 90], ["415-555-0132", 41]]));
  assert.equal(us.outcome, "found");
  assert.equal(us.values.phone, "415-555-0132");
});

test("UG-451 반박 리뷰 3 — 메일 주소 낱말을 못 읽었어도 바로 놓인 명함이면 의심 칩과 또렷한 칩이 남아요(unsure)", () => {
  // 한글 명함 0.4배: 주소 낱말 점수 0 · 회사 · 이름 줄은 88~95
  const r = scanLines(
    L("주식회사 가나다테크", 90, [["주식회사", 92], ["가나다테크", 88]]),
    L("김민수", 95, [["김민수", 95]]),
    L("E. gildong.hong@ganadatech.co.kr-", 45, [["E.", 60], ["gildong.hong@ganadatech.co.kr-", 0]]),
  );
  assert.equal(r.outcome, "unsure");
  assert.equal(r.upright, true);
  assert.equal(r.values.email, "");
  assert.deepEqual(
    r.chips.map((c) => c.text),
    ["주식회사 가나다테크", "김민수", "E. gildong.hong@ganadatech.co.kr-"],
  );
  // 또렷한 줄이 없으면(거꾸로 · 옆으로) 점수 낮은 메일 모양 줄만으로는 읽은 것으로 치지 않아요
  const garbage = scanLines(L("Zi2lela 즌몸운", 40, [["Zi2lela", 35], ["즌몸운", 44]]), L("Dro yoelepeues@3uoy", 13, [["Dro", 20], ["yoelepeues@3uoy", 10]]));
  assert.equal(garbage.outcome, "unreadable");
  assert.deepEqual(garbage.chips, []);
});

test("UG-451 반박 리뷰 1 — 부서 · 지점 · 상호 낱말이 이름 칸에 채워지지 않아요", () => {
  const name = (...lines: Line[]) => read(...lines).values.name;
  // 실제 도구로 재현된 명함: 이름 줄에 직함이 붙고, 성씨 글자로 시작하는 부서 줄이 따로 있음 — 「정치부」가 채워졌어요
  assert.equal(name("가나다일보", "홍길동 기자", "정치부", "M. 010-1234-5678", "E. gdhong@ganadailbo.co.kr"), "홍길동");
  // 목록에 없는 직함이 붙은 이름 줄은 채우지 않고 후보로만 세요 — 부서 줄도 채워지지 않아요
  assert.equal(name("가나다일보", "홍길동 주무", "정치부", "M. 010-1234-5678", "E. gdhong@ganadailbo.co.kr"), "");
  // 큰 굵은 이름은 깨져 읽히고(「길미스」 낱말 30) 작은 부서 줄만 또렷 — 「전략부」가 채워졌어요
  assert.equal(read("주식회사 가나다테크", ["길미스", 70, { 길미스: 30 }], "과장", "전략부", "M. 010-1234-5678", "E. minsu.kim@ganadatech.co.kr").values.name, "");
  assert.equal(name("가나다병원", "원무과", "홍길동 간호사", "02-555-0100", "gdhong@ganada-hospital.kr"), "홍길동");
  assert.equal(name("가나다은행", "여신부", "홍길동 계장", "02-555-0100", "gdhong@ganada-bank.kr"), "홍길동");
  assert.equal(name("(주)가나다", "Gildong Hong", "제조부", "010-1234-5678", "gd@ganada.co.kr"), "");
  assert.equal(name("(주)가나다", "피수진 대리", "국제부", "010-1234-5678", "sj@ganada.co.kr"), "");
  assert.equal(name("가나다증권", "洪吉童", "강남점", "010-1234-5678", "gd@ganada-sec.kr"), "");
  assert.equal(name("한우리", "홍길동 Manager", "010-1234-5678", "gd@gmail.com"), "");
  // 한 줄뿐일 때 채워지던 낱말(부서 · 지점 · 장소 · 상호 · 학교 · 보통 낱말) — 모두 비워요
  const words =
    "성수동 여의도 강남역 제주점 구매과 설계부 조직장 신세계 이마트 정관장 이디야 오뚜기 서울대 고려대 연세대 지마켓 김앤장 전시회 박람회 금융권 " +
    "정치부 전략부 원무과 여신부 제조부 국제부 강남점 한우리";
  for (const word of words.split(" ")) {
    assert.equal(name(word, "010-1234-5678", "info@example.com"), "", word);
    assert.equal(name("주식회사 가나다", word, "과장", "010-1234-5678", "info@ganada.co.kr"), "", word);
  }
  // 다른 줄에 다시 나오는 낱말은 상호예요
  assert.equal(name("한서진", "주식회사 한서진푸드", "010-1234-5678", "info@example.com"), "");
  // 한자 이름 줄이 따로 있으면 한글 낱말 하나만으로 채우지 않아요
  assert.equal(name("김민수", "金民秀", "010-1234-5678", "info@example.com"), "");
  // 주소 줄(「강남구 역삼동」)은 이름 후보로 세지 않아요 — 이름이 그대로 채워져요
  assert.equal(name("김민수", "서울특별시 강남구 테헤란로 1", "강남구 역삼동", "010-1234-5678", "info@example.com"), "김민수");
  // 직함이 붙은 줄의 이름은 조직 끝말로 끝나도 채워요
  assert.equal(name("이지원 과장", "010-1234-5678", "info@example.com"), "이지원");
  assert.equal(name("이지원", "010-1234-5678", "info@example.com"), "");
});

test("UG-451 반박 리뷰 5 — 역할 메일함 · 문구 · 상호는 영어 이름으로 채우지 않아요", () => {
  const name = (...lines: Line[]) => read(...lines).values.name;
  assert.equal(name("Blue Peak", "Hello Tomorrow", "+65 9123 4567", "hello@bluepeak.sg"), "");
  assert.equal(name("Dream Big Together", "Blue Peak", "+65 9123 4567", "dream@bluepeak.sg"), "");
  assert.equal(name("Info Desk", "info@koh.sg", "+65 6123 4567"), "");
  assert.equal(name("Press Inquiries", "press@lumenworks.com", "+65 6123 4567"), "");
  assert.equal(name("Events Crew", "events@lumenworks.com", "+65 6123 4567"), "");
  assert.equal(name("Growth Hacker", "growth@lumenworks.com", "+65 6123 4567"), "");
  assert.equal(name("Art Curator", "curator@lumenworks.com", "+65 6123 4567"), "");
  assert.equal(name("Sunny Bakery", "+65 9123 4567", "sunnybakery@gmail.com"), "");
  // 역할 낱말은 뒷받침으로 세지 않아요 — 이름 낱말이 @ 앞에 있을 때만
  assert.equal(name("Sales Koh", "sales@koh.sg", "+65 6123 4567"), "");
  // 채운 회사명과 낱말이 모두 겹치는 줄은 상호예요
  assert.equal(name("Lumen Works", "Lumen Works Corp.", "lumen@lumenworks.com", "+65 6123 4567"), "");
  // 사람 이름은 전처럼 채워요
  assert.equal(name("Lena Koh", "lena.koh@gmail.com", "9123 4567"), "Lena Koh");
  assert.equal(name("Lumen Works Corp.", "Rachel Lim", "rachel@lumenworks.com", "+65 6123 4567"), "Rachel Lim");
});

test("UG-451 반박 리뷰 6 — 법인 표시가 든 문구 줄은 회사명으로 채우지 않아요", () => {
  const company = (...lines: Line[]) => read(...lines).values.company;
  assert.equal(company("벤처기업 인증 (주)가나다", "김민수", "010-1234-5678", "minsu@ganada.co.kr"), "");
  assert.equal(company("가나다 주식회사 공식 대리점", "김민수", "010-1234-5678", "minsu@ganada.co.kr"), "");
  assert.equal(company("Incheon", "Limited Edition", "+82 10-1234-5678", "info@example.com"), "");
  assert.equal(company("Authorized Dealer of Acme Inc.", "+65 6123 4567", "info@example.com"), "");
  assert.equal(company("Acme Inc. Official Partner", "+65 6123 4567", "info@example.com"), "");
  // 「Limited」는 이름 낱말 뒤 줄 끝에 올 때만 법인 표시예요
  assert.equal(company("Acme Trading Limited", "+65 6123 4567", "info@example.com"), "Acme Trading Limited");
  assert.equal(company("Limited", "Acme Trading", "+65 6123 4567", "info@example.com"), "");
  // 회사명 낱말로 쓰인 Partners 는 그대로 채워요
  assert.equal(company("Acme Partners Ltd.", "+65 6123 4567", "info@example.com"), "Acme Partners Ltd.");
});

test("UG-451 17106 점수를 모르면 메일 모양 줄은 전처럼 읽은 것으로 봐요", () => {
  assert.equal(scanCard("Lena Koh\nlena@koh sg").outcome, "unsure");
  assert.equal(scanCard("daeun jung@daon-logis.co.kr").outcome, "unsure");
  assert.equal(scanCard("홍길동\n팀장").outcome, "unreadable");
});

test("UG-451 17106-3 줄 점수 평균 — 돌려 읽은 방향을 견줄 때 써요", () => {
  assert.equal(read(["홍길동", 90], ["010-1234-5678", 70]).confidence, 80);
  assert.equal(scanCard("홍길동").confidence, 0);
});

test("UG-451 반박 리뷰 후속 1 — 바로 놓인 명함인지 모르는데 연락처만 찾으면 weak, 믿지 않기로 하면 비워요", () => {
  // 실제 도구: 거꾸로 놓인 「Tel. +82 2 555 0101   Mobile. +82 10 5555 0102」가 「8010 9999」(낱말 66 · 92)로 읽혀 연락처에 채워졌어요
  const flipped = [L("8010 9999 ZO SSSS OL Z8+", 61, [["8010", 66], ["9999", 92], ["ZO", 40], ["SSSS", 35], ["OL", 30], ["Z8+", 28]]), L("woɔ˙ǝldɯɐxǝ", 20, [["woɔ˙ǝldɯɐxǝ", 20]])];
  const text = flipped.map((l) => l.text.trim()).join("\n");
  const r = scanCard(text, flipped);
  assert.equal(r.weak, true);
  assert.equal(r.outcome, "found"); // 더 나은 방향이 없고 네 방향 가운데 이 방향뿐이면 쓰는 값
  assert.equal(r.values.phone, "8010 9999");
  const distrusted = scanCard(text, flipped, { lonePhone: false });
  assert.equal(distrusted.weak, true);
  assert.equal(distrusted.outcome, "unreadable");
  assert.equal(distrusted.found, 0);
  assert.equal(distrusted.values.phone, "");
  assert.deepEqual(distrusted.chips, []);
  // 다른 재현 번호 — 「6891 8096」 「9160 6899」 「0610-9698-010」
  for (const number of ["6891 8096", "9160 6899", "0610-9698-010"]) {
    const one = [L(number, 80, number.split(" ").map((w) => [w, 80] as [string, number]))];
    assert.equal(scanCard(number, one).weak, true, number);
    assert.equal(scanCard(number, one, { lonePhone: false }).values.phone, "", number);
  }
  // 이메일도 찾았거나 바로 놓인 명함이면 weak 가 아니에요 — lonePhone 과 상관없이 채워요
  const upright = [L("Acme Robotics Inc.", 94, [["Acme", 94], ["Robotics", 93], ["Inc.", 95]]), L("Rachel Lim", 95, [["Rachel", 95], ["Lim", 96]]), L("6689 0916", 90, [["6689", 90], ["0916", 91]])];
  const up = scanCard(upright.map((l) => l.text.trim()).join("\n"), upright, { lonePhone: false });
  assert.equal(up.weak, false);
  assert.equal(up.values.phone, "6689 0916");
  const withEmail = [L("rachel@acme-robotics.com", 80, [["rachel@acme-robotics.com", 80]]), L("6689 0916", 90, [["6689", 90], ["0916", 91]])];
  const em = scanCard(withEmail.map((l) => l.text.trim()).join("\n"), withEmail, { lonePhone: false });
  assert.equal(em.weak, false);
  assert.equal(em.values.phone, "6689 0916");
  // 점수를 모르면(도구가 점수를 주지 않음) 전처럼 채워요
  assert.equal(scanCard("8010 9999", null, { lonePhone: false }).values.phone, "8010 9999");
  assert.equal(scanCard("8010 9999").weak, false);
});

test("UG-451 반박 리뷰 후속 2 — 아무 줄도 읽히지 않은 방향은 바로 놓인 명함이 아니에요", () => {
  const empty = scanCard("", []);
  assert.equal(empty.upright, false);
  assert.equal(empty.outcome, "unreadable");
  assert.equal(empty.sparse, true);
  // 도구가 점수를 주지 않은 것(null · 없음)만 「점수를 모름」이에요
  assert.equal(scanCard("", null).upright, true);
  assert.equal(scanCard("").upright, true);
  // 글자는 있는데 줄 점수가 하나도 없으면(맞출 줄이 없음) 읽은 것으로 치지 않아요
  assert.equal(scanCard("주식회사 가나다테크\n김민수\n010-1234-5678", []).outcome, "unreadable");
  // 화면이 매기는 점수(page.tsx 의 judge 와 같은 식)로: 빈 방향에서 멈추지도, 그 방향을 고르지도 않아요
  const judge = (r: ReturnType<typeof scanCard>): ReadingScore => ({ found: r.found, candidate: r.outcome === "unsure" || r.upright, confidence: r.confidence, sparse: r.sparse, weak: r.weak });
  const garbage = judge(read(["LZ9S-ɥEZL-OLO 'W", 31], ["ɹʞ'oɔ'ɥɔǝʇ@buoɥ", 28]));
  assert.equal(needsRetry(garbage), true);
  assert.equal(isSettled(judge(empty)), false);
  assert.deepEqual(pickReading([garbage, judge(empty)], false), { index: 0, lonePhone: false });
});

test("UG-451 반박 리뷰 후속 4 — 직함이 붙었거나 성씨로 시작하는 세 글자 낱말은 이름 글자와 상관없이 후보로 세요", () => {
  const name = (...lines: Line[]) => read(...lines).values.name;
  // 「름」 「롬」이 이름 글자 목록에 없어 이름 줄을 세지 않아, 다른 줄의 보통 낱말이 채워졌어요
  assert.equal(name("한서진", "김아름 대리", "010-1234-5678", "info@example.com"), "");
  assert.equal(name("한정식", "김아름 대리", "010-1234-5678", "info@example.com"), "");
  assert.equal(name("주유소", "김새롬 과장", "010-1234-5678", "info@example.com"), "");
  assert.equal(name("전단지", "피수진", "010-1234-5678", "info@example.com"), "");
  assert.equal(name("한서진", "피수진", "010-1234-5678", "info@example.com"), "");
  assert.equal(name("한양대 교수", "옹실종", "010-1234-5678", "info@example.com"), "");
  assert.equal(name("한양대 교수", "010-1234-5678", "info@example.com"), "");
  // 한 줄뿐인 보통 낱말
  for (const word of "인문학 금요일 신청서 소비자 한정식 주유소 전단지".split(" ")) assert.equal(name(word, "010-1234-5678", "info@example.com"), "", word);
  // 채우는 조건은 그대로 — 이름 글자가 아닌 글자가 든 이름은 직함이 붙어도 채우지 않고(직원이 넣어요), 이름 글자로 된 이름은 채워요
  assert.equal(name("김아름 대리", "010-1234-5678", "info@example.com"), "");
  assert.equal(name("김민수 대리", "010-1234-5678", "info@example.com"), "김민수");
  // 네 글자 낱말은 전처럼 이름 글자로 된 것만 후보예요(부서 줄 「기술영업」이 이름을 가리지 않게)
  assert.equal(name("기술영업", "김민수", "010-1234-5678", "info@example.com"), "김민수");
  // 공용 메일 + 「Kim Family」
  assert.equal(name("Kim Family", "kimfamily@gmail.com", "+65 9123 4567"), "");
});

test("UG-451 반박 리뷰 후속 5 — 회사명을 채울 때 쉼표 앞 공백은 붙여요(칩은 읽은 그대로)", () => {
  const r = read("Acme Robotics Co. , Ltd.", "+65 6123 4567", "info@example.com");
  assert.equal(r.values.company, "Acme Robotics Co., Ltd.");
  assert.equal(r.chips.find((c) => c.id === r.links.company)?.text, "Acme Robotics Co. , Ltd.");
});
