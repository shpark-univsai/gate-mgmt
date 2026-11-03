// 명함 읽기(UG-431) — 읽은 글자를 줄(칩)로 나누고, 네 칸(회사명 · 이름 · 고객 이메일 · 연락처)에 넣는 규칙.
// 화면 · 브라우저에 기대지 않는 순수 함수만 둬요(글자 읽기 자체는 card-ocr.ts). 칩 규칙 번호는 Figma 「칩 동작 규칙 (N3b)」.
// 회사명 · 이름은 짐작이에요 — 틀리면 직원이 칩을 눌러 바꾸거나 직접 고쳐요.

export type ScanField = "company" | "name" | "email" | "phone";

/** email = 메일 모양(@) · phone = 전화번호 모양(숫자 묶음) · other = 그 밖(이름 · 회사 · 직함 · 주소 등) */
export type ChipKind = "email" | "phone" | "other";

/**
 * 읽은 한 줄(라벨 · 구분자로 나눈 조각). text = 칩에 보이는 글자(읽은 그대로), value = 메일 · 전화 칩이 칸에 넣는 값(뽑은 주소 · 번호).
 * fax = 고른 번호가 팩스 라벨 바로 뒤 번호, titled = 같은 줄에 직함이 붙어 있음(이름 후보 순위)
 */
export type Chip = { id: number; text: string; kind: ChipKind; value: string; fax?: boolean; titled?: boolean };

export type ScanValues = Record<ScanField, string>;

/** 칸 → 그 칸에 들어간 칩 번호. 한 칸에는 칩 하나만(규칙 4), 칩 하나도 한 칸에만 들어가요. */
export type ScanLinks = Partial<Record<ScanField, number>>;

/** 칩을 눌렀을 때 할 일. set = 그 칸을 이 값으로, focus = 커서를 둘 칸 */
export type ChipTap = { links: ScanLinks; set?: { field: ScanField; value: string }; focus?: ScanField };

/** 한 명함에서 칩으로 보여 줄 줄 수 상한 — 뒷면 약관 같은 긴 글을 찍어도 창이 넘치지 않게 */
const MAX_CHIPS = 30;

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
// 숫자로 시작해 숫자로 끝나는 묶음(사이에 공백 · . · - · 괄호). 자리 수는 아래에서 따로 봐요.
const PHONE_RUN_RE = /\+?\(?\d[\d\s().-]{6,}\d/g;
// 사업자 등록번호(123-45-67890) — 숫자 묶음이지만 전화번호가 아니에요
const BIZ_NO_RE = /^\d{3}-\d{2}-\d{5}$/;
// 날짜(2019.03.01 · 01/03/2019) — 숫자 묶음이지만 전화번호가 아니에요(「Since 2019.03.01」)
const DATE_RE = /^(19|20)\d{2}[./-]\d{1,2}[./-]\d{1,2}$|^\d{1,2}[./-]\d{1,2}[./-](19|20)\d{2}$/;
const URL_RE = /^(https?:\/\/|www)|\.(com|net|org|co\.kr|kr|io|ai)(\/|$)/i;
// 팩스 라벨 — 번호 바로 앞 구간(앞 번호가 끝난 뒤 ~ 이 번호 앞)에서만 봐요. 줄 전체에 걸면 「T … F …」 줄의 전화번호도 팩스가 돼요.
const FAX_BEFORE_RE = /fax|팩스|(^|[^A-Za-z])F\s*[.:)]?\s*$/i;

// 줄 가운데의 항목 라벨(T. · M. · E. · Tel · Mobile · Fax · Email …) 앞에서 줄을 나눠요 — 「M. 010-… E. hong@…」 처럼 한 줄에 둘이 있으면
// 메일 칩이 전화번호를 삼켜요. 한 글자 라벨은 대문자만(주소 낱말과 헷갈리지 않게), 바로 뒤에 번호 · 메일이 와야 라벨로 봐요.
const PHONE_LABEL = "(?:T|M|F|P|H|Tel|TEL|tel|Phone|PHONE|Mobile|MOBILE|Mob|Cell|HP|Fax|FAX|fax|Direct|DID|전화|휴대폰|휴대전화|핸드폰|팩스|직통)";
const EMAIL_LABEL = "(?:E|E-mail|E-Mail|EMAIL|Email|email|Mail|MAIL|이메일|메일)";
const LABEL_SPLIT_RE = new RegExp(
  `\\s+(?=${PHONE_LABEL}\\s*[.:)]?\\s*[+(\\d]|${EMAIL_LABEL}\\s*[.:)]?\\s*[A-Za-z0-9._%+-]+@)`,
  "g",
);
// 구분자: 띄어 쓴 / · · · • 와 | (붙어 있어도)
const SEPARATOR_RE = /\s+[/·•]\s+|\s*\|\s*/;

