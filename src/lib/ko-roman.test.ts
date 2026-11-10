// 한글 이름 ↔ 로마자 표기 대조(UG-451 기획 17118-3) — ko-roman.ts. 예시 이름 · 주소는 모두 지어낸 것이에요(공개 저장소).
import assert from "node:assert/strict";
import { test } from "node:test";

import { emailSpellsKoName, spellsHangul, surnameRomans, syllableRomans, wordsSpellKoName } from "./ko-roman.ts";

test("음절 표기 — 국어의 로마자 표기법 + 이름에서 흔한 변형", () => {
  const has = (syllable: string, ...romans: string[]) => {
    const got = syllableRomans(syllable);
    for (const r of romans) assert.ok(got.includes(r), `${syllable} → ${r} (${got.join(" ")})`);
  };
  has("정", "jeong", "jung", "joung");
  has("현", "hyeon", "hyun", "hyoun");
  has("영", "yeong", "young", "yung");
  has("준", "jun", "joon");
  has("윤", "yun", "yoon");
  has("승", "seung", "sung");
  has("희", "hui", "hee", "hi");
  has("미", "mi", "mee");
  has("경", "gyeong", "kyung", "kyoung");
  has("린", "rin", "lin");
  has("시", "si", "shi");
  has("신", "sin", "shin");
  has("우", "u", "woo", "wu", "oo");
  has("이", "i", "yi", "ee");
  has("석", "seok", "suk", "seog");
  has("덕", "deok", "duk", "duck");
  has("섭", "seop", "sup", "sub");
  has("태", "tae", "tai");
  has("필", "pil", "phil");
  has("아", "a", "ah");
  has("서", "seo", "suh");
  has("호", "ho", "hoh");
  has("안", "an", "ahn");
  has("은", "eun");
  has("별", "byeol", "byul");
  has("빛", "bit", "bich");
  has("채", "chae");
  has("혜", "hye");
  has("원", "won");
  has("화", "hwa");
});

test("음절 표기 — 모양이 비슷한 글자와 같은 표기가 되는 변형은 받지 않아요", () => {
  const lacks = (syllable: string, ...romans: string[]) => {
    const got = [...syllableRomans(syllable), ...syllableRomans(syllable, true)];
    for (const r of romans) assert.ok(!got.includes(r), `${syllable} ↛ ${r}`);
  };
  lacks("대", "tae"); // 태
  lacks("빈", "pin"); // 핀
  lacks("준", "chun"); // 춘
  lacks("재", "je"); // 제
  lacks("은", "un"); // 운
  lacks("을", "ul"); // 울
  lacks("휘", "hui"); // 희
  lacks("서", "su"); // 수
  lacks("여", "yu"); // 유
  lacks("순", "jun"); // 준
});

test("음절 표기 — 다음 음절이 모음으로 시작하면 h 를 붙이지 않고, 받침 ㄹ 은 r 로도", () => {
  assert.ok(!syllableRomans("아", true).includes("ah"));
  assert.ok(!syllableRomans("서", true).includes("suh"));
  assert.ok(syllableRomans("설", true).includes("seor"));
  assert.ok(!syllableRomans("설").includes("seor"));
  // 「아연」 ah-yun 과 「아현」 a-hyun 이 같은 글자가 되지 않아요
  assert.equal(spellsHangul("ahyun", "아현"), true);
  assert.equal(spellsHangul("ahyun", "아연"), false);
  assert.equal(spellsHangul("ayeon", "아연"), true);
  assert.equal(spellsHangul("ahreum", "아름"), true);
});

test("음절 표기 — 한글 음절이 아니거나 겹받침이면 대조하지 않아요", () => {
  for (const s of ["", "a", "ㄱ", "가나", "값", "삶", "1"]) assert.deepEqual(syllableRomans(s), [], s);
  assert.equal(spellsHangul("gabs", "값"), false);
  assert.equal(spellsHangul("", "서준"), false);
  assert.equal(spellsHangul("seojun", ""), false);
});

