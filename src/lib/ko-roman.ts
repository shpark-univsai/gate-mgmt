// 한글 이름 ↔ 로마자 표기 대조(UG-451 기획 17118-3) — 화면 · 브라우저에 기대지 않는 순수 함수만 둬요.
// 명함의 한글 이름 줄은 글자를 맞게 읽고도 글자 인식 점수가 낮게 나와요. 그 이름의 로마자 표기가 이메일 @ 앞이나 영문 이름 줄과 맞으면
// (정하늘 ↔ haneul.jung@ · Haneul Jung) 읽은 글자가 맞다는 따로 얻은 근거라, 점수가 낮아도 이름 칸에 채워요(card-scan.ts certainName).
//
// 대조는 「읽힌 한글 그대로」의 로마자로 해요 — 성씨와 이름의 모든 음절이 맞아야 해요. 글자를 틀리게 읽은 이름(「박서준」 → 「박서순」)은
// 이메일(seojun)과 한 음절이 어긋나 채워지지 않아요. 그래서 표기 변형은 「흔히 쓰는 것」만 받고, 모양이 비슷해 서로 잘못 읽히는 글자끼리
// 같은 표기가 되는 변형은 받지 않았어요:
// - ㄷ → t(태 · 대) · ㅂ → p(필 · 빌) · ㅈ → ch(준 · 춘): 받지 않아요(ㄷ · ㅌ, ㅂ · ㅍ, ㅈ · ㅊ 은 서로 잘못 읽혀요). 성씨는 표(SURNAME 변형)로 따로 받아요(정 → chung · 박 → park).
// - ㅐ → e(재 · 제): 받지 않아요(ae · ai 만).
// - 「은 · 을」의 ㅡ → u(은 · 운): 받지 않아요(eun · eul 만). 자음 뒤의 ㅡ 는 u 도 받아요(승 → sung · 근 → kun).
// - 「아 · 오 · 서」 뒤의 h(ah · oh · suh)는 다음 음절이 모음으로 시작하지 않을 때만(「아연」 ah-yun 과 「아현」 a-hyun 이 같은 글자가 되지 않게).
// - ㅟ → ui(휘 · 희): 받지 않아요(wi · wee 만). 받침 없는 ㅓ · ㅕ → u · yu(서 · 수, 여 · 유)도 받지 않아요(받침이 있을 때만 — 선 → sun · 현 → hyun).
// 남는 겹침(받아들인 것 — 모양이 달라 서로 잘못 읽힐 일이 드물어요): 받침 있는 ㅓ · ㅜ · ㅡ 의 u(선 · 순, 성 · 승, 정 · 중, 석 · 숙, 건 · 근),
// ㅕ · ㅠ 의 yu(연 · 윤, 열 · 율), 받침 ㄴ + 모음과 받침 없음 + ㄴ(민아 · 미나). 시험(ko-roman.test.ts)이 이름 글자 사이의 겹침 목록을 고정해요.

const HANGUL_BASE = 0xac00;
const HANGUL_LAST = 0xd7a3;

// 초성 19자(ㄱ ㄲ ㄴ ㄷ ㄸ ㄹ ㅁ ㅂ ㅃ ㅅ ㅆ ㅇ ㅈ ㅉ ㅊ ㅋ ㅌ ㅍ ㅎ)
const INITIALS: readonly (readonly string[])[] = [
  ["g", "k"],
  ["kk", "gg"],
  ["n"],
  ["d"],
  ["tt", "dd"],
  ["r", "l"],
  ["m"],
  ["b"],
  ["pp", "bb"],
  ["s"],
  ["ss"],
  [""],
  ["j"],
  ["jj"],
  ["ch"],
  ["k"],
  ["t"],
  ["p", "ph"],
  ["h"],
];
const I_S = 9;
const I_NONE = 11;

