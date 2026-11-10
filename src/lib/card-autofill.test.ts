// 회사명 · 이름 자동 채움(UG-451 기획 17100) · 못 읽은 명함 판정(기획 17106 — 파일 뒤쪽) 시험 — card-scan.ts 의 scanCard(글자, 줄 점수).
// 예시 값은 모두 지어낸 것이에요(공개 저장소 — 실제 고객 · 회사 · 이름 · 번호 금지).
import assert from "node:assert/strict";
import { test } from "node:test";

import { FILL_CONF, emailDomainName, scanCard, type OcrLine } from "./card-scan.ts";

/** 명함 한 줄 — 글자만(점수 93), [글자, 줄 점수], [글자, 줄 점수, {낱말: 점수}] */
type Line = string | [string, number] | [string, number, Record<string, number>];

const GOOD = 93;

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
    lines: ["주식회사 가나다테크", "홍길동", "팀장", "M. 010-1234-5678", "E. gildong.hong@ganadatech.co.kr", "서울특별시 강남구 테헤란로 1"],
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
    lines: ["홍길동", "Hong Gildong", "가나다 주식회사", "Ganada Co., Ltd.", "gildong@ganada.co.kr", "010-1234-5678"],
    truth: { company: "가나다 주식회사", name: "홍길동" },
    fill: { company: "", name: "홍길동" },
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
    name: "글자 인식 점수가 낮은 회사명 · 이름 줄",
    lines: [["주식회사 가나다테크", 62], ["홍길동", 55], "M. 010-1234-5678", "gildong.hong@ganadatech.co.kr"],
    truth: { company: "주식회사 가나다테크", name: "홍길동" },
    fill: { company: "", name: "" },
  },
  {
    name: "줄 점수는 높아도 낱말 하나의 점수가 낮음(틀린 글자가 섞였을 수 있음)",
    lines: [["BluePeak Logistics Pte. Ltd.", 88, { Logistics: 61 }], ["Tan Wei Ling", 86, { Wei: 70 }], "weiling.tan@bluepeak.com.sg", "+65 9123 4567"],
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
    lines: [["주식회사 한빛테크를 0", 71, { 주식회사: 94, 한빛테크를: 88, "0": 31 }], "서하준", "hajun@hanbit-tech.co.kr", "010-7890-1234"],
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
    name: "성씨 글자로 시작하는 한글 상호 + 이메일이 뒷받침하는 영어 이름(성씨가 다름)",
    lines: ["이노벨", "Tan Wei Ling", "weiling.tan@innobell.sg", "+65 9345 6789"],
    truth: { company: "이노벨", name: "Tan Wei Ling" },
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
    fill: { company: "", name: "정다은" },
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
    lines: ["Acme Robotics Inc.", "Rachel Lim", "Engineering Lead", "서울시 강남구 테헤란로 1", "rachel@acme-robotics.com", "+82 10-1234-5678"],
    truth: { company: "Acme Robotics Inc.", name: "Rachel Lim" },
    fill: { company: "Acme Robotics Inc.", name: "Rachel Lim" },
    korean: false,
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
  const text = ["주식회사 가나다테크", "홍길동", "M. 010-1234-5678", "gildong.hong@ganadatech.co.kr"].join("\n");
  for (const r of [scanCard(text), scanCard(text, null), scanCard(text, [])]) {
    assert.equal(r.values.company, "");
    assert.equal(r.values.name, "");
    assert.equal(r.values.email, "gildong.hong@ganadatech.co.kr");
    assert.equal(r.values.phone, "010-1234-5678");
    assert.equal(r.korean, false);
  }
});

test("UG-451 17100 점수 기준 — 낱말이 모두 기준 이상일 때만 채워요", () => {
  const card = (conf: number) => read(["주식회사 가나다테크", conf], ["홍길동", conf], "010-1234-5678", "gildong.hong@ganadatech.co.kr").values;
  assert.equal(card(FILL_CONF).company, "주식회사 가나다테크");
  assert.equal(card(FILL_CONF).name, "홍길동");
  assert.equal(card(FILL_CONF - 1).company, "");
  assert.equal(card(FILL_CONF - 1).name, "");
});

test("UG-451 17100 규칙 2 — 잡글자는 칸에 채울 때만 떼고 칩은 읽은 그대로", () => {
  const r = read(["주식회사 한빛테크를 0", 71, { 주식회사: 94, 한빛테크를: 88, "0": 31 }], "서하준", "hajun@hanbit-tech.co.kr", "010-7890-1234");
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
  assert.equal(read("Acme Robotics Inc.", "홍길동", "gildong@acme-robotics.com", "010-1234-5678").korean, true);
  // 이름은 못 채웠어도 또렷한 글자 줄의 절반 이상이 한글
  assert.equal(read("가나다테크", "기술연구소 책임연구원", "www.ganadatech.co.kr", "info@ganadatech.co.kr", "02-555-0100").korean, true);
  // 한글 줄이 하나뿐 · 점수 낮은 한글 줄은 세지 않아요
  assert.equal(read("Acme Robotics Inc.", "Engineering Lead", "서울시 강남구", "info@acme-robotics.com", "02-555-0100").korean, false);
  assert.equal(read(["가나다테크 영업본부", 50], ["기술연구소 책임연구원", 45], "info@ganadatech.co.kr", "02-555-0100").korean, false);
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
  assert.equal(scan(line("주식회사 한빛테크를 0", [["주식회사", 94], ["한빛테크를", 86], ["0", 30]], 70)).values.company, "주식회사 한빛테크");
  // 잡글자 조각의 점수가 높으면(이름의 일부일 수 있음) 비워요
  assert.equal(scan(line("주식회사 한빛테크를 0", [["주식회사", 94], ["한빛테크를", 86], ["0", 88]], 88)).values.company, "");
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
  // 점수를 모르면 전처럼 모양만 봐요
  assert.equal(scanCard("8/95-7601-010 ‘NN").values.phone, "95-7601-010");
  // 또렷이 읽은 주소가 있으면, 점수 낮은 줄의 번호도 전처럼 채워요(읽은 명함)
  const mixed = read("gildong.hong@ganadatech.co.kr", ["M. 010-1234-5678", 52]);
  assert.equal(mixed.outcome, "found");
  assert.equal(mixed.found, 1);
  assert.equal(mixed.values.phone, "010-1234-5678");
});

test("UG-451 17106 이메일 · 연락처가 없는 사진은 줄이 또렷해도 못 읽은 것 — 회사명 · 이름 · 메일 언어를 채우지 않아요", () => {
  const r = read("주식회사 가나다테크", "홍길동", "팀장", "서울특별시 강남구");
  assert.equal(r.outcome, "unreadable");
  assert.deepEqual(r.values, { company: "", name: "", email: "", phone: "" });
  assert.equal(r.korean, false);
  // 칩 목록은 그대로 돌려줘요 — 화면이 이 결과(unreadable)를 보고 숨겨요
  assert.ok(r.chips.length > 0);
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