test("이름 대조 — 모든 음절이 맞아야 해요(받침 · 겹모음 이름, 붙여 씀)", () => {
  const yes: [string, string][] = [
    ["seojun", "서준"],
    ["seojoon", "서준"],
    ["suhjun", "서준"],
    ["haneul", "하늘"],
    ["eunbyul", "은별"],
    ["eunbyeol", "은별"],
    ["chaewon", "채원"],
    ["minseo", "민서"],
    ["jihye", "지혜"],
    ["hyewon", "혜원"],
    ["seunghyun", "승현"],
    ["sunghyeon", "승현"],
    ["kyunghee", "경희"],
    ["gyeonghui", "경희"],
    ["youngsoo", "영수"],
    ["yeongsu", "영수"],
    ["taeyoon", "태윤"],
    ["dohyun", "도현"],
    ["yujin", "유진"],
    ["yoojin", "유진"],
    ["woojin", "우진"],
    ["ujin", "우진"],
    ["seola", "설아"],
    ["seora", "설아"],
    ["jiwoo", "지우"],
    ["jiu", "지우"],
    ["shinae", "시내"],
    ["hwayoung", "화영"],
    ["gwangsu", "광수"],
    ["kwangsoo", "광수"],
    ["philseung", "필승"],
    ["sol", "솔"],
    ["bit", "빛"],
  ];
  for (const [roman, word] of yes) assert.equal(spellsHangul(roman, word), true, `${roman} ↔ ${word}`);
  const no: [string, string][] = [
    ["seojun", "서순"],
    ["seojun", "서춘"],
    ["seojun", "세준"],
    ["seojun", "서중"],
    ["seojun", "서"],
    ["seojun", "서준영"],
    ["seo", "서준"],
    ["jun", "서준"],
    ["sj", "서준"],
    ["jieun", "지운"],
    ["jiun", "지은"],
    ["taeyoon", "대윤"],
    ["jaeyoon", "제윤"],
    ["minsu", "민서"],
    ["hyunwoo", "현우진"],
  ];
  for (const [roman, word] of no) assert.equal(spellsHangul(roman, word), false, `${roman} ↮ ${word}`);
});

test("이름 글자 사이의 겹침 — 받아들인 것만(모양이 달라 서로 잘못 읽히는 일이 드문 짝)", () => {
  // card-scan.ts 의 KO_GIVEN(이름에 쓰이는 글자)과 같은 목록
  const given = (
    "가 갑 강 건 겸 경 고 곤 관 광 구 국 규 균 근 금 기 길 나 남 늘 다 단 담 대 덕 도 동 두 득 라 란 람 랑 래 련 령 로 록 룡 리 린 림 " +
    "만 명 무 문 미 민 배 백 범 별 병 보 복 봄 봉 비 빈 빛 산 삼 상 새 샘 서 석 선 설 섭 성 세 소 솔 송 수 숙 순 슬 승 시 식 신 실 심 " +
    "아 안 애 양 여 연 열 엽 영 예 오 옥 온 완 요 용 우 욱 운 웅 원 유 윤 율 은 을 이 익 인 일 자 장 재 정 제 종 주 준 중 지 진 찬 창 " +
    "채 철 청 초 춘 충 태 택 필 하 학 한 해 향 헌 혁 현 형 혜 호 홍 화 환 효 후 훈 휘 흥 희"
  ).split(" ");
  const romans = (s: string) => new Set([...syllableRomans(s), ...syllableRomans(s, true)]);
  const pairs: string[] = [];
  for (let i = 0; i < given.length; i++) {
    const a = romans(given[i]);
    assert.ok(a.size > 0, given[i]);
    for (let j = i + 1; j < given.length; j++) if ([...romans(given[j])].some((r) => a.has(r))) pairs.push(given[i] + given[j]);
  }
  // 받침 있는 ㅓ · ㅜ · ㅡ 의 u, ㅕ · ㅠ 의 yu — 변형을 늘릴 때 이 목록이 늘면 그 짝이 서로 잘못 읽히는 글자인지 먼저 봐요
  assert.deepEqual(pairs, ["건근", "덕득", "석숙", "선순", "설슬", "성승", "연윤", "열율", "정중", "청충", "헌훈"]);
});

test("성씨 표기 — 표의 흔한 표기 + 음절 표기, 한 글자 표기는 쓰지 않아요", () => {
  assert.deepEqual(new Set(surnameRomans("정", ["jung", "jeong", "chung", "jeung"])), new Set(["jung", "jeong", "chung", "jeung", "joung"]));
  const lee = surnameRomans("이", ["lee", "yi", "rhee", "ree", "li", "i"]);
  for (const r of ["lee", "yi", "rhee", "ee"]) assert.ok(lee.includes(r), r);
  assert.ok(!lee.includes("i"));
  assert.ok(surnameRomans("박", ["park", "pak", "bak"]).includes("park"));
  assert.ok(surnameRomans("최", ["choi", "choe"]).includes("choi"));
  assert.ok(surnameRomans("김", ["kim", "gim"]).includes("gim"));
  assert.ok(!surnameRomans("오", ["oh", "o"]).includes("o"));
  // 두 글자 성씨
  const two = surnameRomans("남궁", ["namgung", "namkung", "namgoong"]);
  for (const r of ["namgung", "namkung", "namgoong", "namkoong"]) assert.ok(two.includes(r), r);
  // 표가 없어도 음절 표기로
  assert.ok(surnameRomans("문").includes("mun"));
});

const JUNG = surnameRomans("정", ["jung", "jeong", "chung", "jeung"]);