// 중성 21자(ㅏ ㅐ ㅑ ㅒ ㅓ ㅔ ㅕ ㅖ ㅗ ㅘ ㅙ ㅚ ㅛ ㅜ ㅝ ㅞ ㅟ ㅠ ㅡ ㅢ ㅣ)
const MEDIALS: readonly (readonly string[])[] = [
  ["a"],
  ["ae", "ai"],
  ["ya"],
  ["yae"],
  ["eo", "u", "ou"],
  ["e"],
  ["yeo", "yu", "you"],
  ["ye", "e"],
  ["o"],
  ["wa"],
  ["wae"],
  ["oe", "oi"],
  ["yo"],
  ["u", "oo"],
  ["wo", "weo"],
  ["we"],
  ["wi", "wee"],
  ["yu", "yoo", "you"],
  ["eu", "u"],
  ["ui", "eui", "ee", "i"],
  ["i", "ee"],
];
const M_A = 0;
const M_EO = 4;
const M_YEO = 6;
const M_O = 8;
const M_U = 13;
const M_EU = 18;
const M_I = 20;
// 받침 없는 음절 뒤에 붙여 쓰기도 하는 h(아 → ah · 서 → suh · 여 → yuh · 오 → oh)
const OPEN_H: Readonly<Record<number, readonly string[]>> = { [M_A]: ["ah"], [M_EO]: ["uh"], [M_YEO]: ["yuh"], [M_O]: ["oh"] };

// 종성 28자(없음 ㄱ ㄲ ㄳ ㄴ ㄵ ㄶ ㄷ ㄹ ㄺ ㄻ ㄼ ㄽ ㄾ ㄿ ㅀ ㅁ ㅂ ㅄ ㅅ ㅆ ㅇ ㅈ ㅊ ㅋ ㅌ ㅍ ㅎ) — 겹받침은 이름에 쓰이지 않아 대조하지 않아요(null)
const K_FINAL = ["k", "g", "ck"] as const;
const FINALS: readonly (readonly string[] | null)[] = [
  [""],
  K_FINAL,
  K_FINAL,
  null,
  ["n"],
  null,
  null,
  ["t", "d"],
  ["l"],
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  ["m"],
  ["p", "b"],
  null,
  ["t", "s"],
  ["t"],
  ["ng"],
  ["t"],
  ["t", "ch"],
  ["k"],
  ["t"],
  ["p"],
  ["t"],
];
const F_NONE = 0;
const F_N = 4;
const F_L = 8;

type Jamo = { initial: number; medial: number; final: number };

/** 한글 음절 한 글자 → 초성 · 중성 · 종성 번호. 한글 음절이 아니면 null */
function jamoOf(syllable: string): Jamo | null {
  const code = syllable.codePointAt(0) ?? 0;
  if ([...syllable].length !== 1 || code < HANGUL_BASE || code > HANGUL_LAST) return null;
  const offset = code - HANGUL_BASE;
  return { initial: Math.floor(offset / 588), medial: Math.floor((offset % 588) / 28), final: offset % 28 };
}

/**
 * 한글 음절 한 글자의 로마자 표기들(소문자) — 국어의 로마자 표기법(서 → seo · 정 → jeong)에 이름에서 흔히 쓰는 변형을 더했어요:
 * ㅓ → u · ou(정 → jung · joung), ㅕ → yu · you(현 → hyun · 영 → young), ㅜ → oo(준 → joon), ㅠ → yoo(윤 → yoon), ㅡ → u(승 → sung),
 * ㅢ · ㅣ → ee(희 → hee · 미 → mee), ㅐ → ai, ㄱ → k(경 → kyung), ㄹ → l(린 → lin), 시 → shi, 우 → woo · wu, 이 → yi, 받침 ㄱ → g · ck, ㅂ → b.
 * nextVowel = 다음 음절이 모음으로 시작(초성 ㅇ)하는지 — 받침 ㄹ 은 r 로도(설아 → seora), 받침 없는 음절의 h(ah · uh · oh)는 붙이지 않아요.
 * 한글 음절이 아니거나 겹받침이면 빈 목록(대조하지 않아요).
 */