// 회사 표시. 법인 표시가 「Company」 낱말보다 확실해요(로고 글자 「COMPANY-A」보다 「Company A Co., Ltd.」 줄을 고르게).
// 뒤에 - 가 붙은 낱말(Co-founder · Co-CEO)은 법인 표시가 아니에요.
const COMPANY_STRONG_RE = /\(주\)|㈜|\(유\)|주식회사|유한회사|\b(inc|corp|corporation|co|ltd|llc|gmbh|limited)\b(?!-)\.?/i;
const COMPANY_RE = /\(주\)|㈜|\(유\)|주식회사|유한회사|\b(inc|corp|corporation|co|ltd|llc|gmbh|limited|company)\b(?!-)\.?/i;

// 직함 · 부서 낱말 — 이름 줄에서 떼어 내고, 이것만 있는 줄은 이름으로 보지 않아요
const KO_TITLES = new Set(
  (
    "대표 대표이사 공동대표 이사 상무 전무 부사장 사장 회장 부회장 본부장 실장 팀장 부장 차장 과장 대리 주임 사원 " +
    "매니저 책임 선임 수석 연구원 책임연구원 선임연구원 수석연구원 주임연구원 소장 센터장 원장 교수 박사 프로 위원 " +
    "고문 그룹장 파트장 담당 지점장 지사장 부문장 사업부장 이사장 감사 컨설턴트 엔지니어 디자이너 변호사 회계사 세무사"
  ).split(" "),
);
// 2~4글자라 이름처럼 보이지만 명함에서 흔한 낱말(항목 이름 · 지역 · 직무)
const KO_STOPWORDS = new Set(
  (
    "주소 전화 휴대폰 휴대전화 핸드폰 팩스 이메일 메일 홈페이지 본사 지사 공장 연구소 사무소 대한민국 한국 서울 " +
    "영업 마케팅 개발 기획 경영 경영지원 인사 총무 재무 기술 연구 연구개발 사업 해외영업 국내영업 고객지원"
  ).split(" "),
);
const KO_DEPT_SUFFIX = /(팀|본부|센터|사업부|연구소|그룹|파트|부문|지사|지점|사무소)$/;
const EN_STOPWORDS = new Set(
  (
    "ceo cto cfo coo cmo cio vp evp svp president vice chairman founder co-founder manager director head lead senior " +
    "junior chief officer engineer developer designer consultant sales marketing business development research team " +
    "department dept division group global korea seoul republic road street st avenue ave building bldg floor fl tower " +
    "center centre office tel fax mobile phone email e-mail www http https representative partner principal executive " +
    "general assistant associate specialist analyst researcher professor dr mr ms mrs strategy product operations " +
    "the and of"
  ).split(" "),
);
// 이름 줄에 붙는 영문 직함(이름 후보 순위용)
const EN_TITLES = new Set(
  (
    "ceo cto cfo coo cmo cio vp evp svp president chairman founder co-founder manager director head lead officer " +
    "engineer developer designer consultant representative partner principal executive specialist analyst researcher professor"
  ).split(" "),
);
// 회사 메일이 아니라서 회사명을 짐작할 수 없는 도메인
const FREE_MAIL = new Set(
  "gmail naver daum hanmail kakao nate outlook hotmail live yahoo icloud me proton protonmail msn".split(" "),
);

/** 띄어 읽힌 한글 낱자(「홍 길 동」)를 붙여요 — 명함은 이름을 띄어 쓰는 일이 많아요. */
function joinSpacedHangul(line: string): string {
  const out: string[] = [];
  let run = "";
  for (const t of line.split(" ")) {
    if (/^[가-힣]$/.test(t)) {
      run += t;
      continue;
    }
    if (run) out.push(run);
    run = "";
    out.push(t);
  }
  if (run) out.push(run);
  return out.join(" ");
}