test("이메일 @ 앞 — 성 + 이름을 남김없이 적은 것만(순서 · 붙여 씀 · 하이픈 · 숫자)", () => {
  const yes = [
    "haneul.jung@x.example",
    "jung.haneul@x.example",
    "haneuljung@x.example",
    "junghaneul@x.example",
    "ha-neul.jung@x.example",
    "jung_haneul@x.example",
    "haneul.jung85@x.example",
    "haneul85jung@x.example",
    "HANEUL.JUNG@X.EXAMPLE",
    "haneul.jeong@x.example",
    "haneul.chung@x.example",
    "haneul.joung@x.example",
    "hanul.jung@x.example", // 늘 → neul · nul
    "team.haneul.jung@x.example",
  ];
  for (const email of yes) assert.equal(emailSpellsKoName(email, JUNG, "하늘"), true, email);
  const no = [
    "haneul@x.example", // 이름만
    "jung@x.example", // 성씨만
    "hj@x.example", // 이니셜만
    "jhn@x.example",
    "hn.jung@x.example", // 이름 이니셜 + 성
    "hjung@x.example",
    "haneu.jung@x.example", // 한 글자 빠짐
    "haneull.jung@x.example",
    "hanal.jung@x.example", // 한 음절이 다름(날)
    "haneul.jang@x.example", // 다른 성씨
    "haneul.kim@x.example",
    "khaneul@x.example",
    // 성 이니셜 + 이름 · 이름 + 성 이니셜(반박 리뷰 2 — 성씨를 첫 글자만 보게 돼요)
    "jhaneul@x.example",
    "j.haneul@x.example",
    "haneulj@x.example",
    "haneul.j@x.example",
    "chaneul@x.example",
    "sales@x.example",
    "haneuljungkr@x.example", // 한 덩어리에 다른 글자가 붙음
    "@x.example",
    "haneul.jung",
  ];
  for (const email of no) assert.equal(emailSpellsKoName(email, JUNG, "하늘"), false, email);
});

test("이메일 @ 앞 — 이름만 적은 주소 · 성 이니셜 꼴은 아니에요(성씨 오독 재현: 장 · 주 · 함 · 선)", () => {
  const woo = surnameRomans("우", ["woo", "wu"]);
  assert.equal(emailSpellsKoName("woojin@x.example", woo, "우진"), false);
  assert.equal(emailSpellsKoName("wwoojin@x.example", woo, "우진"), false);
  assert.equal(emailSpellsKoName("woojin.woo@x.example", woo, "우진"), true);
  // 반박 리뷰 2 재현 — 읽힌 성씨(장 · 주 · 함 · 선)의 표기와 이니셜이 같아도 근거가 아니에요
  assert.equal(emailSpellsKoName("jhaneul@x.example", surnameRomans("장", ["jang", "chang"]), "하늘"), false);
  assert.equal(emailSpellsKoName("haneulj@x.example", surnameRomans("장", ["jang", "chang"]), "하늘"), false);
  assert.equal(emailSpellsKoName("jminseo@x.example", surnameRomans("주", ["joo", "ju"]), "민서"), false);
  assert.equal(emailSpellsKoName("hjihun@x.example", surnameRomans("함", ["ham"]), "지훈"), false);
  assert.equal(emailSpellsKoName("syuna@x.example", surnameRomans("선", ["sun", "seon"]), "유나"), false);
});

test("영문 이름 줄 — 성이 앞이든 뒤든, 대문자 · 하이픈 · 띄어 쓴 이름", () => {
  const yes = [
    ["Haneul", "Jung"],
    ["Jung", "Haneul"],
    ["JUNG", "Haneul"],
    ["Jung", "Ha-neul"],
    ["Ha-Neul", "Jung"],
    ["Jung", "Ha", "Neul"],
    ["Ha", "Neul", "Jung"],
    ["HANEUL", "CHUNG"],
    ["Jeong", "Haneul"],
  ];
  for (const tokens of yes) assert.equal(wordsSpellKoName(tokens, JUNG, "하늘"), true, tokens.join(" "));
  const no = [
    ["Haneul"], // 이름만
    ["Jung"],
    ["Haneul", "Kim"],
    ["Hana", "Jung"],
    ["Jung", "Ha"],
    ["H.", "Jung"], // 이니셜
    ["Jung", "H", "N"],
    ["Haneul", "Jung", "Manager"],
    ["Ha", "Jung", "Neul"], // 성씨가 가운데
    ["Haneul", "Jung", "과장"],
    ["Haneul", "Jung", "2"],
    ["Mr", "Ha", "Neul", "Jung", "Jr"],
  ];
  for (const tokens of no) assert.equal(wordsSpellKoName(tokens, JUNG, "하늘"), false, tokens.join(" "));
});