export function syllableRomans(syllable: string, nextVowel = false): string[] {
  const jamo = jamoOf(syllable);
  if (!jamo) return [];
  const finals = FINALS[jamo.final];
  if (!finals) return [];
  const initials = [...INITIALS[jamo.initial]];
  let medials = [...MEDIALS[jamo.medial]];
  if (jamo.initial === I_S && jamo.medial === M_I) initials.push("sh");
  if (jamo.initial === I_NONE) {
    // 우 → woo · wu, 이 → yi. 은 · 을 은 eun · eul 만(「운 · 울」과 같은 글자가 되지 않게)
    if (jamo.medial === M_U) medials.push("woo", "wu");
    if (jamo.medial === M_I) medials.push("yi");
    if (jamo.medial === M_EU) medials = ["eu"];
  }
  if (jamo.final === F_NONE) {
    // 받침 없는 ㅓ · ㅕ 는 u · yu 로 적지 않아요(서 → seo · suh, 「수」와 같은 글자가 되지 않게) — 받침이 있을 때만(선 → sun · 현 → hyun)
    if (jamo.medial === M_EO) medials = ["eo"];
    if (jamo.medial === M_YEO) medials = ["yeo"];
    if (!nextVowel) medials.push(...(OPEN_H[jamo.medial] ?? []));
  }
  // 안 → ahn · 한 → hahn
  if (jamo.final === F_N && jamo.medial === M_A) medials.push("ah");
  const ends = jamo.final === F_L && nextVowel ? [...finals, "r"] : finals;
  const out = new Set<string>();
  for (const i of initials) for (const m of medials) for (const f of ends) out.add(i + m + f);
  return [...out];
}

/** 한글 낱말의 음절마다 로마자 표기들 — 대조할 수 없는 글자(한글 아님 · 겹받침)가 하나라도 있으면 null */
function wordRomans(word: string): string[][] | null {
  const syllables = [...word];
  if (syllables.length === 0) return null;
  const out: string[][] = [];
  for (let i = 0; i < syllables.length; i++) {
    const next = i + 1 < syllables.length ? jamoOf(syllables[i + 1]) : null;
    const romans = syllableRomans(syllables[i], next?.initial === I_NONE);
    if (romans.length === 0) return null;
    out.push(romans);
  }
  return out;
}

/** text 의 at 부터 끝까지가 음절 표기를 차례로 이어 붙인 글자인지(음절마다 표기 하나씩, 남는 글자 없이) */
function spells(text: string, romans: readonly (readonly string[])[], at = 0, i = 0): boolean {
  if (i === romans.length) return at === text.length;
  return romans[i].some((r) => text.startsWith(r, at) && spells(text, romans, at + r.length, i + 1));
}

/** 로마자 글자(소문자, 로마자만)가 그 한글 낱말을 음절 그대로 적은 것인지 — 「haneul」 ↔ 「하늘」, 「seojun」 ↔ 「서준」(「서순」은 아님) */
export function spellsHangul(roman: string, word: string): boolean {
  const romans = wordRomans(word);
  return romans !== null && roman !== "" && spells(roman, romans);
}

/**
 * 성씨의 로마자 표기들 — table = 성씨 표의 흔한 표기(정 → jung · jeong · chung …), 여기에 음절 표기(syllableRomans)를 더해요(정 → joung).
 * 한 글자 표기(이 → i · 오 → o)는 대조에 쓰지 않아요 — 이름 끝 · 앞 글자와 가를 수 없어요.
 */
export function surnameRomans(surname: string, table: readonly string[] = []): string[] {
  const out = new Set(table);
  const romans = wordRomans(surname);
  if (romans) {
    let joined = [""];
    for (const options of romans) joined = joined.flatMap((head) => options.map((r) => head + r));
    for (const r of joined) out.add(r);
  }
  return [...out].filter((r) => r.length >= 2);
}