/** 한 조각 정리: 공백을 고르고, 홀로 읽힌 기호와 앞뒤 테두리 잡음을 떼요. */
function cleanSegment(raw: string): string {
  const line = raw
    // 낱말 사이에 홀로 읽힌 기호(「홍길동 _ 팀장」의 _)
    .replace(/(^|\s)[_=~—–•·]+(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    // 앞뒤에 붙는 테두리 · 구분선 잡음
    .replace(/^[|_=~—–•·:;,'"`]+\s*/, "")
    .replace(/\s*[|_=~—–•·:;,'"`]+$/, "");
  return joinSpacedHangul(line);
}

const isMeaningful = (line: string) => {
  const meaningful = line.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
  // 글자 · 숫자가 2개 미만이거나 기호가 글자보다 많으면 잡음(무늬 · 로고를 글자로 읽은 것)
  return meaningful >= 2 && meaningful * 2 >= line.replace(/\s/g, "").length;
};

/** 직함 낱말만으로 된 조각(「팀장」 · 「Sales Manager」 같은) */
const isRoleOnly = (seg: string) => {
  const tokens = seg.split(" ").filter(Boolean);
  return tokens.length > 0 && tokens.every((t) => isRoleToken(t) || EN_TITLES.has(t.toLowerCase().replace(/[.,]/g, "")));
};
const hasRole = (seg: string) => seg.split(" ").some((t) => isRoleToken(t) || EN_TITLES.has(t.toLowerCase().replace(/[.,]/g, "")));

type Segment = { text: string; titled: boolean };

/**
 * 읽은 글자 → 조각 목록. 줄마다 구분자(/ · | …)와 줄 가운데 항목 라벨(T. · M. · E. · Fax …) 앞에서 나누고 정리해요.
 * 잡음 조각과 같은 조각은 빼요. titled = 그 조각에 직함이 있거나, 같은 줄 바로 옆 조각이 직함뿐(「홍길동 | 팀장」).
 */
function readSegments(text: string): Segment[] {
  const seen = new Set<string>();
  const out: Segment[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/＠/g, "@").replace(/\s*@\s*/g, "@").replace(/\s+/g, " ").trim();
    const segs = line
      .split(SEPARATOR_RE)
      .flatMap((part) => part.split(LABEL_SPLIT_RE))
      .map(cleanSegment)
      .filter(isMeaningful);
    segs.forEach((seg, i) => {
      if (seen.has(seg)) return;
      seen.add(seg);
      const titled = hasRole(seg) || (i > 0 && isRoleOnly(segs[i - 1])) || (i + 1 < segs.length && isRoleOnly(segs[i + 1]));
      out.push({ text: seg, titled });
    });
  }
  return out;
}

/** 읽은 글자 → 칩으로 보여 줄 줄(조각) 목록 */
export function readLines(text: string): string[] {
  return readSegments(text).map((s) => s.text);
}

/** 전화번호 모양만 남겨요 — 서버가 받는 글자(숫자 · 공백 · + · - · ( · ))로, 점은 - 로 바꿔요. */
function normalizePhone(run: string): string {
  return run
    .replace(/\./g, "-")
    .replace(/\s+/g, " ")
    .replace(/\s*-\s*/g, "-")
    .trim();
}

const digitsOf = (s: string) => s.replace(/\D/g, "");
/** 휴대전화(010 · +82 10) — 연락처 칸에 먼저 넣어요 */
const isMobile = (phone: string) => /^(010|8210|82010)/.test(digitsOf(phone));

type PhoneHit = { value: string; fax: boolean };

/** 줄의 전화번호들. 날짜 · 사업자 등록번호는 빼고, 번호 바로 앞 구간에 팩스 라벨이 있으면 fax. */
function phoneHits(line: string): PhoneHit[] {
  const valid = (p: string) => {
    const n = digitsOf(p).length;
    return n >= 8 && n <= 15 && !BIZ_NO_RE.test(p);
  };
  const hits: PhoneHit[] = [];
  let prevEnd = 0;
  for (const m of line.matchAll(PHONE_RUN_RE)) {
    const before = line.slice(prevEnd, m.index);
    prevEnd = m.index + m[0].length;
    if (DATE_RE.test(m[0].trim())) continue;
    const fax = FAX_BEFORE_RE.test(before);
    const whole = normalizePhone(m[0]);
    // 「02-123-4567 010-1234-5678」처럼 공백으로만 이어진 두 번호는 한 묶음으로 읽혀요 — 너무 길면 공백에서 나눠 봐요
    for (const value of valid(whole) ? [whole] : whole.split(" ").filter(valid)) hits.push({ value, fax });
  }
  return hits;
}

/** 고를 번호: 휴대전화(팩스 아님) → 팩스 아닌 번호 → 그 밖 */
function bestPhone(hits: PhoneHit[]): PhoneHit | undefined {
  return hits.find((h) => !h.fax && isMobile(h.value)) ?? hits.find((h) => !h.fax) ?? hits[0];
}

/** 줄에서 전화번호를 뽑아요(여럿이면 휴대전화 먼저, 팩스는 나중). 없으면 "" */
export function extractPhone(line: string): string {
  return bestPhone(phoneHits(line))?.value ?? "";
}

/**
 * 줄에서 메일 주소를 뽑아요. 붙어 읽힌 앞 라벨(「E.john@…」 · 「Email:…」)과 끝 도메인 뒤에 붙은 낱말(「…company.comTel」)은 떼요.
 * 앞 라벨은 대문자 E · Email · Mail 만 — 소문자로 시작하는 주소(e.kim@…)는 그대로 둬요.
 */
export function extractEmail(line: string): string {
  const m = line.match(EMAIL_RE);
  if (!m) return "";
  const at = m[0].lastIndexOf("@");
  const local = m[0].slice(0, at).replace(/^(?:E-?[Mm]ail|EMAIL|Mail|MAIL|E)[.:]+/, "") || m[0].slice(0, at);
  const labels = m[0].slice(at + 1).split(".");
  const last = labels.pop() ?? "";
  // 소문자 끝 도메인 뒤에 대문자로 시작하는 낱말이 붙었으면 잘라요(comTel → com)
  const cut = last.match(/^([a-z]{2,})[A-Z]/);
  labels.push(cut ? cut[1] : last);
  return `${local}@${labels.join(".")}`;
}

/** 한 줄의 종류와 칸에 넣을 값. 메일이 함께 있는 줄은 메일로 봐요(메일 칸이 더 중요해요 — 라벨로 나눈 뒤라 드물어요). */
export function classifyLine(line: string): { kind: ChipKind; value: string; fax?: boolean } {
  const email = extractEmail(line);
  if (email) return { kind: "email", value: email };
  const phone = bestPhone(phoneHits(line));
  if (phone) return { kind: "phone", value: phone.value, ...(phone.fax ? { fax: true } : {}) };
  return { kind: "other", value: line };
}

export function toChips(text: string): Chip[] {
  return readSegments(text)
    .slice(0, MAX_CHIPS)
    .map((seg, i) => ({ id: i + 1, text: seg.text, ...classifyLine(seg.text), ...(seg.titled ? { titled: true } : {}) }));
}

export const looksLikeCompany = (line: string) => COMPANY_RE.test(line);

/** 이름 옆에 붙는 직함 · 부서 낱말인지 — 붙어 읽힌 「해외영업팀팀장」 같은 낱말도 */
function isRoleToken(t: string): boolean {
  if (KO_TITLES.has(t)) return true;
  if (t.length < 3) return false;
  if (KO_DEPT_SUFFIX.test(t)) return true;
  for (const title of KO_TITLES) if (title.length >= 2 && t.length > title.length && t.endsWith(title)) return true;
  return false;
}

/**
 * 줄이 사람 이름처럼 보이면 직함을 뗀 이름, 아니면 null.
 * 한글: 직함 · 부서 낱말을 빼고 남은 한 낱말이 2~4글자. 로마자: 대문자로 시작하는 2~3낱말(직함 · 회사 낱말 없음).
 */
export function nameFromLine(line: string): string | null {
  if (/[\d@]/.test(line) || looksLikeCompany(line)) return null;
  for (const part of line.split(/\s*[,|/·•]\s*/)) {
    // 기호뿐인 낱말(읽을 때 생긴 _ · - 등)과 직함 · 부서 낱말은 빼고 봐요
    const ko = part.split(" ").filter((t) => /[\p{L}\p{N}]/u.test(t) && !isRoleToken(t));
    if (ko.length === 1 && /^[가-힣]{2,4}$/.test(ko[0]) && !KO_STOPWORDS.has(ko[0]) && !KO_TITLES.has(ko[0]) && !KO_DEPT_SUFFIX.test(ko[0])) {
      return ko[0];
    }
    const en = part.split(" ").filter((t) => /[\p{L}\p{N}]/u.test(t));
    if (
      en.length >= 2 &&
      en.length <= 3 &&
      en.every((t) => /^[A-Z][A-Za-z'’-]*[a-zA-Z]$/.test(t) && (t === t.toUpperCase() || t.slice(1) === t.slice(1).toLowerCase())) &&
      !en.some((t) => EN_STOPWORDS.has(t.toLowerCase().replace(/[.'’]/g, "")))
    ) {
      return en.join(" ");
    }
  }
  return null;
}

/** 칩을 그 칸에 넣을 때의 글자. 메일 · 전화 칩은 뽑은 값, 이름 칸은 직함을 뗀 이름, 나머지는 읽은 줄 그대로. */
export function chipValueFor(chip: Chip, field: ScanField): string {
  if (field === "email" && chip.kind === "email") return chip.value;
  if (field === "phone" && chip.kind === "phone") return chip.value;
  if (field === "name") return nameFromLine(chip.text) ?? chip.text;
  return chip.text;
}

const lettersOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9가-힣]/g, "");

/**
 * 처음 채우기(동작 규칙 3 · 칩 규칙 1 · 7): 메일은 @ 모양, 연락처는 숫자 묶음(휴대전화 → 팩스 아닌 번호 → 그 밖),
 * 회사명은 회사 표시((주) · ㈜ · 주식회사 · Inc · Co., Ltd · Corp · LLC …) 줄 → 없으면 회사 메일 도메인과 맞는 줄,
 * 이름은 이름 모양 줄(한글 먼저). 못 찾은 칸은 비워요(동작 규칙 4).
 */
export function autoFill(chips: Chip[]): { values: ScanValues; links: ScanLinks } {
  const values: ScanValues = { company: "", name: "", email: "", phone: "" };
  const links: ScanLinks = {};
  const used = new Set<number>();
  const put = (field: ScanField, chip: Chip | undefined) => {
    if (!chip) return;
    values[field] = chipValueFor(chip, field);
    links[field] = chip.id;
    used.add(chip.id);
  };

  put("email", chips.find((c) => c.kind === "email"));

  const phones = chips.filter((c) => c.kind === "phone");
  put("phone", phones.find((c) => !c.fax && isMobile(c.value)) ?? phones.find((c) => !c.fax) ?? phones[0]);

  const others = () => chips.filter((c) => c.kind === "other" && !used.has(c.id));
  // 홈페이지 주소 줄(www.company-a.com)은 회사명이 아니에요 — 「company」 낱말이 들어 있어도
  const candidates = () => others().filter((c) => !URL_RE.test(c.text));
  // 회사 메일 도메인(company-a.com → companya)과 맞는 줄 — 회사명 후보이고, 이름 후보에서는 빼요
  const domain = values.email.split("@")[1]?.split(".")[0]?.toLowerCase() ?? "";
  const key = !FREE_MAIL.has(domain) ? lettersOf(domain) : "";
  const matchesDomain = (c: Chip) => {
    const l = lettersOf(c.text);
    return key.length >= 3 && l.length >= 3 && (l.includes(key) || key.includes(l));
  };
  const company =
    candidates().find((c) => COMPANY_STRONG_RE.test(c.text)) ??
    candidates().find((c) => looksLikeCompany(c.text)) ??
    candidates().find(matchesDomain);
  put("company", company);

  // 이름 후보 순위: 직함과 같은 줄 > 한글 3글자 > 그 밖의 한글 > 로마자 — 법인 표시 없는 2~4글자 회사명(「유니브스」)이 이름으로 가지 않게
  const score = (c: Chip) => {
    const name = nameFromLine(c.text) ?? "";
    const ko = /^[가-힣]+$/.test(name);
    return (c.titled ? 4 : 0) + (ko && name.length === 3 ? 2 : 0) + (ko ? 1 : 0);
  };
  const named = others().filter((c) => !matchesDomain(c) && nameFromLine(c.text) !== null);
  put("name", named.reduce<Chip | undefined>((best, c) => (!best || score(c) > score(best) ? c : best), undefined));

  return { values, links };
}

/** 읽은 글자 → 칩 · 네 칸 값 · 연결. 줄이 하나도 없으면 chips 가 비어요(읽지 못함). */
export function scanCard(text: string): { chips: Chip[]; values: ScanValues; links: ScanLinks } {
  const chips = toChips(text);
  return { chips, ...autoFill(chips) };
}

/** 칩이 「칸에 들어감」으로 보이는지 — 잠긴 칸(숨은 값)에 연결된 칩은 「아직 안 씀」으로 보여요 */
export function isFilled(links: ScanLinks, chipId: number, locked: readonly ScanField[] = []): boolean {
  const f = fieldOf(links, chipId);
  return f !== null && !locked.includes(f);
}

/** 이 칩이 들어가 있는 칸(없으면 null) */
export function fieldOf(links: ScanLinks, chipId: number): ScanField | null {
  for (const f of Object.keys(links) as ScanField[]) if (links[f] === chipId) return f;
  return null;
}

/**
 * 칩을 눌렀을 때(칩 규칙 2~6).
 * - 「칸에 들어감」 칩 → 그 칸을 비우고 칩은 「아직 안 씀」(5)
 * - 메일 칩 → 고객 이메일 칸, 전화 칩 → 연락처 칸 — 커서와 상관없이(2)
 * - 그 밖의 칩 → 커서가 있는 칸. 커서가 없으면 회사명 → 이름 중 빈 칸, 둘 다 차 있으면 넣지 않고 이름 칸에 커서(3)
 * - 이미 칩이 들어간 칸에 넣으면 바꿔 끼우고 앞 칩은 「아직 안 씀」(4)
 * - 직접 고쳐 연결이 끊긴 칩은 「아직 안 씀」이라 칸을 지우지 않고 다시 넣어요(6)
 * locked = 지금 고칠 수 없는 칸(이미 만든 계정의 회사명 등) — 그 칸에는 넣지 않고, 그 칸에 연결된 칩은 「아직 안 씀」으로 봐요.
 */
export function tapChip(
  chip: Chip,
  links: ScanLinks,
  values: ScanValues,
  cursor: ScanField | null,
  locked: readonly ScanField[] = [],
): ChipTap {
  let current = fieldOf(links, chip.id);
  if (current && locked.includes(current)) {
    // 잠긴 칸의 칩은 화면에서 「아직 안 씀」으로 보여요 — 누르면 잠긴 칸(숨은 값)을 비우지 않고 연결만 풀어 새로 넣어요
    links = unlink(links, current);
    current = null;
  }
  if (current) {
    const next = { ...links };
    delete next[current];
    return { links: next, set: { field: current, value: "" } };
  }
  let target: ScanField | null;
  if (chip.kind === "email") target = "email";
  else if (chip.kind === "phone") target = "phone";
  else if (cursor) target = cursor;
  else if (!values.company.trim() && !locked.includes("company")) target = "company";
  else if (!values.name.trim() && !locked.includes("name")) target = "name";
  else return { links, focus: "name" };
  if (locked.includes(target)) return { links };
  return { links: { ...links, [target]: chip.id }, set: { field: target, value: chipValueFor(chip, target) } };
}

/** 직원이 칸을 직접 고치면 그 칸의 칩은 「아직 안 씀」으로(칩 규칙 6). 고친 글자는 그대로 둬요. */
export function unlink(links: ScanLinks, field: ScanField): ScanLinks {
  if (links[field] === undefined) return links;
  const next = { ...links };
  delete next[field];
  return next;
}