/**
 * 로마자 한 덩어리가 「성 + 이름」 · 「이름 + 성」인지(붙여 쓴 것 — haneuljung · junghaneul), 또는 「성 이니셜 + 이름」 · 「이름 + 성 이니셜」인지(jhaneul · haneulj).
 * 이름은 모든 음절이 맞아야 해요. 이름만 적은 것(haneul)과 이니셜만 적은 것(hj · jhn)은 아니에요 —
 * 덩어리가 이름만으로도 읽히면(「우진」의 woojin 을 w + oojin 으로 읽는 것) 이니셜 꼴로 보지 않아요.
 */
function spellsFullName(chunk: string, surnames: readonly string[], given: readonly (readonly string[])[]): boolean {
  for (const s of surnames) {
    if (chunk.length > s.length && chunk.startsWith(s) && spells(chunk.slice(s.length), given)) return true;
    if (chunk.length > s.length && chunk.endsWith(s) && spells(chunk.slice(0, -s.length), given)) return true;
  }
  if (chunk.length < 2 || spells(chunk, given)) return false;
  const initials = new Set(surnames.map((s) => s[0]));
  return (initials.has(chunk[0]) && spells(chunk.slice(1), given)) || (initials.has(chunk[chunk.length - 1]) && spells(chunk.slice(0, -1), given));
}

/**
 * 이메일 @ 앞이 그 한글 이름(성 surname + 이름 given)을 적은 것인지 — surnames = 성씨의 로마자 표기들(surnameRomans).
 * @ 앞을 로마자 아닌 글자(. _ - + 숫자)로 나눈 조각을 이어 붙여 봐요: haneul.jung · jung.haneul · haneuljung · ha-neul.jung · jung_haneul85 ·
 * j.haneul · jhaneul · haneulj. 이어진 조각들이 성 + 이름을 남김없이 적어야 해요(이름만 · 성씨만 · 이니셜만은 아님 — haneul@ · jung@ · hj@ · hnjung@).
 */
export function emailSpellsKoName(email: string, surnames: readonly string[], given: string): boolean {
  const at = email.lastIndexOf("@");
  const romans = wordRomans(given);
  if (at <= 0 || !romans || surnames.length === 0) return false;
  const pieces = email
    .slice(0, at)
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
  for (let i = 0; i < pieces.length; i++) {
    let chunk = "";
    for (let j = i; j < pieces.length; j++) {
      chunk += pieces[j];
      if (spellsFullName(chunk, surnames, romans)) return true;
    }
  }
  return false;
}

/**
 * 영문 이름 줄의 낱말들(줄을 공백 · 쉼표로 나눈 것, 2~4낱말)이 그 한글 이름을 적은 것인지 —
 * 성이 앞이든 뒤든(「Haneul Jung」 「Jung Haneul」 「JUNG Ha-neul」 「Jung Ha Neul」 「Jung, Haneul」).
 * 첫 · 끝 낱말이 성씨 표기와 같고, 나머지 낱말을 이어 붙인 글자(하이픈 · 띄어쓰기는 빼요)가 이름의 모든 음절을 적어야 해요.
 * 로마자가 없는 낱말(한글 · 숫자 · 기호)이 섞인 줄은 아니에요.
 */
export function wordsSpellKoName(tokens: readonly string[], surnames: readonly string[], given: string): boolean {
  const romans = wordRomans(given);
  if (!romans || tokens.length < 2 || tokens.length > 4) return false;
  if (tokens.some((t) => /[^A-Za-z'’.-]/.test(t))) return false;
  const words = tokens.map((t) => t.toLowerCase().replace(/[^a-z]/g, ""));
  if (words.some((w) => w === "")) return false;
  const rest = (from: number, to: number) => words.slice(from, to).join("");
  if (surnames.includes(words[0]) && spells(rest(1, words.length), romans)) return true;
  return surnames.includes(words[words.length - 1]) && spells(rest(0, words.length - 1), romans);
}
