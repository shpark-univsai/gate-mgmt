// 명함 읽기(UG-431) — 읽은 글자를 줄(칩)로 나누고, 네 칸(회사명 · 이름 · 고객 이메일 · 연락처)에 넣는 규칙.
// 화면 · 브라우저에 기대지 않는 순수 함수만 둬요(글자 읽기 자체는 card-ocr.ts). 칩 규칙 번호는 Figma 「칩 동작 규칙 (N3b)」.
// 처음 채우기는 모양이 정해진 이메일 · 연락처, 그리고 확실한 회사명 · 이름(UG-451 기획 17100 — 아래 「회사명 · 이름 자동 채움」).
// 회사명 · 이름은 잘못 읽는 일이 많아(한글 이름 「Sau TH」 등, 기획 16846) 확실하지 않으면 비워 두고 직원이 칩을 눌러 넣어요.
import { emailSpellsKoName, surnameRomans, wordsSpellKoName } from "./ko-roman.ts";
import { isKnownTld } from "./tlds.ts";

export type ScanField = "company" | "name" | "email" | "phone";

/** email = 메일 모양(@) · phone = 전화번호 모양(숫자 묶음) · other = 그 밖(이름 · 회사 · 직함 · 주소 등) */
export type ChipKind = "email" | "phone" | "other";

/**
 * 읽은 한 줄(라벨 · 구분자로 나눈 조각). text = 칩에 보이는 글자(읽은 그대로), value = 메일 · 전화 칩이 칸에 넣는 값(뽑은 주소 · 번호).
 * fax = 고른 번호가 팩스 라벨 바로 뒤 번호.
 * suspect = 앞뒤 줄 · 조각을 함께 봐야 알 수 있는 「잘렸을 수 있는」 메일 칩(UG-451, readSegments) — 처음 채우기와 칸 값 경고(isSuspectValue)에 써요.
 *   「작성 중」 저장에도 남아요(이어서 만들어도 경고가 이어지게, 반박 리뷰 F2).
 * 잘렸을 수 있는 메일 칩은 text · value 모두 떨어진 앞 덩어리 · 꼬리까지 읽은 그대로예요(UG-451 기획 17022 — 「tan@x.com · sg」).
 */
export type Chip = { id: number; text: string; kind: ChipKind; value: string; fax?: boolean; suspect?: boolean };

export type ScanValues = Record<ScanField, string>;

/** 칸 → 그 칸에 들어간 칩 번호. 한 칸에는 칩 하나만(규칙 4), 칩 하나도 한 칸에만 들어가요. */
export type ScanLinks = Partial<Record<ScanField, number>>;

/** 칩을 눌렀을 때 할 일. set = 그 칸을 이 값으로, focus = 커서를 둘 칸 */
export type ChipTap = { links: ScanLinks; set?: { field: ScanField; value: string }; focus?: ScanField };

/** 한 명함에서 칩으로 보여 줄 줄 수 상한 — 뒷면 약관 같은 긴 글을 찍어도 창이 넘치지 않게 */
const MAX_CHIPS = 30;
/** 한 줄에서 보는 글자 수 상한 — 긴 줄에서 정규식이 느려지지 않게 앞부분만 봐요(명함 한 줄은 이보다 훨씬 짧아요) */
const MAX_LINE = 300;

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
const EMAIL_RE_G = new RegExp(EMAIL_RE.source, "g");
// 숫자로 시작해 숫자로 끝나는 묶음(사이에 공백 · . · - · 괄호). 자리 수는 아래에서 따로 봐요.
const PHONE_RUN_RE = /\+?\(?\d[\d\s().-]{6,}\d/g;
// 사업자 등록번호(123-45-67890) — 숫자 묶음이지만 전화번호가 아니에요
const BIZ_NO_RE = /^\d{3}-\d{2}-\d{5}$/;
// 날짜(2019.03.01 · 01/03/2019) — 숫자 묶음이지만 전화번호가 아니에요(「Since 2019.03.01」)
const DATE_RE = /^(19|20)\d{2}[./-]\d{1,2}[./-]\d{1,2}$|^\d{1,2}[./-]\d{1,2}[./-](19|20)\d{2}$/;
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

// 회사 표시 — 회사명 줄은 이름 칸에 넣을 때 이름으로 보지 않아요. 뒤에 - 가 붙은 낱말(Co-founder · Co-CEO)은 법인 표시가 아니에요.
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

// 깨진 줄 판별(isGarbled)용. 줄에 섞여도 되는 기호 — 그 밖의 기호($ % * = ? ! ^ [ ] { } < > 등)는 잘못 읽은 표시로 봐요.
const ALLOWED_SYMBOL_RE = /[.,()&'’\-/+#@:;~·"“”㈜®™©]/u;
const isOddSymbol = (ch: string) => !/[\p{L}\p{N}\s]/u.test(ch) && !ALLOWED_SYMBOL_RE.test(ch);
// 짧은 토막으로 세지 않는 소문자 낱말(이름 · 회사명 · 주소에 흔한 전치사 · 관사)
const SHORT_WORDS = new Set("of de la le da du di et at in on to by".split(" "));
// 명함에 흔한 대문자 두 글자 낱말(부서 · 직함 · 분야 · 나라 · 회사 약칭) — 「대문자 2글자 토막」으로 세지 않아요(기획 16861)
const CAPS_WORDS = new Set(
  (
    "AI AR VR XR MR HR GA QA QC CS CX UX UI IT IR PR PM PO PD MD GM VP BD BI SI CI TF SW HW IP OS DB ML DL DT DX AX " +
    "EV TV PC HQ RA SE TL II US UK EU KR JP CN LA NY SF " +
    "LG SK KT GS LS CJ HD KB NH"
  ).split(" "),
);

// 로마자 한국 성씨(대문자 1 + 소문자) — 「Park JH」 「Kim, YJ」처럼 성씨 뒤 대문자 2글자는 이름 이니셜이라 토막으로 세지 않아요(「Sau TH」와 구분)
const KO_SURNAMES = new Set(
  (
    "kim lee yi rhee park pak bak choi choe jung jeong chung kang cho jo yoon yun jang chang lim im han oh seo suh shin sin " +
    "kwon gwon hwang ahn an song jeon jun chun hong yoo yu ryu ko go moon mun yang son sohn bae baek paek heo hur huh nam " +
    "shim sim noh roh no ha kwak gwak sung seong cha joo ju woo wu koo gu min na jin ji eom um chae won bang kong gong hyun " +
    "ham byun byeon yeom yeo choo chu do so seok suk sun seol ma gil yeon wi pyo myung ki ban wang geum ok yook yuk in " +
    "maeng je mo tak kook guk eo eun yong ye kyung bong sa bu hwangbo namgoong namkung seonwoo jegal dokgo"
  ).split(" "),
);
// 한 글자지만 부서 · 주소 단위라 뜻이 있는 한글(「dx 팀」 「영업2 팀」)
const KO_UNITS = new Set("팀 과 부 실 국 층 호 동 관 점 원 처 단".split(" "));

/** 낱말 앞뒤의 기호를 뗀 알맹이 */
const coreOf = (token: string) => token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");

/**
 * 낱말 종류(기획 16846 · 16861).
 * - frag: 의미 없는 짧은 토막 — 소문자로 시작하는 1~2글자 로마자(「ud」 「dg」), 이상한 기호($ % ^ …)만 있는 낱말(「^^」)
 * - caps: 대문자 2글자 토막(「TH」) — 줄 첫 낱말이 아니고, 줄에 소문자 로마자가 있고, 알려진 약어가 아니고,
 *   첫 낱말이 로마자 성씨가 아닐 때만(「Park JH」 「Kim, YJ」는 이름 이니셜). 「LG 전자」 「LEE JI AN」 「JH Park」은 그대로.
 * - digit: 숫자가 섞인 짧은 한글(「이아7」) — 「카페24」 「타워2」 「영업2 팀」처럼 정상 이름에도 흔해서, 줄 전체가 뜻 없는 짧은 낱말일 때만 봐요
 * - ok: 그 밖(한글 한 글자 「및」, 「Ji」 같은 이름 음절, 약어, 숫자 등)
 */
type TokenKind = "frag" | "caps" | "digit" | "ok";

function tokenKind(token: string, capsCounts: boolean): TokenKind {
  const core = coreOf(token);
  if (!core) return [...token].some(isOddSymbol) ? "frag" : "ok";
  if (/^(?!제)[가-힣]{1,3}\d{1,3}$/.test(core)) return "digit";
  if (/\d/.test(core)) return "ok";
  if (capsCounts && /^[A-Z]{2}$/.test(core) && !CAPS_WORDS.has(core)) return "caps";
  return /^[a-z][A-Za-z]?$/.test(core) && !SHORT_WORDS.has(core.toLowerCase()) ? "frag" : "ok";
}

/** 토막이 아닌 「뜻이 있는」 낱말인지 — 한글 2글자 이상, 로마자 · 숫자 3글자 이상, 알려진 약어, 부서 · 주소 단위(팀 · 층), 「3층」 「101호」 */
function isSubstantial(token: string): boolean {
  const core = coreOf(token);
  return /^[가-힣]{2,}$/.test(core) || [...core].length >= 3 || CAPS_WORDS.has(core) || KO_UNITS.has(core) || /^\d+[가-힣]+$/.test(core);
}

/**
 * 글자 읽기가 무늬 · 로고를 잘못 읽어 깨진 줄인지(예: 「SRT $e ud an 헤르 PIE AR」 「은 이아7 났」 「Sau TH」) — 칩에서 빼요.
 * 정상 줄(이름 · 회사명 · 주소 · 직함 · 부서)이 빠지는 쪽이 더 나빠서, 토막(tokenKind)이 있는 줄만 봐요.
 * - 공백 빼고 2글자 이하(「ud」 「를 0」) — 한글 2글자(「김민」 같은 이름)만 남겨요. 「HR」 「AI」 홀로도 빠져요(이름 · 회사명 칸에 쓸 일이 없어요).
 * - 토막(frag · caps)이 낱말의 절반 이상 — 토막이 2개 이상이거나 대문자 토막이 있을 때(「ud an」 「Sau TH」).
 *   토막 하나에 뜻 있는 낱말이 붙은 줄(「iM 뱅크」 「eo Studio」)은 남겨요.
 * - 토막(숫자 섞인 한글 포함)이 있고 나머지가 모두 뜻 없는 짧은 낱말(「은 이아7 났」 「Tx dg」) — 숫자 섞인 한글 한 낱말뿐인 줄(「카페24」)은 남겨요.
 * - 토막이 2개 이상 · 낱말의 1/3 이상이면서 이상한 기호가 섞였거나 한 줄에 한글 · 로마자가 뒤섞였을 때
 * 메일 · 전화 줄은 보지 않아요(모양이 정해져 있어 따로 뽑아요).
 */
export function isGarbled(line: string): boolean {
  if (extractEmail(line) || phoneHits(line).length > 0) return false;
  const compact = line.replace(/\s/g, "");
  if ([...compact].length <= 2) return !/^[가-힣]{2}$/.test(compact);
  const tokens = line.split(" ").filter(Boolean);
  const surnameFirst = KO_SURNAMES.has(coreOf(tokens[0]).toLowerCase());
  const capsCounts = /[a-z]/.test(line) && !surnameFirst;
  const kinds = tokens.map((t, i) => tokenKind(t, capsCounts && i > 0));
  const frags = kinds.filter((k) => k === "frag").length;
  const caps = kinds.filter((k) => k === "caps").length;
  const digits = kinds.filter((k) => k === "digit").length;
  const strong = frags + caps;
  if (strong + digits === 0) return false;
  if ((strong >= 2 || caps >= 1) && strong * 2 >= tokens.length) return true;
  const restMeaningless = !tokens.some((t, i) => kinds[i] === "ok" && isSubstantial(t));
  if (restMeaningless && (strong >= 1 || tokens.length >= 2)) return true;
  const oddSymbol = [...line].some(isOddSymbol);
  const mixedScript = /[가-힣]/.test(line) && /[A-Za-z]/.test(line);
  return strong >= 2 && strong * 3 >= tokens.length && (oddSymbol || mixedScript);
}

/**
 * 칩으로 보여 줄 필요가 없는 짧은 잡음 줄(UG-451).
 * - 글자(한글 · 로마자) 없이 숫자 · 기호만 있는 줄 — 처음 채우기에 쓸 전화번호(phoneHits 의 rank 가 있는 번호)가 있으면 남겨요.
 *   QR 무늬를 읽은 「11800 8083」 같은 줄이 빠져요.
 * - 띄어쓰기 없는 한글 정확히 2글자(「대표」 「주소」 — 2글자 이름도 빠져요, 기획 결정)
 * - 로마자 대문자만 1~2글자(「HR」 「A」). 3글자 약칭(「DBS」 「UOB」 「IBK」)은 은행 · 회사 이름일 수 있어 남겨요(「HHL」 같은 잡음도 남아요).
 *   「R&D 및 AI 팀」 「B 동 3 층」 같은 줄은 남아요.
 */
export function isJunkChip(line: string): boolean {
  const compact = line.replace(/\s/g, "");
  if (!/\p{L}/u.test(compact)) return !phoneHits(line).some((h) => h.rank !== null);
  return /^[가-힣]{2}$/.test(line) || /^[A-Z]{1,2}$/.test(line);
}

// 줄을 나눈 조각이 메일로 시작하는지(「jung@…」) — 앞 조각 · 앞 줄과 이어 읽어야 할 수 있어요
const startsWithEmail = (seg: string) => /^[A-Za-z0-9._%+-]+@/.test(seg) && extractEmail(seg) !== "";
// 메일 앞부분처럼 보이는 공백 없는 한 덩어리(「daeun」) — 로마자 소문자로 시작해요. 메일 라벨(e · email · mail)은 빼요.
// 숫자 · - · + · 괄호만인 조각(「010-1234-5678」)과 대문자로 시작하는 낱말(「Seoul」 「UNIVS」 「Sales」)은 덩어리로 보지 않아요.
const isLoneChunk = (seg: string) => /^[a-z][A-Za-z0-9_%+-]*$/.test(seg) && !EMAIL_LABEL_TOKEN_RE.test(seg);
// 줄바꿈으로 잘린 메일 앞부분(「daeun.」 「daeun_」 「daeun-」) — 소문자로 시작하는 공백 없는 한 덩어리가 . _ - 로 끝나고,
// 끝 글자 말고는 점이 없어요(「Ltd.」 「Inc.」 「Co.」 「Pte.」 「www.x.com.」은 빼요)
const BROKEN_LOCAL_RE = /^[a-z][A-Za-z0-9_%+-]*[._-]$/;

/**
 * 가운뎃점 구분자(· ・ •)로 메일과 이어진 앞 조각이 메일 앞부분일 수 있는 한 덩어리인지(UG-451 최종 리뷰 R1) — 대소문자 · 가운데 점과 상관없이
 * (「John · Smith@…」 「Daeun · Jung@…」 「daeun.kim · jung@…」). 가운뎃점은 주소 속 「.」를 잘못 읽은 것일 수 있어요.
 * 글자가 하나는 있어야 하고(전화번호 「010-1234-5678 · kim@」 은 아님), 메일 라벨 · 누리집 · 도메인 모양(「www.x.com · kim@」 「x.com · kim@」)은 빼요.
 * 받아들인 것: 「Sales · kim@…」도 의심이라 칩을 눌러 넣어야 해요. / · | · , 구분자는 전처럼 소문자 덩어리만(isLoneChunk — 「HR / hr@」 「Sales | kim@」 채움)
 */
const MIDDOT_SEPARATOR_RE = /^[·・•]$/;
const DOMAIN_LIKE_RE = /^(?:www\.|https?:)|\.(?:com|net|org|co|kr|sg|jp|cn|io|ai|biz|info|edu|gov)$/i;
const isDottedChunk = (seg: string) =>
  /^[A-Za-z0-9][A-Za-z0-9._%+-]*$/.test(seg) && /[A-Za-z]/.test(seg) && !EMAIL_LABEL_TOKEN_RE.test(seg) && !DOMAIN_LIKE_RE.test(seg);

/**
 * 앞 줄이 . 로 끝난 한 낱말(대소문자 상관없이, 「John.」 ↵ 「Smith@…」 — 최종 리뷰 R1)도 줄바꿈으로 잘린 메일 앞부분일 수 있어요.
 * 회사 · 호칭 약어(「Ltd.」 「Inc.」 「Co.」 「Pte.」 「Mr.」 …)는 빼요. 가운데 점이 있는 낱말(「www.x.com.」)도 빼요.
 * 받아들인 것: 「Director.」 ↵ 「kim@…」 같은 줄도 의심이라 칩을 눌러 넣어요.
 */
// 두 글자 이상(「E.」 「M.」 「T.」 같은 한 글자 라벨 · 이니셜은 빼요), 메일 라벨(「Mail.」 「Email.」)도 빼요
const WORD_DOT_RE = /^[A-Za-z][A-Za-z0-9_%+-]+\.$/;
const ABBR_DOT_RE = /^(?:ltd|inc|co|corp|pte|llc|plc|gmbh|bhd|sdn|jr|sr|dr|mr|ms|mrs|st|ave|rd|bldg|fl|dept|no|tel|fax|ext)\.$/i;
const isBrokenAbove = (line: string) =>
  BROKEN_LOCAL_RE.test(line) || (WORD_DOT_RE.test(line) && !ABBR_DOT_RE.test(line) && !EMAIL_LABEL_TOKEN_RE.test(line.slice(0, -1)));

// 덩어리 앞에 붙은 메일 라벨(「E.」 「E 」 「E.daeun」 「Email:」 「이메일 」) — 덩어리와 공백 · 기호로 떨어져 있을 때만(「eunji」의 e 는 라벨이 아니에요)
const EMAIL_LABEL_HEAD = String.raw`(?:e[-.]?mail|e|mail|이메일|메일)(?:\s*[.:)>▶►→：．）]\s*|\s+)`;
const LEADING_EMAIL_LABEL_RE = new RegExp(`^${EMAIL_LABEL_HEAD}`, "i");
// 조각 · 줄 끝의 「메일 라벨 + 공백 없는 한 덩어리」(「E. daeun」 「M. 010-… E. daeun」) — 1 = 라벨, 2 = 덩어리
const LABELED_CHUNK_END_RE = new RegExp(String.raw`(?:^|\s)(${EMAIL_LABEL_HEAD})(\S+)$`, "i");

/** 메일 앞 덩어리 — text = 칩에 보일 읽은 그대로(라벨 포함), value = 칩 값에 넣을 덩어리(라벨 뺌) */
type Lead = { text: string; value: string };

/**
 * 앞 조각 · 앞 줄이 메일 앞부분이 떨어져 읽힌 덩어리인지(UG-451 기획 17022 반박 리뷰 F1) — 앞에 메일 라벨이 붙어도 봐요
 * (「E. daeun · jung@…」 「이메일 daeun / jung@…」 「M. 010-… E. daeun · jung@…」 「E. daeun.」 ↵ 「jung@…」). test = 덩어리 판별(isLoneChunk · BROKEN_LOCAL_RE)
 */
function leadChunk(prev: string, test: (chunk: string) => boolean): Lead | null {
  // 앞에 붙은 여는 괄호 · 따옴표는 떼고 봐요(「(daeun · jung@…)」, 반박 리뷰) — 칩 글자에는 남고 값에서는 빠져요
  const bare = prev.replace(OPENERS_START_RE, "");
  // 메일 라벨 + 덩어리를 먼저 봐요 — 가운데 점을 받는 판별(isDottedChunk)이 「E.daeun」을 통째 덩어리로 잡지 않게
  const m = bare.match(LABELED_CHUNK_END_RE);
  const chunk = m ? m[2].replace(OPENERS_START_RE, "") : "";
  if (m && test(chunk)) return { text: m[1] + m[2], value: chunk };
  return test(bare) ? { text: prev, value: bare } : null;
}

/** 조각 앞의 여는 괄호 · 따옴표 · 메일 라벨을 뗀 알맹이(「(jung@…」 「E. jung@…」 「(E. jung@…」 → 「jung@…」) */
const stripEmailOpeners = (seg: string) =>
  seg.replace(OPENERS_START_RE, "").replace(LEADING_EMAIL_LABEL_RE, "").replace(OPENERS_START_RE, "");

/**
 * 칩으로 보여 줄 조각. suspect = 앞 조각 · 앞 줄과 이어 보면 잘렸을 수 있는 메일 조각(UG-451).
 * value = 칩으로 나누며 떨어진 앞 덩어리 · 꼬리까지 이어 붙인 「읽은 그대로」의 칩 값(UG-451 기획 17022) — 앞 메일 라벨(「E.」)은 빼요
 */
type Segment = { text: string; suspect: boolean; value?: string; line: number };

/** 읽은 한 줄 정리 — 앞 MAX_LINE 글자만, 전각 ＠ · @ 양옆 공백 · 겹친 공백을 골라요 */
const normalizeLine = (raw: string) => raw.slice(0, MAX_LINE).replace(/＠/g, "@").replace(/\s*@\s*/g, "@").replace(/\s+/g, " ").trim();
/** 읽은 글자 → 정리한 줄들(빈 줄은 빼요). 조각의 line 은 이 목록의 차례예요 */
const cardLines = (text: string) => text.split(/\r?\n/).map(normalizeLine).filter(Boolean);

// 구분자를 남기며 나누기(앞 덩어리를 읽은 그대로 이어 붙일 때 씀)
const SEPARATOR_SPLIT_RE = new RegExp(`(${SEPARATOR_RE.source})`);
/** 칩 글자에 넣을 구분자 — 붙어 읽힌 「|」도 띄어 써요(이어 붙인 글자가 늘 공백을 품어 메일 형식 검사에 걸리게) */
const spacedSeparator = (sep: string) => ` ${sep.trim()} `;

/**
 * 메일 주소 뒤에 「떨어진 꼬리」가 붙은 조각이면 꼬리까지 이은 읽은 그대로, 아니면 null(UG-451 기획 17022).
 * 조각이 주소(+ 맺음 기호)로 끝날 때만 이어요 — 조각에 이미 뒤 글자가 들어 있으면 그대로 읽은 것이에요.
 */
function withEmailTail(seg: string, tails: ReadonlyMap<string, string>): { text: string; value: string } | null {
  const m = seg.match(EMAIL_RE);
  if (!m || m.index === undefined) return null;
  const tail = tails.get(m[0]);
  if (tail === undefined) return null;
  const end = m.index + m[0].length;
  const rest = seg.slice(end);
  if (rest !== "" && !GLUED_OK_RE.test(rest)) return null;
  const text = seg.slice(0, end) + tail;
  // 값은 주소에 붙은 앞 덩어리부터(classifyLine 과 같게) — 「E. tan@x.com SG」의 라벨은 빼요
  const head = emailSuspicion(seg)?.head ?? "";
  return { text, value: text.slice(m.index - head.length) };
}

/**
 * 읽은 글자 → 칩으로 보여 줄 조각. 줄마다 구분자(/ · | …)와 줄 가운데 항목 라벨(T. · M. · E. · Fax …) 앞에서 나누고 정리해요.
 * 잡음 조각 · 깨진 줄(isGarbled)과 같은 조각은 빼요. 줄은 앞 MAX_LINE 글자만 봐요.
 * 잘렸을 수 있는 메일 조각(suspect, UG-451):
 * - 구분자로 나뉜 앞 조각이 공백 없는 로마자 · 숫자 한 덩어리이고 이 조각이 메일로 시작(「daeun · jung@…」 → 「daeun」 「jung@…」)
 * - 바로 앞 줄이 공백 없는 한 덩어리이고 . _ - 로 끝나며 이 줄 첫 조각이 메일로 시작(「daeun.」 ↵ 「jung@…」)
 * - 줄의 메일 주소 뒤(같은 줄 · 다음 줄)에 떨어져 읽힌 나라 도메인 꼬리(emailFragmentTails — 「tan@x.com · sg」 「tan@x.com」 ↵ 「sg」)
 * 이런 조각의 칩 글자 · 값은 떨어진 앞 덩어리 · 꼬리까지 읽은 그대로예요(UG-451 기획 17022 — 「daeun · jung@…」 「tan@x.com · sg」,
 * 다음 줄은 띄어 이어 「tan@x.com sg」). 칩을 눌러 넣으면 형식 오류로 보여 직원이 고쳐요 — 잘린 주소(「tan@x.com」)가 조용히 들어가지 않게.
 */
function readSegments(text: string): Segment[] {
  const seen = new Set<string>();
  const out: Segment[] = [];
  const lines = cardLines(text);
  lines.forEach((line, i) => {
    const pieces = line.split(SEPARATOR_SPLIT_RE);
    const parts = pieces.filter((_, k) => k % 2 === 0);
    const seps = pieces.filter((_, k) => k % 2 === 1);
    // 바로 앞 줄이 . _ - 로 끝난 메일 앞부분 덩어리(라벨이 붙어도, 「E. daeun.」)
    const brokenAbove = i > 0 ? leadChunk(lines[i - 1], isBrokenAbove) : null;
    // 칩으로 나누기 전 줄에서 본 떨어진 나라 도메인 꼬리 — 이 줄의 메일 조각은 모두 의심(UG-451 기획 17005 반박 리뷰)
    const tails = emailFragmentTails(line, lines[i + 1] ?? "");
    const fragment = tails.size > 0;
    parts.forEach((part, p) => {
      const head = cleanSegment(part);
      // 이 조각 앞에 떨어져 읽힌 메일 앞 덩어리(읽은 그대로 이어 붙일 글자 · 칩 값에 넣을 글자) — 없으면 null.
      // 이 조각이 메일 라벨로 시작해도(「daeun.」 ↵ 「E. jung@…」) 봐요(반박 리뷰 F1)
      let lead: Lead | null = null;
      if (startsWithEmail(head) || startsWithEmail(stripEmailOpeners(head))) {
        if (p === 0) lead = brokenAbove ? { text: `${brokenAbove.text} `, value: `${brokenAbove.value} ` } : null;
        else {
          // 가운뎃점으로 이어졌으면 대문자 · 가운데 점 덩어리도(R1), 그 밖의 구분자는 소문자 덩어리만
          const middot = MIDDOT_SEPARATOR_RE.test(seps[p - 1].trim());
          const found = leadChunk(cleanSegment(parts[p - 1]), middot ? isDottedChunk : isLoneChunk);
          const sep = spacedSeparator(seps[p - 1]);
          lead = found ? { text: found.text + sep, value: found.value + sep } : null;
        }
      }
      part
        .split(LABEL_SPLIT_RE)
        .map(cleanSegment)
        .forEach((seg, k) => {
          if (!isMeaningful(seg) || isGarbled(seg) || isJunkChip(seg) || seen.has(seg)) return;
          seen.add(seg);
          const headCut = lead !== null && k === 0;
          const suspect = headCut || (fragment && EMAIL_RE.test(seg));
          const tailed = fragment ? withEmailTail(seg, tails) : null;
          if (!headCut && tailed === null) return void out.push({ text: seg, suspect, line: i });
          if (headCut && lead) {
            // 앞 덩어리 + 이 조각(값에서는 조각 앞 메일 라벨을 빼요)
            const rest = tailed?.text ?? seg;
            out.push({ text: lead.text + rest, suspect: true, value: lead.value + rest.replace(LEADING_EMAIL_LABEL_RE, ""), line: i });
          } else out.push({ text: tailed?.text ?? seg, suspect: true, value: tailed?.value ?? seg, line: i });
        });
    });
  });
  return out;
}

/** 읽은 글자 → 칩으로 보여 줄 줄(조각) 목록(readSegments 의 글자만). */
export function readLines(text: string): string[] {
  return readSegments(text).map((seg) => seg.text);
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
/** 번호 모양만 보고 휴대전화인지(한국 010 · +82 10, 싱가포르 8 · 9 로 시작하는 8자리 · +65 8 · 9) — 라벨이 없거나 Tel 라벨이어도 휴대전화 순위로 올려요 */
const isMobile = (phone: string) => /^(010|8210|82010)/.test(digitsOf(phone)) || /^(?:65)?[89]\d{7}$/.test(digitsOf(phone));

// 번호 바로 앞 라벨(UG-451) — 휴대전화 라벨 · 전화 라벨. 번호 바로 앞(앞 번호가 끝난 뒤 ~ 이 번호 앞)의 끝에서만 봐요.
const MOBILE_LABEL_RE = /(?:^|[^A-Za-z])(?:M|Mobile|MOBILE|Mob|HP|H\.P|Cell|CELL|C|휴대폰|휴대전화|핸드폰)\s*[.:)]?\s*$/;
const TEL_LABEL_RE = /(?:^|[^A-Za-z])(?:T|Tel|TEL|tel|Phone|PHONE|P|Office|Direct|DID|전화|직통|대표)\s*[.:)]?\s*$/;
// 전화번호가 아닌 번호 라벨 — 번호 앞 구간 어디에 있든 그 번호는 전화번호로 보지 않아요(싱가포르 UEN · 사업자 등록번호 · 회사 등록번호)
const NOT_PHONE_LABEL_RE = /\b(?:UEN|Reg|Registration|GST|ABN|CRN|VAT)\b|사업자|법인/i;
// 라벨 없이 숫자만 있는 줄(숫자 · 공백 · - · .)이 전화번호로 쓰일 모양 — 한국 0 으로 시작 9~11자리 · 대표번호 15xx · 16xx · 18xx 8자리,
// 싱가포르 3 · 6 · 8 · 9 로 시작하는 8자리, 나라 번호로 시작(82 + 9~10자리 · 65 + 8자리).
// 이 모양이 아니면 QR 무늬 등 잡음(「11800 8083」 — 9자리 · 1 로 시작)으로 봐요.
const BARE_DIGITS_RE = /^[\d\s.-]+$/;
const BARE_PHONE_RE = /^(?:0\d{8,10}|1[568]\d{6}|[3689]\d{7}|82\d{9,10}|65\d{8})$/;

/**
 * 번호가 전화번호 모양인지(UG-451 기획 16991 — 거꾸로 찍힌 명함에서 「4299400503160」이 T 라벨 뒤에 읽혀 채워진 일). 라벨이 있어도 봐요.
 * - + 로 시작(나라 번호): 숫자 8~15자리
 * - 그 밖에 숫자 13자리 이상: 아님
 * - 숫자만 이어 쓴 번호: 라벨 없는 숫자만 줄과 같은 모양(BARE_PHONE_RE — 한국 0 시작 9~11자리 · 대표번호 · 싱가포르 8자리 · 82 · 65 나라 번호)
 * - 나눠 쓴 번호(공백 · - · . · 괄호): 묶음이 둘 이상이고 묶음마다 4자리 이하(「02-123-4567」 「(02) 123 4567」 「415-555-0132」)
 */
function looksLikePhone(value: string): boolean {
  const digits = digitsOf(value);
  if (value.trim().startsWith("+")) return digits.length >= 8 && digits.length <= 15;
  if (digits.length >= 13) return false;
  if (BARE_PHONE_RE.test(digits)) return true;
  const groups = value.split(/[\s().-]+/).filter(Boolean);
  return groups.length >= 2 && groups.every((g) => /^\d{1,4}$/.test(g));
}

/**
 * 처음 채우기 순위(작을수록 먼저) — 0 휴대전화(라벨 Mobile · M · HP · 휴대폰 · 휴대전화 · Cell · C, 또는 번호가 휴대전화 모양),
 * 1 전화 라벨(Tel · T · 전화 · Phone · P …), 2 라벨 없음, null = 처음 채우기에 쓰지 않음(팩스 · 전화번호 모양이 아님(looksLikePhone) ·
 * 라벨 없는 숫자만 줄이 전화번호 모양이 아님).
 * 팩스 번호는 전화 칩으로 보여요(직원이 눌러 넣을 수 있어요). 라벨 없는 숫자만 줄이 전화번호 모양이 아니면 칩도 만들지 않아요(isJunkChip).
 */
type PhoneRank = 0 | 1 | 2 | null;

type PhoneHit = { value: string; fax: boolean; rank: PhoneRank };

/** 줄의 전화번호들. 날짜 · 사업자 등록번호 · UEN 등 등록번호(라벨 · 끝에 붙은 글자)는 빼고, 번호 바로 앞 구간에 팩스 라벨이 있으면 fax. */
function phoneHits(line: string): PhoneHit[] {
  const valid = (p: string) => {
    const n = digitsOf(p).length;
    return n >= 8 && n <= 15 && !BIZ_NO_RE.test(p);
  };
  const bare = BARE_DIGITS_RE.test(line);
  const hits: PhoneHit[] = [];
  let prevEnd = 0;
  for (const m of line.matchAll(PHONE_RUN_RE)) {
    const before = line.slice(prevEnd, m.index);
    const end = m.index + m[0].length;
    prevEnd = end;
    if (DATE_RE.test(m[0].trim())) continue;
    if (NOT_PHONE_LABEL_RE.test(before)) continue;
    // 숫자만 붙은 묶음 바로 뒤에 글자가 붙으면 등록번호(「201812345K」)예요
    if (/^\d+$/.test(m[0]) && /^[A-Za-z]/.test(line.slice(end))) continue;
    const fax = FAX_BEFORE_RE.test(before);
    const label: PhoneRank = MOBILE_LABEL_RE.test(before) ? 0 : TEL_LABEL_RE.test(before) ? 1 : 2;
    const whole = normalizePhone(m[0]);
    // 「02-123-4567 010-1234-5678」처럼 공백으로만 이어진 두 번호는 한 묶음으로 읽혀요 — 너무 길면 공백에서 나눠 봐요
    for (const value of valid(whole) ? [whole] : whole.split(" ").filter(valid)) {
      let rank: PhoneRank = isMobile(value) ? 0 : label;
      // 팩스 · 전화번호 모양이 아닌 번호(라벨이 있어도) · 라벨 없는 숫자만 줄의 모양 밖 번호는 채우지 않아요
      if (fax || !looksLikePhone(value) || (bare && !BARE_PHONE_RE.test(digitsOf(value)))) rank = null;
      hits.push({ value, fax, rank });
    }
  }
  return hits;
}

/** 고를 번호: 순위(휴대전화 → 전화 라벨 → 라벨 없음)가 가장 앞선 번호, 같으면 먼저 나온 번호. 쓸 번호가 없으면 첫 번호(칩 값) */
function bestPhone(hits: PhoneHit[]): PhoneHit | undefined {
  let best: PhoneHit | undefined;
  for (const h of hits) if (h.rank !== null && (best === undefined || h.rank < (best.rank as number))) best = h;
  return best ?? hits[0];
}

/** 칩의 처음 채우기 순위(phoneHits 의 rank) — 전화 칩이 아니면 null */
function phoneRank(chip: Chip): PhoneRank {
  if (chip.kind !== "phone") return null;
  return bestPhone(phoneHits(chip.text))?.rank ?? null;
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

// 메일 주소 앞에 붙어 읽혀도 잘린 주소로 보지 않는 라벨(「E john@…」 「Email. john@…」)
const EMAIL_LABEL_TOKEN_RE = /^(?:E|E-?mail|Mail)$/i;
// 잘못 읽은 끝 도메인(UG-451) — 실재하지 않는 최상위 도메인 중 com · net · org · kr 을 잘못 읽은 흔한 모양만(.cor · .con …).
// .cm · .om 은 실재하지만(카메룬 · 오만) 명함에서는 .com 의 글자를 놓친 것일 가능성이 훨씬 커 오독으로 봐요(기획 17005 반박 리뷰)
const TLD_TYPOS = new Set("cor con corn cpm comm coom ner nel orq ogr krr cm om".split(" "));

/**
 * 끝 도메인 바로 뒤에 띄어쓰기 없이 붙어도 주소를 그대로 믿는 덩어리(UG-451 기획 17005) — 맺음 기호만으로 된 덩어리예요.
 * . , ; : (문장 · 나열 끝) · | (구분자 — 칩을 나눌 때 이미 떨어져요) · 닫는 괄호 · 따옴표(「(kim@x.com)」 「<kim@x.com>」 「"kim@x.com"」),
 * 전각 맺음 기호(） 。 、 ， ； ：)뿐이면 괜찮아요.
 * 그 밖에 글자 · 숫자 · 기호(- & _ / + # % @ ! ? ( 등)가 하나라도 섞이면 주소가 더 이어지다 잘못 읽혔을 수 있어 처음 채우기에서 빼요
 * (「…com-s&」 「…com&」 「…com58」 「…com(대표)」 → 정규식이 「…com」까지만 주소로 잡아요). 잘린 주소를 조용히 채우는 쪽이 비워 두는 쪽보다 나빠서
 * 띄어쓰기 없이 이어 쓴 다음 주소 · 누리집(「kim@x.com,www.x.com」 「kim@x.com/www.x.com」)도 비워요 — 칩은 남아 눌러 넣을 수 있어요.
 * 띄어 쓴 경우(「kim@x.com, www.x.com」)는 채워요. 붙은 항목 라벨(「…comTel」 「…com전화」)은 GLUED_LABEL_RE 를 봐요.
 * 줄 끝의 | _ = ~ : ; , ' " 등은 칩 정리(cleanSegment)에서 이미 떨어져요. 문장 끝 점 하나(「…com.」)는 채워요(설계 결정).
 */
const GLUED_OK_RE = /^[.,;:|)\]}>"'’”」』〉》）。、，；：］】]+$/;
/**
 * 끝 도메인 바로 뒤(띄어쓰기 없이)에 붙어도 떼고 채우는 항목 라벨(UG-451 기획 17005). 라벨 뒤는 더 보지 않아요(「…comTel:02-…」 「…comWeb:www…」).
 * - 영어 두 글자 이상: 소문자 끝 도메인에 대문자로 붙어요(「…comTel」 — 정규식이 끝 도메인 한 덩어리로 잡고 extractEmail 이 떼요)
 * - 한글: 끝 도메인 뒤에 붙어요(「…com전화02-…」 「…co.kr홈페이지」)
 * 영어 한 글자(T · M · F · P · H · C)는 바로 뒤가 전화번호일 때만(GLUED_PHONE_LETTER_RE) — 「…coM」 「…neT」는 끝 글자가 대문자로 읽힌
 * 잘린 주소(.com · .net)일 수 있어요. E 한 글자도 같은 까닭으로 받지 않아요. 라벨이 아닌 대문자 덩어리(「…comSG」)는 나라 도메인 앞 점을 놓친 것일 수 있어 의심.
 * 대문자를 떼고 남는 끝 도메인이 co · ne · or(CUT_TLD_RE)이면 라벨이어도 받지 않아요 — 「…coM 010-…」 「…neT 02-…」 「…coTel」은 의심(반박 리뷰).
 */
const GLUED_LABEL_RE = new RegExp(
  "^(?:(?:Telephone|Tel|TEL|Phone|PHONE|Mobile|MOBILE|Mob|Cell|CELL|HP|Fax|FAX|Direct|DID|E-mail|E-Mail|Email|EMAIL|Mail|MAIL|" +
    "Website|Web|WEB|Homepage|Www|WWW|Office|Address|ADDRESS|Addr|Add)(?![a-z])|" +
    "전화번호|전화|휴대폰|휴대전화|핸드폰|팩스|직통|대표전화|대표번호|이메일|메일|홈페이지|누리집|웹|주소|사무실)",
);
const GLUED_PHONE_LETTER_RE = /^[TMFPHC][.:)]?\s?[+(\d]/;
/**
 * 점을 놓쳐 끝 도메인에 나라 도메인이 붙은 모양(「…comsg」 「…cokr」 「…netmy」) — 실재하지 않는 최상위 도메인이라 오독으로 봐요(UG-451 기획 17005).
 * 소문자로 붙으면 정규식이 한 덩어리 끝 도메인으로 잡아 위 규칙으로는 못 보고, 명함에 흔한 나라만 골랐어요.
 */
const GLUED_CC_TLD_RE = /^(?:com|net|org|co|ac|or|go|edu|gov)(?:sg|kr|my|hk|jp|cn|tw|uk|au|id|ph|th|vn|nz)$/i;
// 띄어쓰기를 놓쳐 끝 도메인에 소문자 항목 라벨이 붙은 모양(「…comtel 02-…」 「…comfax」) — 떼어 채우지 않고 오독으로 봐요
const GLUED_LOWER_LABEL_TLD_RE = /^(?:com|net|org|co|kr|sg)(?:tel|fax|mobile|mob|email|mail|web|www|hp|tl)$/;

// 주소 앞에 띄어쓰기 없이 붙어도 되는 여는 괄호 · 따옴표(「(kim@…」 「「kim@…」) — 그 앞은 다시 줄 처음 · 공백 · 메일 라벨이어야 해요
const OPENERS_END_RE = /[(<[{"'“‘「『（［【〈《]+$/u;
// 같은 여는 괄호 · 따옴표가 조각 · 덩어리 앞에 붙은 것(「(daeun」 「(jung@…」)
const OPENERS_START_RE = /^[(<[{"'“‘「『（［【〈《]+/u;
// 주소 바로 앞의 메일 라벨 끝(「E:」 「e.」 「E)」 「E>」 「Email▶」 「E-MAIL:」 「e.mail:」 「Mail to:」 「이메일：」 「메일」 …, 쌍점 없이도) —
// 대소문자 · 전각 기호(： ． ）)도 받아요. 그 밖의 기호(✉ © /)가 붙으면 라벨로 보지 않아요(반박 리뷰)
const EMAIL_LABEL_END_RE = /(?:^|[\s(<[])(?:e[-.]?mail|e|mail(?:\s*to)?|이메일|메일)\s*[.:)>▶►→：．）]?$/i;
// 끝 글자를 대문자로 읽으면 정규식이 그 글자를 떼고 남는 끝 도메인(co · ne · or ← com · net · org) — 여기에 대문자가 붙으면 라벨로 보지 않아요
const CUT_TLD_RE = /^(?:co|ne|or)$/i;

/**
 * 떨어져 읽힌 나라 도메인 꼬리로 보는 나라(반박 리뷰) — 명함에 흔한 아시아 · 영연방 나라만.
 * 부서 · 직함 · 낱말과 겹치는 나라 도메인은 뺐어요: it(IT) · ai(AI) · pr(PR) · hr(HR) · in · me · tv · co · us · de · do · go · la · mo · to · so · is · am · be · no · ca · io.
 * 그래서 메일 뒤의 「(HQ)」 「/ IT」 「| PR」 「· VP」 「Jr.」, 다음 줄의 「HR」 「KT」 「AI」 「UX UI」 같은 짧은 낱말은 채움을 막지 않아요.
 */
const CC_FRAGMENT = "sg|kr|my|hk|jp|cn|tw|au|nz|uk|ph|th|vn|id|kh|mm|bd|pk|lk|np|ae";
// 꼬리를 이어 붙인 모양: (잘린 끝 도메인 조각 m · t · g · com · co …) + 나라(「sg」 「m.sg」 「S G」 「co kr」)
const CC_FRAGMENT_RE = new RegExp(`^(?:m|t|g|com|net|org|co|ne|or|ac|go|edu|gov)?(?:${CC_FRAGMENT})$`);

/**
 * 주소 뒤에 남은 것이 떨어져 읽힌 나라 도메인 꼬리뿐인지(UG-451 기획 17005 반박 리뷰) — 공백 · 구분자 · 줄바꿈으로 떨어져 읽힌 꼬리
 * (「… · sg」 「… / sg」 「…|sg」 「… sg.」 「… SG)」 「… S G」 「…co m.sg」 「…co kr」). 칩을 나누면 꼬리가 떨어져 나가
 * 칩만 봐서는 몰라요 — 읽은 줄 그대로에서도 봐요(readSegments). 토막(로마자 1~3글자, 3개까지)을 이어 붙여 CC_FRAGMENT_RE 모양이면 true.
 * loose = 같은 줄 — 로마자 한 글자만 남은 것(「…com s」, 나라 도메인이 덜 읽힘)도 true. 다음 줄은 한 글자(「M」 「T」 「i」 — 라벨 · 잡음)로는 비우지 않아요.
 * 「… T. 02-…」(라벨 + 번호) · 「…, www.x.com」 · 「(HQ)」 처럼 다른 것이면 false.
 */
function ccFragmentOnly(rest: string, loose = false): boolean {
  const tokens = rest
    .split(/[\s·・•/|,;:.]+/)
    .map((t) => t.replace(/^[(<[{"'“‘「『（［【〈《]+|[)\]}>"'’”」』）。、，；：］】]+$/gu, ""))
    .filter(Boolean);
  return (
    tokens.length > 0 &&
    tokens.length <= 3 &&
    tokens.every((t) => /^[A-Za-z]{1,3}$/.test(t)) &&
    (CC_FRAGMENT_RE.test(tokens.join("").toLowerCase()) || (loose && tokens.join("").length === 1))
  );
}

/**
 * 메일 주소 앞뒤에서 본 「잘렸을 수 있는」 조각. head · tail = 읽은 그대로의 앞 덩어리 · 뒤 조각(없으면 ""), typo = 끝 도메인 오독,
 * glue = 끝 도메인에 라벨이 아닌 대문자 덩어리가 붙음(「…comSG」 — match 에 들어 있어요)
 */
type EmailSuspicion = { match: string; head: string; tail: string; typo: boolean; glue: boolean; dots: boolean };

/**
 * 줄의 메일 주소가 잘렸을 수 있는지 살펴요(UG-451). 글자 읽기가 주소 속 「.」 를 공백 · 쉼표로 읽으면 메일 모양 꼬리만 뽑혀요
 * (「daeun jung@…」 → jung@… · 「…@bluepeak.com. sg」 → …@bluepeak.com).
 * - head: 주소 바로 앞에 공백 · 쉼표 · 점 · 가운뎃점(· ・ •)으로만 떨어진 로마자 · 숫자 덩어리(「daeun jung@」 「daeun,jung@」 「daeun·jung@」).
 *   메일 라벨(E · Email · Mail)과 전화번호 끝자리(「010-1234-5678 kim@…」)는 빼요.
 *   또 주소 바로 앞 글자가 줄 처음 · 공백 · 여는 괄호 · 따옴표 · 메일 라벨 끝(「E:」 「Email:」 「이메일」)이 아니면 붙은 덩어리 전체(기획 17005 반박 리뷰 —
 *   「hong:gildong@」 「hong—gildong@」 「hong(gildong@」 「hong홍gildong@」 → gildong@… 는 다른 사람의 실제 주소일 수 있어요).
 * - tail: 끝 도메인 바로 뒤에 점 · 쉼표 · 가운뎃점(앞뒤 공백 허용) + 1~4글자 로마자 · 숫자 덩어리(「. kr」 「.58」 「· sg」),
 *   또는 뒤에 남은 것이 1~2글자 로마자 토막뿐(ccFragmentOnly — 「…co kr」 「…com SG)」 「… S G」).
 *   덩어리 뒤에 . · @ 가 이어지면 다음 주소 · 누리집이라 괜찮아요(「kim@x.com, www.x.com」 「kim@x.com, lee@x.com」). 문장 끝 점(「…com.」)도 괜찮아요.
 *   또 끝 도메인 바로 뒤(띄어쓰기 없이)에 붙은 덩어리가 항목 라벨(GLUED_LABEL_RE)로 시작하지 않고 맺음 기호(GLUED_OK_RE)만도 아니면 그 덩어리 전체
 *   (기획 17005 — 「…@bluepeak.com.sg」를 「…@bluepeak.com-s&」로 읽어 「…@bluepeak.com」이 채워진 일).
 *   라벨로 시작하면 라벨 뒤는 보지 않아요 — 끝 도메인 꼬리가 아니에요.
 * - typo: 끝 도메인이 흔한 오독 모양(TLD_TYPOS — .cor · .con · .cm 등) · 점을 놓쳐 나라 도메인이 붙은 모양(GLUED_CC_TLD_RE — 「…comsg」) ·
 *   소문자 라벨이 붙은 모양(GLUED_LOWER_LABEL_TLD_RE — 「…comtel」) · 실재하지 않는 끝 도메인(tlds.ts 에 없음 — 「…company-a.qi」 ← .ai, 기획 17132)
 * - glue: 소문자 끝 도메인에 붙은 대문자 덩어리(「…comSG」 「…coM」)가 라벨이 아니거나, 한 글자 라벨인데 뒤가 전화번호가 아님
 */
function emailSuspicion(text: string): EmailSuspicion | null {
  const line = text.slice(0, MAX_LINE);
  const m = line.match(EMAIL_RE);
  if (!m || m.index === undefined) return null;
  const before = line.slice(0, m.index);
  const after = line.slice(m.index + m[0].length);
  let head = "";
  const hm = before.match(/(?:^|[^A-Za-z0-9_%+-])([A-Za-z0-9_%+-]+)([ ,.·・•]+)$/);
  if (hm && !EMAIL_LABEL_TOKEN_RE.test(hm[1])) {
    // 전화번호 끝자리 뒤에 띄어 쓴 주소는 잘린 게 아니에요
    const rest = before.slice(0, before.length - hm[2].length);
    const runs = [...rest.matchAll(PHONE_RUN_RE)];
    const last = runs[runs.length - 1];
    const phoneTail =
      /^[\d+-]+$/.test(hm[1]) && last !== undefined && last.index + last[0].length === rest.length && digitsOf(last[0]).length >= 8;
    if (!phoneTail) head = hm[1] + hm[2];
  }
  if (!head) {
    const bare = before.replace(OPENERS_END_RE, "");
    if (bare !== "" && !/\s$/.test(bare) && !EMAIL_LABEL_END_RE.test(bare)) head = before.match(/\S+$/)?.[0] ?? "";
  }

  // 소문자 끝 도메인에 붙은 대문자 덩어리(「…comTel」의 Tel) — 주소가 아니라 뒤에 붙은 것으로 봐요
  const capsMatch = m[0].slice(m[0].lastIndexOf(".") + 1).match(/^([a-z]{2,})([A-Z][A-Za-z]*)$/);
  const caps = capsMatch?.[2] ?? "";
  const glued = caps + after;
  // 「…coM」 「…neT 02-…」 「…coTel」: 남는 끝 도메인이 co · ne · or 이면 끝 글자를 대문자로 읽은 .com · .net · .org 일 수 있어 라벨로 보지 않아요(반박 리뷰)
  const cutTld = caps !== "" && CUT_TLD_RE.test(capsMatch?.[1] ?? "");
  const label = !cutTld && glued !== "" && (GLUED_LABEL_RE.test(glued) || GLUED_PHONE_LETTER_RE.test(glued));
  let tail = "";
  let glue = false;
  if (caps && !label) {
    glue = true;
    tail = after.match(/^\S+/)?.[0] ?? "";
  } else if (!label) {
    const chunk = after.match(/^\S+/)?.[0] ?? "";
    tail =
      after.match(/^\s*[.,·・•]\s*[A-Za-z0-9]{1,4}(?![A-Za-z0-9.@])/)?.[0] ??
      (ccFragmentOnly(after, true) || cutTldLetterAfter(m[0], after) ? after : chunk && !GLUED_OK_RE.test(chunk) ? chunk : "");
  }
  const tld = extractEmail(line).split(".").pop() ?? "";
  // 실재하지 않는 끝 도메인(IANA 목록에 없음 — 「user1@company-a.qi」 ← .ai, 기획 17132)도 오독이에요. 실재하는 .cm · .om 은 TLD_TYPOS 가 따로 봐요
  const typo = TLD_TYPOS.has(tld.toLowerCase()) || GLUED_CC_TLD_RE.test(tld) || GLUED_LOWER_LABEL_TLD_RE.test(tld) || !isKnownTld(tld);
  // @ 앞이 점으로 시작 · 끝나거나 점이 겹침(「.jung@」 「kim.@」 「kim..lee@」) — 앞 덩어리가 떨어졌거나 글자를 놓친 것이에요(반박 리뷰)
  const local = extractEmail(line).split("@")[0] ?? "";
  const dots = local.startsWith(".") || local.endsWith(".") || local.includes("..");
  return { match: m[0], head, tail, typo, glue, dots };
}

/**
 * 끝 도메인이 co · ne · or 로 끝나고 뒤에(공백 · 구분자 다음) 로마자 1~2글자 토막이 따로 읽혔는지
 * (「…co m」 「…co rn」 「…co om」 「…ne tt」 「…co M 010-…」 「…ne T 02-…」) — .com · .net · .org 의 끝 글자가 떨어져 · 잘못 읽힌 것일 수 있어요
 * (반박 리뷰 · 최종 확인 — rn 은 m 을 잘못 읽은 흔한 모양). 여는 괄호 뒤(「…co (rn)」)도 같아요. 토막 뒤에 로마자가 더 이어지면(「…co Tel 02-…」) 보지 않아요.
 * 다음 줄이 이런 토막 하나뿐인 것(「…co」 ↵ 「rn」)은 emailFragmentTails 가 봐요.
 * 「…co.kr」 「…com」 같은 다른 끝 도메인도 보지 않아요(「…co.kr rn」 「…com Dr」는 채워요).
 */
function cutTldLetterAfter(address: string, after: string): boolean {
  return cutTldLetterTail(address, after) !== "";
}

/** cutTldLetterAfter 의 토막까지(앞 공백 · 구분자 포함, 「 M」 「 | rn」) — 아니면 "" */
function cutTldLetterTail(address: string, after: string): string {
  const tld = address.slice(address.lastIndexOf(".") + 1);
  if (!CUT_TLD_RE.test(tld)) return "";
  return after.match(/^[\s·・•/|,;:.([（［]+[A-Za-z]{1,2}(?![A-Za-z])/)?.[0] ?? "";
}

/**
 * 읽은 줄(칩으로 나누기 전)에서 메일 주소 뒤에 떨어져 읽힌 나라 도메인 꼬리(UG-451 기획 17005 반박 리뷰) — 주소(정규식이 잡은 글자) → 꼬리(읽은 그대로).
 * 칩은 구분자(· / | …)로 나뉘고 1~2글자 토막은 잡음으로 빠져 칩만 봐서는 몰라요.
 * - 같은 줄: 주소 뒤에 남은 것이 나라 도메인 꼬리뿐(ccFragmentOnly — 「tan@x.com · sg」 「tan@x.com|sg」 「…com s」) → 남은 것 전부,
 *   또는 co · ne · or 로 끝난 주소 뒤에 1~2글자 토막(cutTldLetterTail — 「…co rn」 「…co | rn」) → 그 토막까지
 * - 다음 줄: 주소가 줄 끝(맺음 기호만 뒤에)이고 다음 줄이 나라 도메인 꼬리 한두 토막뿐(「sg」 「.sg」 「m.sg」 「S G」),
 *   또는 co · ne · or 로 끝난 주소 다음 줄이 1~2글자 토막 하나뿐(「rn」 「m」) → 줄 끝 + 공백 + 다음 줄. 「HR」 「M」 「KT」 같은 짧은 낱말은 그 밖에는 채워요
 * 꼬리의 붙어 읽힌 구분자 「|」는 띄어 써요(spacedSeparator — 칩 글자가 메일 형식 검사에 걸리게, 기획 17022).
 */
function emailFragmentTails(line: string, next: string): Map<string, string> {
  const tails = new Map<string, string>();
  const spaced = (tail: string) => tail.replace(/^\s*\|\s*/, spacedSeparator("|"));
  for (const m of line.matchAll(EMAIL_RE_G)) {
    const after = line.slice(m.index + m[0].length);
    if (ccFragmentOnly(after, true)) {
      tails.set(m[0], spaced(after));
      continue;
    }
    const cut = cutTldLetterTail(m[0], after);
    if (cut) {
      tails.set(m[0], spaced(cut));
      continue;
    }
    const rest = after.trim();
    if ((rest === "" || GLUED_OK_RE.test(rest)) && next !== "") {
      const joined = `${after.trimEnd()} ${next}`;
      if (ccFragmentOnly(next) && next.split(/\s+/).length <= 2) tails.set(m[0], joined);
      // co · ne · or 로 끝난 주소 다음 줄이 로마자 1~2글자 토막 하나뿐(「rn」 「m」 「om」) — .com · .net · .org 의 끝이 떨어졌을 수 있어요
      else if (cutTldLetterAfter(m[0], ` ${next}`) && /^[.(（]?[A-Za-z]{1,2}[.)）]?$/.test(next)) tails.set(m[0], joined);
    }
  }
  return tails;
}

/** 줄의 메일 주소가 잘렸거나 잘못 읽혔을 수 있는지(UG-451) — 그런 주소는 처음 채우기에서 빼요(autoFill). */
export function isSuspectEmail(line: string): boolean {
  const s = emailSuspicion(line);
  return s !== null && (s.head !== "" || s.tail !== "" || s.typo || s.glue || s.dots);
}

/** 한 줄의 종류와 칸에 넣을 값. 메일이 함께 있는 줄은 메일로 봐요(메일 칸이 더 중요해요 — 라벨로 나눈 뒤라 드물어요). */
export function classifyLine(line: string): { kind: ChipKind; value: string; fax?: boolean } {
  const email = extractEmail(line);
  if (email) {
    // 잘렸을 수 있는 주소는 앞 덩어리부터 뒤 조각까지 읽은 그대로(「daeun jung@miraero-logis.co.kr」)를 값으로 —
    // 칩을 눌러 넣으면 형식 오류로 보여 직원이 고쳐요(잘린 꼬리가 조용히 들어가지 않게)
    const s = emailSuspicion(line);
    if (s && (s.head || s.tail || s.glue || s.dots)) return { kind: "email", value: (s.head + s.match + s.tail).trim() };
    return { kind: "email", value: email };
  }
  const phone = bestPhone(phoneHits(line));
  if (phone) return { kind: "phone", value: phone.value, ...(phone.fax ? { fax: true } : {}) };
  return { kind: "other", value: line };
}

/** 칩이 잘렸거나 잘못 읽혔을 수 있는 메일 칩인지(나눌 때 본 suspect · 칩 글자로 본 isSuspectEmail) */
export const isSuspectChip = (chip: Chip) => chip.kind === "email" && (chip.suspect === true || isSuspectEmail(chip.text));

/**
 * 이메일 칸 값이 잘렸을 수 있는 메일 칩의 값과 같거나(UG-451 기획 17022 반박 리뷰 F2) 그 칩에서 뽑은 잘린 주소와 같은지(최종 리뷰 R3).
 * 앞뒤 공백을 떼고 주소 전체를 대소문자 없이 견줘요(기획 17030 — 「Kim@acme.com」처럼 대소문자만 바꿔 경고를 지나가지 않게).
 * 칩을 눌러 넣었든 직접 치거나 붙여 넣었든 같아요. 그런 값은 공백 없이도 형식 검사를 지나는 것이 있어(「kim@x.coM」 「kim@x.cm」 「tan@x.com-s&」)
 * 화면이 경고하고 보내기를 막아요 — 글자가 하나라도 달라지거나(직원이 고침) 직원이 「명함과 같은 주소예요」로 확인하면 풀려요(화면).
 */
export function isSuspectValue(value: string, chips: readonly Chip[]): boolean {
  const v = value.trim().toLowerCase();
  if (v === "") return false;
  return chips.some((c) => {
    if (!isSuspectChip(c)) return false;
    if (c.value.trim().toLowerCase() === v) return true;
    // 의심 칩에서 뽑은 잘린 주소(「tan@x.com · sg」 → tan@x.com, 「kim@x.coM」 → kim@x.co)를 그대로 쳐도 막아요(최종 리뷰 R3)
    const candidate = extractEmail(c.value) || extractEmail(c.text);
    return candidate !== "" && candidate.toLowerCase() === v;
  });
}

/**
 * 칸 값이 의심 값이고(isSuspectValue) 직원이 「명함과 같은 주소예요」로 확인하지 않았는지(UG-451 기획 17030).
 * confirmed = 직원이 확인한 칸 값(없으면 null) — 앞뒤 공백을 떼고 대소문자 없이 같으면 확인한 것으로 봐요.
 * 화면의 경고 · 보내기 막음과 「작성 중」 저장 판단(draftSaveGate 의 fieldSuspect)이 같이 써요.
 */
export function isUnconfirmedSuspect(value: string, chips: readonly Chip[], confirmed: string | null): boolean {
  if (!isSuspectValue(value, chips)) return false;
  return confirmed === null || confirmed.trim().toLowerCase() !== value.trim().toLowerCase();
}

/**
 * 명함에서 읽은 메일 주소를 칸에 넣을 글자로(UG-451 기획 17030 · 17072-4) — 소문자로 바꾸되 @ 앞의 대문자 I 는 읽은 그대로 둬요.
 * 「Iee77@acme.com」의 I 는 l 을 잘못 읽은 것일 수 있어, i 로 바꾸면 칸에서 「iee77」로 보여 명함 「lee77」과 견줄 때 틀린 글자를
 * 알아보기 어려워요(헷갈리는 글자 안내도 I 를 가리켜요). 단 @ 앞에 소문자가 하나도 없으면(「KIM@ACME.COM」처럼 전부 대문자로 찍힌 명함)
 * 그 I 는 대문자 글씨일 뿐이라 전부 소문자로 바꿔요(「kIm」이 되지 않게). 도메인(@ 뒤)은 전부 소문자예요.
 * 같은 주소인지 견줄 때(isSuspectValue · isUnconfirmedSuspect · 이메일 확인)는 언제나 대소문자 없이 봐요 — 이 I 때문에 달라지지 않아요.
 */
export function scannedEmailValue(email: string): string {
  const at = email.lastIndexOf("@");
  const local = at === -1 ? email : email.slice(0, at);
  const domain = at === -1 ? "" : email.slice(at).toLowerCase();
  if (!/[a-z]/.test(local)) return local.toLowerCase() + domain;
  return local.replace(/[^I]+/g, (run) => run.toLowerCase()) + domain;
}

/** 명함 칩의 메일 주소들(뽑은 주소, 겹치지 않게) — 잘렸을 수 있는 칩도 뽑은 꼬리 주소로(「daeun · jung@x.co.kr」 → jung@x.co.kr) */
export function chipEmailAddresses(chips: readonly Chip[]): string[] {
  const out = new Set<string>();
  for (const c of chips) {
    if (c.kind !== "email") continue;
    const e = extractEmail(c.value) || extractEmail(c.text);
    // 의심이 아닌 칩은 칸에 넣을 때처럼(chipValueFor — 기획 17030 · 17072-4) — 칸 주소와 같은 글자로 확인해요
    if (e) out.add(isSuspectChip(c) ? e : scannedEmailValue(e));
  }
  return [...out];
}

/**
 * 읽은 글자 → 칩과, 칩마다 그 칩이 나온 줄의 글자 인식 점수(UG-451 기획 17100 — ocr 가 없거나 줄을 맞추지 못하면 null).
 * 점수는 칩에 싣지 않아요(「작성 중」 저장 크기 · 형식을 그대로 두려고) — 읽은 직후의 자동 채움 판단에만 써요.
 */
function readCard(text: string, ocr?: readonly OcrLine[] | null): { chips: Chip[]; lines: (OcrLine | null)[] } {
  const segs = readSegments(text).slice(0, MAX_CHIPS);
  const aligned = alignLines(text, ocr);
  const chips = segs.map((seg, i) => {
    const chip: Chip = { id: i + 1, text: seg.text, ...classifyLine(seg.text) };
    if (chip.kind !== "email" || !seg.suspect) return chip;
    // 떨어진 앞 덩어리 · 꼬리까지 이은 칩은 값도 보이는 글자 그대로(UG-451 기획 17022 — 잘린 주소가 들어가지 않게)
    return { ...chip, suspect: true, ...(seg.value !== undefined ? { value: seg.value } : {}) };
  });
  return { chips, lines: segs.map((seg) => aligned[seg.line] ?? null) };
}

export function toChips(text: string): Chip[] {
  return readCard(text).chips;
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

/**
 * 칩을 그 칸에 넣을 때의 글자. 메일 · 전화 칩은 뽑은 값, 이름 칸은 직함을 뗀 이름, 나머지는 읽은 줄 그대로.
 * 메일 칩은 주소를 소문자로(UG-451 기획 17030 — @ 앞의 대문자 I 는 읽은 그대로, 17072-4 · scannedEmailValue) — 처음 채우기(autoFill)와
 * 칩 누르기(tapChip)가 모두 여기를 지나요.
 * 글자 읽기의 대소문자는 믿을 수 없고(「USER1+X@EXAMPLE.COM」) 메일 배달은 실제로 대소문자를 가르지 않아요.
 * auth 는 이메일을 대소문자 없이 비교하지만(UMS-56) 적힌 그대로 저장해요 — 대문자로 읽힌 주소가 그대로 계정 주소가 되지 않게 소문자로 넣어요.
 * 직원이 손으로 친 값은 친 그대로 둬요.
 * 잘렸을 수 있는 칩(isSuspectChip)은 명함과 견줘 고치도록 읽은 그대로 둬요.
 */
export function chipValueFor(chip: Chip, field: ScanField): string {
  if (field === "email" && chip.kind === "email") return isSuspectChip(chip) ? chip.value : scannedEmailValue(chip.value);
  if (field === "phone" && chip.kind === "phone") return chip.value;
  if (field === "name") return nameFromLine(chip.text) ?? chip.text;
  return chip.text;
}

/**
 * 처음 채우기(동작 규칙 3 · 칩 규칙 1 · 7): 모양이 정해진 메일(@ 모양) · 연락처(숫자 묶음 — 휴대전화 → 전화 라벨 → 라벨 없음, UG-451)만 채워요.
 * 회사명 · 이름은 여기서 채우지 않아요(기획 16846 — 잘못 읽은 이름 · 회사명이 칸에 들어가 그대로 보내지지 않게) —
 * 글자 인식 점수를 아는 scanCard 가 확실할 때만 채워요(기획 17100). 못 찾은 칸도 비워요(동작 규칙 4).
 */
export function autoFill(chips: Chip[]): { values: ScanValues; links: ScanLinks } {
  const values: ScanValues = { company: "", name: "", email: "", phone: "" };
  const links: ScanLinks = {};
  const put = (field: ScanField, chip: Chip | undefined) => {
    if (!chip) return;
    values[field] = chipValueFor(chip, field);
    links[field] = chip.id;
  };

  // 잘렸거나 잘못 읽혔을 수 있는 메일 칩이 하나라도 있으면 이메일은 채우지 않아요 — 다른 메일 칩(「sales@…」)으로 바꿔 채우지 않게.
  // 칸이 비어 「메일 주소를 찾지 못했습니다」가 떠요(UG-451)
  const emails = chips.filter((c) => c.kind === "email");
  if (!emails.some((c) => c.suspect || isSuspectEmail(c.text))) put("email", emails[0]);

  // 순위(phoneRank)가 가장 앞선 전화 칩, 같으면 먼저 나온 칩. 팩스 · 전화번호 모양이 아닌 숫자만 줄은 채우지 않아요(UG-451)
  let phone: Chip | undefined;
  let phoneBest: number = Infinity;
  for (const c of chips) {
    const rank = phoneRank(c);
    if (rank !== null && rank < phoneBest) {
      phone = c;
      phoneBest = rank;
    }
  }
  put("phone", phone);
  return { values, links };
}

// ── 회사명 · 이름 자동 채움(UG-451 기획 17100 「자동 채움 규칙 M16 · M17」) · 못 읽은 명함 판정(기획 17106) ──
// 이 화면의 회사명 · 이름은 고객에게 가는 메일 첫 줄에 찍혀요 — 틀리게 채우느니 비워요. 후보가 둘이거나 하나여도 의심스러우면 비워요.

/** 글자 읽기 도구(tesseract)가 준 낱말 · 줄 — confidence = 글자 인식 점수(0~100). card-ocr.ts 가 만들어 줘요 */
export type OcrWord = { text: string; confidence: number };
export type OcrLine = { text: string; confidence: number; words: readonly OcrWord[] };

/**
 * 글자 인식 점수 기준(0~100, tesseract 의 낱말 점수 — 늘 「그 값을 이루는 낱말」 점수 가운데 가장 낮은 값으로 봐요).
 * 근거는 지어낸 명함 그림을 이 도구로 읽힌 표본이에요(바로 · 기울임 · 어둡게 · 흐림 · 작은 해상도 · 아이콘 · 돌림). 표본이 작고 그림이라,
 * 실물 사진 · 실기기(아이패드 · 휴대폰)에서는 분포가 다를 수 있어요 — 전시 뒤 실기기 표본으로 다시 봐야 해요(UG-456).
 * 표본: 지어낸 명함 6종 × 변형 16종 = 96장을 네 방향으로 읽힘(384번), 그리고 반박 리뷰의 84장.
 * - NAME_FILL_CONF · COMPANY_FILL_CONF(90): 이름 · 회사명은 칸에 넣을 낱말이 모두 이 점수 이상일 때만 채워요.
 *   맞게 읽은 이름 줄 81건 가운데 71건이 최저점 90 이상(나머지 42~85)이었고, 틀리게 읽은 이름 줄은 0 · 9 · 31 · 79 · 82(「Tan Wej Ling」),
 *   리뷰 표본에서는 82 · 86 · 87 · 88 까지 나왔어요(「박서준」 → 「박서순」의 「순」 87). 그래서 80 이 아니라 90 — 틀린 낱말이 80대로 나와요.
 *   회사명 줄도 한글 글자를 같은 식으로 틀리게 읽을 수 있어 같은 기준이에요(맞게 읽은 86건 가운데 70건이 90 이상, 틀리게 읽은 1건은 82).
 *   못 채우는 쪽은 괜찮아요(직원이 칩을 눌러 넣어요).
 * - JUNK_CONF(60): 줄 끝의 한두 글자 조각은 점수가 이보다 낮을 때만 잡글자로 떼요. 점수가 높으면 이름의 일부일 수 있어(「채널 A」) 그 줄은 채우지 않아요.
 * - FOUND_CONF(60) · EMAIL_FOUND_CONF(40): 명함이 바로 놓였는지 모를 때, 번호 · 주소를 이루는 낱말이 이 점수 이상이어야 「찾은 것」으로 쳐요.
 *   거꾸로 · 옆으로 읽힌 방향에서 나온 번호 30건의 값 낱말 점수는 0~75(대부분 35 이하, 60 이상은 「957 6619 59」 꼴 — 번호 모양으로 걸러요),
 *   바로 놓인 명함에서 맞게 읽은 번호 74건 가운데 70건이 75 이상이었어요. 이메일은 틀린 방향 읽기 288건에서 한 번도 주소 모양으로 채워지지 않았고
 *   맞게 읽은 주소 58건의 낱말 점수가 46~92 라 더 낮게 잡았어요.
 * - CLEAR_CONF(80) · UPRIGHT_LINES(2): 글자 낱말이 모두 80 이상인 줄이 둘 이상이면 바로 놓인 명함으로 봐요. 틀린 방향 읽기 288건 가운데
 *   그런 줄이 둘 나온 것은 1건(「는 E 5」 같은 한 글자 조각 줄)뿐이라, 글자 셋 이상인 낱말이 있는 줄만 세게 했어요.
 */
export const NAME_FILL_CONF = 90;
export const COMPANY_FILL_CONF = 90;
const JUNK_CONF = 60;
const FOUND_CONF = 60;
const EMAIL_FOUND_CONF = 40;
const CLEAR_CONF = 80;
/** 또렷이 읽은 글자 줄이 이만큼 있으면 바로 놓인 명함으로 봐요 */
const UPRIGHT_LINES = 2;
/** 읽힌 글자 · 숫자가 이보다 적으면 글자가 거의 없는 사진(뒷면 · 빈 사진)으로 봐요 — 돌려 읽어도 소용없어요 */
const SPARSE_CHARS = 12;
/** 줄 끝에서 떼는 조각 수 상한 */
const MAX_TAIL_JUNK = 3;
/** 채울 회사명 길이 상한 — 화면의 회사명 상한(40자)과 같아요. 넘는 줄은 회사명 한 줄이 아니에요(주소 · 안내 글) */
const COMPANY_FILL_MAX = 40;

/** 읽은 글자의 줄(cardLines)마다 글자 읽기 도구의 줄을 차례대로 맞춰요 — 맞는 줄이 없으면 null(점수를 모르는 줄은 채우지 않아요) */
function alignLines(text: string, ocr?: readonly OcrLine[] | null): (OcrLine | null)[] {
  const lines = cardLines(text);
  if (!ocr) return lines.map(() => null);
  const norm = ocr.map((l) => normalizeLine(l.text.replace(/[\r\n]+/g, " ")));
  let at = 0;
  return lines.map((line) => {
    for (let k = at; k < norm.length; k++) {
      if (norm[k] !== line) continue;
      at = k + 1;
      return ocr[k];
    }
    return null;
  });
}

const cleanWord = (word: string) => cleanSegment(normalizeLine(word));
const squash = (text: string) => text.replace(/\s+/g, "");
/** 글자 · 숫자가 든 낱말만 — 칩을 만들 때 지워진 기호뿐인 낱말(「|」 「~」)의 점수는 보지 않아요 */
const lettered = (words: readonly OcrWord[]) => words.filter((w) => cleanWord(w.text) !== "");
/** 글자 · 숫자가 하나라도 든 낱말만 — 아이콘을 읽은 기호 조각(「®」 「©」 「&」 「=」)의 점수는 보지 않아요 */
const alnumWords = (words: readonly OcrWord[]) => words.filter((w) => /[\p{L}\p{N}]/u.test(w.text));
/** 줄의 글자 낱말 점수 가운데 가장 낮은 값(낱말이 없으면 줄 점수) */
const lineFloor = (line: OcrLine) => {
  const words = alnumWords(line.words);
  return words.length > 0 ? Math.min(...words.map((w) => w.confidence)) : line.confidence;
};

/**
 * 값(번호 · 주소)을 이루는 낱말들의 점수 가운데 가장 낮은 값(UG-451 반박 리뷰 3) — 그 줄의 다른 낱말(라벨 · 아이콘 조각 · 줄 끝 잡음)은 보지 않아요.
 * 글자 · 숫자 · @ 만 견줘 값을 품는 가장 짧은 낱말 묶음을 찾아요. 찾지 못하면 그 줄 글자 낱말 전체의 가장 낮은 점수, 줄을 모르면 null.
 */
function valueConfidence(value: string, line: OcrLine | null): number | null {
  if (!line) return null;
  const key = (text: string) => text.toLowerCase().replace(/[^a-z0-9@]/g, "");
  const target = key(value);
  const words = alnumWords(line.words);
  let best: OcrWord[] | null = null;
  for (let i = 0; target !== "" && i < words.length; i++) {
    let joined = "";
    for (let j = i; j < words.length; j++) {
      joined += key(words[j].text);
      if (!joined.includes(target)) continue;
      if (best === null || j - i + 1 < best.length) best = words.slice(i, j + 1);
      break;
    }
  }
  return best ? Math.min(...best.map((w) => w.confidence)) : lineFloor(line);
}

/**
 * 칩 글자를 이루는 낱말들(줄 안에서 이어진 낱말 묶음) — 구분자로 나뉜 조각은 그 조각의 낱말만. 찾지 못하면 null.
 * 도구의 「낱말」은 띄어쓰기와 다를 수 있어요(한글은 「가나다테크」를 「가」 「나」 「다」 「테크」로 나눠 줘요) — 공백을 빼고 견줘요.
 */
function wordsOf(text: string, line: OcrLine): OcrWord[] | null {
  const words = lettered(line.words);
  const target = squash(text);
  for (let i = 0; i < words.length; i++) {
    let joined = "";
    for (let j = i; j < words.length; j++) {
      joined = joined ? `${joined} ${words[j].text}` : words[j].text;
      if (squash(cleanWord(joined)) === target) return words.slice(i, j + 1);
    }
  }
  return null;
}

// 한 낱말로 읽힌 법인 표시 — 한 글자 조각으로 보고 떼면 안 돼요
const COMPANY_MARK_TOKEN_RE = /^(?:\(주\)|㈜|\(유\))[.,]?$/;

/**
 * 줄 끝의 잡글자 조각인지(규칙 2) — symbol = 글자 · 숫자가 없는 기호뿐인 낱말, piece = 한 글자(숫자 · 로마자 · 한글) · 소문자 로마자 두 글자 토막.
 * 「Ltd.」 「Inc.」 「Co.」 「(주)」 「AI」 「24」 같은 낱말은 조각이 아니에요.
 */
function tailJunk(token: string): "symbol" | "piece" | null {
  if (COMPANY_MARK_TOKEN_RE.test(token)) return null;
  const core = coreOf(token);
  if (core === "") return "symbol";
  return [...core].length === 1 || /^[a-z]{2}$/.test(core) ? "piece" : null;
}

/**
 * 줄 끝 잡글자를 뗀 글자(점수는 보지 않아요 — 후보를 세는 데 써요). dropped = 뗀 조각 수.
 * 조각을 뗀 뒤 끝 낱말에 조사 「를」이 붙어 있으면 그것도 떼요(기획 17100 의 예와 같은 모양: 「주식회사 한빛테크를 0」 → 「주식회사 한빛테크」) —
 * 회사명 · 이름은 「를」로 끝나지 않아요. 뒤에 잡글자가 있을 때만(잡음이 붙었다는 증거) 떼요.
 */
function looseStrip(text: string): { value: string; dropped: number } {
  const tokens = text.split(" ");
  let dropped = 0;
  while (tokens.length > 1 && dropped < MAX_TAIL_JUNK && tailJunk(tokens[tokens.length - 1])) {
    tokens.pop();
    dropped++;
  }
  const last = tokens[tokens.length - 1];
  if (dropped > 0 && /^[가-힣]{3,}를$/.test(last)) tokens[tokens.length - 1] = last.slice(0, -1);
  return { value: tokens.join(" "), dropped };
}

/**
 * 칩 글자 → 칸에 넣을 글자(줄 끝 잡글자를 뗌)와 그 점수(남은 낱말 점수 가운데 가장 낮은 값). 채우면 안 되면 null:
 * - 그 줄의 점수를 모름
 * - 뗄 조각의 점수를 모르거나, 기호가 아닌 조각의 점수가 높음(JUNK_CONF 이상 — 잡글자가 아니라 이름의 일부일 수 있어요)
 * 칩은 읽은 그대로 보여 주고, 떼는 것은 칸에 채울 때만이에요.
 */
function settle(text: string, line: OcrLine | null): { value: string; confidence: number } | null {
  if (!line) return null;
  const loose = looseStrip(text);
  const words = wordsOf(text, line);
  if (loose.dropped === 0) {
    const used = words ?? lettered(line.words);
    return { value: text, confidence: Math.min(words ? 100 : line.confidence, ...used.map((w) => w.confidence)) };
  }
  if (!words) return null;
  const kept = [...words];
  const tokens = text.split(" ");
  for (let d = 0; d < loose.dropped; d++) {
    const token = tokens.pop() as string;
    // 이 조각을 이루는 낱말(들)을 끝에서부터 맞춰요
    let tail = "";
    let low = 100;
    while (kept.length > 0 && tail.length < token.length) {
      const word = kept.pop() as OcrWord;
      tail = squash(cleanWord(word.text)) + tail;
      low = Math.min(low, word.confidence);
    }
    if (tail !== token) return null;
    if (tailJunk(token) === "piece" && low >= JUNK_CONF) return null;
  }
  // 끝 낱말에서 뗀 「를」이 따로 읽힌 낱말이면 그 점수는 보지 않아요
  if (loose.value !== tokens.join(" ") && kept.length > 1 && cleanWord(kept[kept.length - 1].text) === "를") kept.pop();
  if (kept.length === 0) return null;
  return { value: loose.value, confidence: Math.min(...kept.map((w) => w.confidence)) };
}

// 법인 표시(규칙 1 「주식회사 · (주) · Co., Ltd. · Inc. · Corp. · Pte. Ltd.」와 같은 뜻의 표시) — 홀로 쓴 「Co」 「Company」는 표시로 보지 않아요
const COMPANY_MARK =
  String.raw`\(주\)|㈜|\(유\)|주식회사|유한회사|유한책임회사|` +
  String.raw`(?:^|[^A-Za-z0-9])(?:co\.?\s*,?\s*ltd|pte\.?\s*ltd|ltd|inc|incorporated|corp|corporation|llc|gmbh)(?![A-Za-z0-9-])|` +
  // 「Limited」는 이름 낱말 뒤 줄 끝에 올 때만(「Acme Trading Limited」) — 「Limited Edition」 같은 문구는 법인 표시가 아니에요(반박 리뷰 6)
  String.raw`[A-Za-z0-9가-힣).]\s+limited\.?$`;
// 법인 표시가 들어 있어도 회사명 한 줄이 아닌 문구(인증 · 대리점 · 협력사 표시) — 이런 낱말이 섞인 줄은 회사명으로 채우지 않아요(반박 리뷰 6)
const COMPANY_NOISE_RE =
  /인증|공식|대리점|협력|파트너|지정|가맹|회원사|총판|특약|취급|판매점|수상|선정|(?:^|[^A-Za-z])(?:edition|authorized|authorised|certified|partner|dealer|distributor|reseller|member|official|agent|since|established)(?![A-Za-z])/i;
const COMPANY_MARK_RE = new RegExp(COMPANY_MARK, "i");
const COMPANY_MARK_RE_G = new RegExp(COMPANY_MARK, "gi");

// 누리집 · 도메인 모양이 든 줄 — 회사명(도메인 근거) · 이름 후보에서 빼요
const URL_LIKE_RE =
  /(?:^|[\s(])(?:www\.|https?:)|[A-Za-z0-9-]\.(?:com|net|org|co|kr|sg|jp|cn|io|ai|biz|info|my|hk|tw|id|vn|th|ph|au|uk|us)(?:[/\s.,)]|$)/i;
const isUrlLike = (text: string) => URL_LIKE_RE.test(text);

/** 로마자 낱말을 목록과 견줄 글자로(소문자, 로마자 · - 만) */
const enKey = (token: string) => token.toLowerCase().replace(/[^a-z-]/g, "");

// 사람 직함 · 호칭(영어) — 이 낱말이 든 줄은 회사명 · 이름으로 채우지 않아요
const EN_TITLE_WORDS = new Set(
  (
    "ceo cto cfo coo cmo cio cso cpo vp evp svp avp president vice chairman chairwoman chair founder co-founder cofounder owner " +
    "manager director head lead leader senior junior chief officer engineer developer designer architect consultant advisor adviser " +
    "representative rep partner principal executive assistant associate specialist analyst researcher scientist professor prof " +
    "dr mr ms mrs miss mdm madam sir intern staff supervisor coordinator administrator admin secretary accountant auditor lawyer " +
    "attorney counsel editor writer producer planner strategist agent broker trader buyer recruiter trainer instructor teacher " +
    "lecturer technician operator controller treasurer curator hacker"
  ).split(" "),
);
// 부서 · 직무(영어)
const EN_DEPT_WORDS = new Set(
  (
    "sales marketing team department dept division unit hr human resources finance accounting legal operations strategy planning " +
    "procurement purchasing support customer client success account accounts public relations office headquarters hq branch " +
    "business development research product project program quality assurance production general affairs management"
  ).split(" "),
);
// 항목 이름 · 주소 · 나라 · 도시(영어). 성씨와 겹치는 낱말(park · ho · chi · minh · hong · kong · bay · lane · york)은 넣지 않고 아래 지명 묶음으로 봐요
const EN_PLACE_WORDS = new Set(
  (
    "tel telephone fax mobile phone email e-mail mail www http https web website homepage address contact " +
    "korea seoul busan incheon daegu daejeon gwangju republic singapore malaysia indonesia jakarta thailand bangkok vietnam hanoi " +
    "philippines manila japan tokyo osaka china beijing shanghai shenzhen taiwan taipei india mumbai delhi australia sydney " +
    "melbourne usa america united states kingdom london california asia pacific apac europe emea " +
    "road rd street st avenue ave boulevard blvd drive jalan building bldg floor fl level tower plaza centre center place square " +
    "suite block blk city town district the and of for to in at by with your our"
  ).split(" "),
);
// 회사 이름에 흔한 낱말(영어) — 이 낱말이 든 줄은 사람 이름이 아니에요
const EN_BIZ_WORDS = new Set(
  (
    "company co corp corporation inc incorporated ltd limited llc pte gmbh plc group holdings holding partners ventures capital " +
    "investment investments fund bank financial insurance securities asset assets trading logistics shipping freight express " +
    "solutions solution systems system technologies technology tech software digital data cloud network networks labs lab studio " +
    "studios media entertainment games gaming consulting consultancy advisory services service industries industrial industry " +
    "enterprise enterprises international global worldwide electronics electric energy power motors automotive pharma " +
    "pharmaceutical bio biotech medical healthcare health clinic hospital foods food beverage restaurant cafe coffee hotel resort " +
    "travel tours airlines construction engineering realty property properties estate design architects law associates agency " +
    "advertising communications telecom university college school academy institute association society foundation council club " +
    "union federation ministry government store shop mart market retail wholesale supply supplies manufacturing factory works " +
    "products brand brands analytics robotics dynamics semiconductor materials chemical chemicals pharmaceuticals instruments " +
    "devices mobility aerospace marine steel textile apparel cosmetics beauty fashion creative interactive innovation innovations " +
    "intelligence security payments commerce platform platforms bakery kitchen salon clinic dental florist flowers gallery " +
    "photo photography print printing books bookstore pharmacy laundry cleaning repair garage farm farms bistro bar pub grill " +
    "noodle noodles pizza burger chicken tea dessert desserts fitness gym yoga spa nails tattoo records music films pictures"
  ).split(" "),
);
// 사람 이름이 아닌 흔한 영어 낱말(인사 · 문구 · 부서 이름에 쓰이는 낱말, 반박 리뷰 5 — 「Hello Tomorrow」 「Dream Big Together」 「Info Desk」) —
// 이 낱말이 든 줄은 이름 모양이 아니에요. 이름으로도 쓰이는 낱말(Sunny · Joy · Grace · Rose · May · Moon · Sun · Star · Young)은 넣지 않았어요
const EN_COMMON_WORDS = new Set(
  (
    "hello hi hey welcome thanks thank tomorrow today dream dreams big small together info desk press inquiries inquiry enquiries " +
    "enquiry events event crew growth art happy good great best better new next future smart simple easy fast free open real true " +
    "pure fresh daily life live love care home house room space world idea ideas story stories make made build create think " +
    "different just more first plus pro max mini super ultra premium quality original classic modern urban contact follow visit " +
    "scan call ask get go let us we you me it is are be or not no yes all any every always never one two three family"
  ).split(" "),
);
/**
 * 사람이 아니라 역할 · 대표로 쓰는 메일함 이름(반박 리뷰 5) — @ 앞이 이런 낱말이면 영어 이름의 근거로 쓰지 않아요(hello@ · info@ · press@ · dream@),
 * 이름 줄의 낱말이 이런 낱말이면 그 낱말로는 뒷받침하지 않아요.
 */
const ROLE_MAILBOX = new Set(
  (
    "hello hi hey info information contact contacts sales sale press pr media events event growth team office admin administrator " +
    "support help helpdesk service services cs hr careers career jobs job recruit recruiting hiring marketing biz business shop store " +
    "order orders booking bookings reservation reservations enquiry enquiries inquiry inquiries general mail email news newsletter " +
    "dream ask care customer customers account accounts billing finance legal partner partners partnership webmaster postmaster " +
    "noreply reply feedback ceo design dev tech it lab labs studio official online ops operations people privacy project projects " +
    "purchase qa reception security ticket tickets trade training web welcome work works world master manager director staff member " +
    "members club community company corp group global korea asia curator editor"
  ).split(" "),
);

// 대문자로 시작하는 두세 낱말이지만 지명인 묶음
const EN_PLACE_PHRASES = new Set("hong kong|ho chi minh|kuala lumpur|new york|new delhi|marina bay|raffles place|south korea|north america".split("|"));

/**
 * 한국 성씨 → 로마자 표기들. 한글 이름 후보는 이 성씨로 시작해야 해요(「카카오」 「디자인」 같은 낱말을 걸러요) —
 * 또 한글 이름과 영어 이름이 함께 있는 명함에서 둘이 같은 사람인지(성씨 표기가 맞는지) 볼 때 써요.
 * 흔한 성씨만 넣었어요 — 드문 성씨(사 · 부 · 호 · 상 · 단 …)는 뺐어요(「사무실」 「부산시」 같은 낱말이 후보가 되지 않게). 그 성씨의 이름은 직접 넣어요.
 */
const KO_SURNAME_ROMAN: Record<string, string[]> = Object.fromEntries(
  (
    "김:kim gim|이:lee yi rhee ree li i|박:park pak bak|최:choi choe|정:jung jeong chung jeung|강:kang gang|조:cho jo|윤:yoon yun|" +
    "장:jang chang|임:lim im yim|한:han|오:oh o|서:seo suh so|신:shin sin|권:kwon gwon|황:hwang|안:ahn an|송:song|전:jeon jun chun|" +
    "홍:hong|유:yoo yu you ryu|고:ko go koh|문:moon mun|양:yang|손:son sohn|배:bae bai|백:baek paek back|허:heo hur huh|남:nam|" +
    "심:shim sim|노:noh roh no|하:ha|곽:kwak gwak|성:sung seong|차:cha|주:joo ju|우:woo wu|구:koo gu ku|민:min|류:ryu ryoo yoo|" +
    "나:na ra|진:jin|지:ji jee|엄:eom um uhm|채:chae|원:won|천:chun cheon|방:bang|공:kong gong|현:hyun hyeon|함:ham|변:byun byeon|" +
    "염:yeom yum|여:yeo yuh|추:choo chu|도:do|소:so|석:seok suk|선:sun seon|설:seol sul|마:ma|길:gil kil|연:yeon youn|위:wi wee|" +
    "표:pyo|명:myung myeong|기:ki gi|반:ban|라:ra na|왕:wang|금:geum keum|옥:ok|육:yook yuk|인:in|맹:maeng|제:je|모:mo|탁:tak|" +
    "국:kook guk|어:eo|은:eun|편:pyun pyeon|용:yong|예:ye|봉:bong|" +
    "남궁:namgung namkung namgoong|황보:hwangbo|제갈:jegal|선우:sunwoo seonwoo|독고:dokgo|사공:sagong|서문:seomun"
  )
    .split("|")
    .map((entry) => {
      const [surname, roman] = entry.split(":");
      return [surname, roman.split(" ")];
    }),
);
/** 한글 낱말이 시작하는 성씨(두 글자 성씨 먼저) — 없으면 null */
function koSurnameOf(word: string): string | null {
  const two = word.slice(0, 2);
  if (word.length > 2 && KO_SURNAME_ROMAN[two]) return two;
  return KO_SURNAME_ROMAN[word[0]] ? word[0] : null;
}

// 성씨 글자로 시작하지만 이름이 아닌 흔한 낱말(직무 · 부서 · 지역 · 항목 이름) — 이름 후보에서 빼요. 직함 · 부서 끝말은 KO_TITLES · KO_DEPT_SUFFIX 가 따로 봐요
const KO_NOT_NAME = new Set(
  (
    "연락처 서비스 고객사 고객님 고객명 고객팀 이사회 이사님 이름란 한국어 한국인 한의사 한의원 주소지 주무관 주방장 주식회 " +
    "공장장 공무원 변리사 변호인 노무사 기술사 기술부 기술원 기술직 기관장 기관사 기획실 기획부 기획자 위원장 편집장 마스터 마케터 " +
    "설계사 서기관 서울시 조사관 조리장 조리사 조합장 조합원 인천시 인사부 인사과 인재원 강원도 전라도 전략실 전산실 전화기 " +
    "제주도 제작자 제작사 제약사 안내문 안내원 안전부 유한회 유선전 유튜브 유통부 유통사 임직원 임원진 원장님 원장실 선생님 성명란 " +
    "모바일 연구실 연구부 연구자 연수원 정보실 지원부 지원실 지배인 지부장 홍보실 홍보부 구매부 은행원 은행장 반장님 방송국 " +
    "신문사 여행사 금융사 유한회사 주식회사 고객센터 기술지원 인사총무 전략기획 정보보호 고객지원 연구개발 " +
    // 이름 글자로만 된 보통 낱말(반박 리뷰 후속 4) — 한 줄뿐일 때 이름으로 채워지거나 다른 이름을 가렸어요
    "인문학 금요일 신청서 소비자 한정식 주유소 전단지 안내서 설명서 제안서 지원서 이력서 주문서 신고서 인증서 고지서 소개서 " +
    "디자인 코리아 관리자 사용자 운영자 이용자 구매자 지원자 신청자"
  ).split(" "),
);

/** 「이메일 도메인과 같은 영문 이름」의 근거로 쓰지 않는 공용 메일 도메인(등록 이름) */
const PUBLIC_MAIL = new Set(
  (
    "gmail googlemail naver daum hanmail kakao nate outlook hotmail live msn yahoo ymail icloud me mac aol proton protonmail pm " +
    "qq 163 126 sina foxmail gmx mail zoho yandex korea dreamwiz empas paran lycos chol hitel singnet starhub pacific hanmir yeah " +
    "tutanota fastmail duck"
  ).split(" "),
);
// 나라 도메인 앞에 오는 둘째 단계(「.co.kr」 「.com.sg」)
const SECOND_LEVEL = new Set("com co net org ac or go edu gov ne re pe mil".split(" "));

/**
 * 이메일 도메인의 등록 이름(「kim@bluepeak.com.sg」 → bluepeak, 「lee@mail.company-a.co.kr」 → company-a).
 * 공용 메일 도메인(gmail · naver …)이거나 세 글자보다 짧으면 null — 회사명 근거로 쓰지 않아요.
 */
export function emailDomainName(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at === -1) return null;
  const labels = email
    .slice(at + 1)
    .toLowerCase()
    .split(".")
    .filter(Boolean);
  if (labels.length < 2) return null;
  let i = labels.length - 2;
  if (labels.length >= 3 && labels[labels.length - 1].length === 2 && SECOND_LEVEL.has(labels[i])) i--;
  const name = labels[i];
  return /^[a-z0-9-]{3,}$/.test(name) && !PUBLIC_MAIL.has(name) ? name : null;
}

/** 줄에 도메인 등록 이름이 낱말로(이어진 낱말을 붙여서도 — 「Blue Peak」 · 「Miraero-Logis」) 들어 있는지 */
function hasDomainWord(text: string, name: string): boolean {
  const target = name.replace(/-/g, "");
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    let joined = "";
    for (let j = i; j < words.length && j < i + 3; j++) {
      joined += words[j];
      if (joined === target) return true;
    }
  }
  return false;
}

/** 이름 옆 직함 낱말인지(한글) — 직함 그대로이거나 직함으로 끝나는 낱말(「공동대표이사」). 부서 끝말(팀 · 그룹)은 회사명에도 쓰여 보지 않아요 */
function isTitleToken(t: string): boolean {
  if (KO_TITLES.has(t)) return true;
  if (t.length < 3) return false;
  for (const title of KO_TITLES) if (title.length >= 2 && t.length > title.length && t.endsWith(title)) return true;
  return false;
}

/** 법인 표시가 든 줄을 회사명으로 채워도 되는지 — 길이 · 번호 · 주소 · 직함이 섞인 줄(한 줄짜리 꼬리말)은 채우지 않아요 */
function markedCompanyOk(value: string): boolean {
  if ([...value].length > COMPANY_FILL_MAX || /@|\d{3,}/.test(value) || isUrlLike(value)) return false;
  const tokens = value.split(" ");
  if (tokens.length > 8) return false;
  if (tokens.some((t) => isTitleToken(coreOf(t)) || EN_TITLE_WORDS.has(enKey(t)) || EN_PLACE_WORDS.has(enKey(t)))) return false;
  if (COMPANY_NOISE_RE.test(value)) return false;
  // 표시만 있는 줄(「주식회사」 「Co., Ltd.」)은 회사명이 아니에요
  return (value.replace(COMPANY_MARK_RE_G, " ").match(/\p{L}/gu)?.length ?? 0) >= 2;
}

/**
 * 도메인 이름이 든 줄을 회사명으로 채워도 되는지 — 대문자 · 숫자로 시작하는 낱말 네 개까지(「BluePeak Logistics」),
 * 직함 · 부서 · 주소 낱말이 없고 사람 이름 모양(대문자로 시작하는 두세 낱말, 「Blue Peak」 「Tan Wei Ling」)이 아닐 때만.
 */
function domainCompanyOk(value: string): boolean {
  if ([...value].length > COMPANY_FILL_MAX || /[가-힣@]|\d{3,}/.test(value) || isUrlLike(value)) return false;
  const tokens = value.split(" ");
  if (tokens.length > 4) return false;
  if (!tokens.every((t) => /^[A-Z0-9]/.test(t) || t === "&")) return false;
  if (tokens.some((t) => EN_TITLE_WORDS.has(enKey(t)) || EN_DEPT_WORDS.has(enKey(t)) || EN_PLACE_WORDS.has(enKey(t)))) return false;
  return enNameTokens(value) === null;
}

/** 영어 이름의 한 낱말 모양 — 대문자로 시작(「Tan」 「TAN」 「Wei-Ling」 「O'Brien」), 모음이 있고(「Ng」는 받아요), 직함 · 부서 · 회사 · 주소 낱말 · 약어가 아님 */
function isEnNameWord(t: string): boolean {
  if (t.length < 2 || !t.split(/[-'’]/).every((x) => /^[A-Z][a-z]*$/.test(x) || /^[A-Z]{2,}$/.test(x))) return false;
  const key = enKey(t);
  if (!/[aeiouy]/.test(key) && key !== "ng") return false;
  if (CAPS_WORDS.has(t) || EN_STOPWORDS.has(key) || EN_TITLE_WORDS.has(key) || EN_DEPT_WORDS.has(key)) return false;
  return !EN_PLACE_WORDS.has(key) && !EN_BIZ_WORDS.has(key) && !EN_COMMON_WORDS.has(key);
}

/** 줄이 「대문자로 시작하는 영어 2~3낱말만」인 이름 모양이면 그 낱말들(쉼표 · 구분자로 나뉜 조각 가운데 하나만 그럴 때), 아니면 null */
function enNameTokens(text: string): string[] | null {
  if (/[\d@가-힣]/.test(text)) return null;
  const hits: string[][] = [];
  for (const part of text.split(/\s*[,|/·•]\s*/)) {
    const tokens = part.split(" ").filter((t) => /\p{L}/u.test(t));
    if (tokens.length < 2 || tokens.length > 3 || !tokens.every(isEnNameWord)) continue;
    if (EN_PLACE_PHRASES.has(tokens.join(" ").toLowerCase())) continue;
    hits.push(tokens);
  }
  return hits.length === 1 ? hits[0] : null;
}

/**
 * 영어 이름 낱말이 이메일 @ 앞에 들어 있는지(「Tan Wei Ling」 ↔ weiling.tan@ · 「Lena Koh」 ↔ lena@) — 그 줄이 이 명함 주인의 이름이라는 근거예요.
 * 세 글자 이상 낱말은 @ 앞(로마자만 이어 붙인 것)에 들어 있으면, 두 글자 낱말(「Li」 「Ng」)은 점 · 밑줄로 나뉜 조각과 같으면 돼요.
 * 받아들인 것(남는 위험): 「sunnylee@gmail.com」 같은 공용 메일 + 「Sunny Lee」 꼴의 상호(목록에 없는 낱말 둘)는 사람 이름과 가를 수 없어요.
 */
function emailBacksName(tokens: readonly string[], email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at <= 0) return false;
  const local = email.slice(0, at).toLowerCase();
  const letters = local.replace(/[^a-z]/g, "");
  const pieces = local.split(/[^a-z]+/).filter(Boolean);
  // 역할 · 대표 메일함(hello@ · info@ · press@ …)은 사람 이름의 근거가 아니에요(반박 리뷰 5)
  if (ROLE_MAILBOX.has(letters) || (pieces.length > 0 && pieces.every((p) => ROLE_MAILBOX.has(p)))) return false;
  return tokens
    .flatMap((t) => t.toLowerCase().split(/[-'’]/))
    .filter((n) => !ROLE_MAILBOX.has(n))
    .some((n) => (n.length >= 3 ? letters.includes(n) : n.length === 2 && pieces.includes(n)));
}

// 이름 뒤에 붙는 직함으로 자동 채움이 더 아는 낱말(KO_TITLES 에 더해) — 「홍길동 기자」에서 홍길동을 떼어 채워요.
// 여기에도 없는 낱말이 붙은 줄(「홍길동 주무」)은 채우지 않고 후보로만 세요
const KO_NAME_TITLES = new Set(
  "기자 피디 작가 감독 간호사 의사 약사 교사 강사 계장 반장 조장 점장 국장 처장 관장 원장 지배인 셰프 인턴 수습 간사 비서 팀원 실무자 사무장 주사".split(" "),
);
// 조직 · 장소 끝말(세 글자 이상) — 이름은 이 글자로 끝나지 않아요. 부서 · 장소 낱말로 보고 이름 줄에서 떼요
// (「정치부」 「원무과」 「강남점」 「강남역」 「전시회」 「금융권」, 반박 리뷰 1 — 성씨 글자로 시작하는 부서 줄이 이름으로 채워졌어요)
const KO_ORG_END = /(부|과|처|점|역|회|권)$/;
// 이름도 이 글자로 끝날 수 있는 조직 · 장소 끝말 — 직함 없이 홀로 있는 낱말이 이 글자로 끝나면 채우지 않아요(동 이름 · 섬 이름 · 「○○대」 · 「○○장」 · 「○○리」).
// 그 글자로 끝나는 진짜 이름(홍길동 · 이지원)도 홀로 있으면 비워요 — 빈칸이 나아요. 직함이 붙은 줄(「홍길동 과장」)은 채워요. 후보로는 세요
const KO_SOFT_END = /(실|국|동|대|장|도|원|시|군|읍|면|구|리|로|길)$/;
// 두 낱말 줄의 첫 낱말로 흔한 지역 이름 — 이름 후보로 세지 않아요(「인천 연수구」 「강남 사옥」)
const KO_PLACES = new Set(
  "서울 부산 대구 인천 광주 대전 울산 세종 경기 강원 충북 충남 전북 전남 경북 경남 제주 강남 강북 강서 강동 성남 수원 용인 고양 안양 판교 분당 송도".split(" "),
);
/**
 * 한글 이름(성 뒤)에 흔히 쓰이는 글자 — 이름 후보의 성씨 뒤 글자는 모두 여기 있어야 해요. 성씨 글자로 시작하는 상호 · 학교 · 보통 낱말을 걸러요
 * (계 · 마 · 트 · 디 · 야 · 뚜 · 켓 · 앤 · 울 · 려 · 직 처럼 이름에 드문 글자가 든 세 글자 낱말 — 시험의 「한 줄뿐일 때 채워지던 낱말」 목록).
 * 여기 없는 글자가 든 이름은 채우지 않아요(직원이 넣어요).
 */
const KO_GIVEN = new Set(
  (
    "가 갑 강 건 겸 경 고 곤 관 광 구 국 규 균 근 금 기 길 나 남 늘 다 단 담 대 덕 도 동 두 득 라 란 람 랑 래 련 령 로 록 룡 리 린 림 " +
    "만 명 무 문 미 민 배 백 범 별 병 보 복 봄 봉 비 빈 빛 산 삼 상 새 샘 서 석 선 설 섭 성 세 소 솔 송 수 숙 순 슬 승 시 식 신 실 심 " +
    "아 안 애 양 여 연 열 엽 영 예 오 옥 온 완 요 용 우 욱 운 웅 원 유 윤 율 은 을 이 익 인 일 자 장 재 정 제 종 주 준 중 지 진 찬 창 " +
    "채 철 청 초 춘 충 태 택 필 하 학 한 해 향 헌 혁 현 형 혜 호 홍 화 환 효 후 훈 휘 흥 희"
  ).split(" "),
);

// 주소 낱말의 끝말(행정 구역 · 길 · 층) — 이런 낱말이 이어진 줄은 주소예요
const KO_ADDRESS_END = /(시|도|구|군|읍|면|동|로|길|리|가|층|호)$/;

/** 이름 줄에서 떼는 낱말(한글) — 직함 · 부서(isRoleToken · KO_NAME_TITLES)와 조직 · 장소 끝말로 끝나는 세 글자 이상 낱말 */
const isNameSideWord = (t: string) => isRoleToken(t) || KO_NAME_TITLES.has(t) || (t.length >= 3 && /^[가-힣]+$/.test(t) && KO_ORG_END.test(t));

/** 이름 후보가 될 수 있는 한글 낱말 — 한글 2~4자이고 이름이 아닌 흔한 낱말(직함 · 항목 이름 · 지역)이 아님 */
function isKoWord(t: string): boolean {
  if (!/^[가-힣]{2,4}$/.test(t)) return false;
  return !(KO_STOPWORDS.has(t) || KO_TITLES.has(t) || KO_DEPT_SUFFIX.test(t) || KO_NOT_NAME.has(t) || KO_PLACES.has(t));
}

/** 첫 글자(성) 뒤 글자가 모두 이름에 쓰이는 글자(KO_GIVEN)인지 */
function hasGivenLetters(t: string): boolean {
  const given = t.slice((koSurnameOf(t) ?? t[0]).length);
  return given.length > 0 && [...given].every((ch) => KO_GIVEN.has(ch));
}

/** 한글 이름일 수 있는 낱말 — isKoWord 이고 성 뒤 글자가 모두 이름에 쓰이는 글자 */
const isKoNameWord = (t: string) => isKoWord(t) && hasGivenLetters(t);

/**
 * 한글 이름 후보를 채워도 될 만큼 이름 모양인지 — 성씨로 시작하는 세 글자(성 + 이름 두 자), 또는 두 글자 성씨로 시작하는 네 글자.
 * 두 글자는 채우지 않아요 — 띄어쓰기 없는 한글 두 글자 줄은 칩으로도 보이지 않고(isJunkChip — 직함 · 깨진 글자), 「전략」 「기술」 같은 낱말과 가를 수 없어요.
 * 한 글자 성씨의 네 글자도 채우지 않아요(「기술지원」 「고객센터」 같은 낱말이 훨씬 많아요).
 */
function isCertainKoName(name: string): boolean {
  const surname = koSurnameOf(name);
  return surname !== null && (name.length === 3 || (name.length === 4 && surname.length === 2));
}

/**
 * 줄에서 본 한글 이름 후보들(UG-451 반박 리뷰 1). fillable = 그 줄에서 이름을 떼어 채워도 되는지 — 아니면 「후보가 하나인지」 셀 때만 써요.
 * - 직함 · 부서 낱말을 빼고 한 낱말이 남음(「홍길동」 「홍길동 팀장」 「정치부 홍길동 기자」):
 *   성씨로 시작하면 후보. 이름 모양(isCertainKoName)이고, 직함이 붙었거나 조직 · 장소 끝말(KO_SOFT_END)로 끝나지 않으면 채워도 돼요.
 *   성씨 목록에 없는 낱말은 직함이 붙었을 때만 후보로 세요(「피수진 대리」 — 채우지는 않아요).
 * - 모르는 낱말이 함께 남음(「홍길동 주무」 「홍길동 Manager」 — 이름 + 모르는 직함으로 보이는 줄): 첫 낱말이 성씨로 시작하거나 직함도 붙었으면 후보로만 세요.
 *   이름 줄이 이런 꼴이면 다른 줄의 낱말(부서 · 상호)이 「하나뿐인 후보」가 되어 채워지는 것을 막아요.
 *   주소 줄(숫자가 있거나 「강남구 역삼동」처럼 행정 구역 끝말이 이어진 줄)은 세지 않아요.
 * raw = 잡글자를 떼기 전의 줄(주소 줄의 번지 숫자를 보려고)
 */
function koNameCandidates(text: string, raw: string = text): { name: string; fillable: boolean }[] {
  if (/[\d@]/.test(text)) return [];
  const out: { name: string; fillable: boolean }[] = [];
  for (const part of text.split(/\s*[,|/·•]\s*/)) {
    const tokens = part.split(" ").filter((t) => /[\p{L}\p{N}]/u.test(t));
    const rest = tokens.filter((t) => !isNameSideWord(t));
    const titled = rest.length < tokens.length;
    if (rest.length === 1) {
      const name = rest[0];
      if (!isKoWord(name)) continue;
      // 이름 글자(KO_GIVEN)는 「채워도 되는지」에만 써요 — 성씨로 시작하는 세 글자 낱말 · 직함이 붙은 낱말은 글자와 상관없이 후보로 세요
      // (「김아름 대리」 「김새롬 과장」을 세지 않아 다른 줄의 「한정식」 「주유소」가 하나뿐인 후보로 채워졌어요, 반박 리뷰 후속 4).
      // 성씨도 직함도 없는 낱말은 이름 글자로 된 것만 세요(「피수진」)
      const given = hasGivenLetters(name);
      const surname = koSurnameOf(name) !== null;
      if (surname && (given || titled || name.length === 3)) {
        // 직함이 붙어도 「○○대」(학교)는 채우지 않아요(「한양대 교수」)
        const ending = titled ? !/대$/.test(name) : !KO_SOFT_END.test(name);
        out.push({ name, fillable: given && isCertainKoName(name) && ending });
      } else if (titled || given) out.push({ name, fillable: false });
    } else if ((rest.length === 2 || rest.length === 3) && !/\d/.test(raw)) {
      const [name, ...others] = rest;
      if (KO_ADDRESS_END.test(name) || others.some((t) => /^[가-힣]+$/.test(t) && KO_ADDRESS_END.test(t))) continue;
      if (isKoNameWord(name) && (koSurnameOf(name) !== null || titled)) out.push({ name, fillable: false });
    }
  }
  return out;
}

type TextChip = { chip: Chip; line: OcrLine | null; loose: string };
type Fill = { chip: Chip; value: string };

/** 후보 줄을 채워도 되면(점수 기준 min · 잡글자 판단) 그 줄에서 want 가 뽑은 값, 아니면 null */
function confident(t: TextChip, min: number, want: (value: string) => string | null): Fill | null {
  const settled = settle(t.chip.text, t.line);
  if (!settled || settled.confidence < min) return null;
  const value = want(settled.value);
  return value === null ? null : { chip: t.chip, value };
}

/**
 * 회사명(규칙 1) — 법인 표시가 든 줄이 하나면 그 줄. 법인 표시 줄이 없으면 이메일 도메인과 같은 영문 이름이 든 줄이 하나일 때 그 줄.
 * 법인 표시 줄이 둘 이상(한글 · 영문 법인명이 함께 있는 명함 등)이면 비워요. email = 처음 채우기가 채운 주소(의심 주소로 비웠으면 "" — 도메인 근거를 쓰지 않아요)
 */
function certainCompany(texts: readonly TextChip[], domain: string | null): Fill | null {
  const marked = texts.filter((t) => COMPANY_MARK_RE.test(t.loose));
  if (marked.length > 1) return null;
  // 채울 때 쉼표 앞 공백은 붙여요(「Acme Co. , Ltd.」 → 「Acme Co., Ltd.」) — 칩은 읽은 그대로
  if (marked.length === 1) return confident(marked[0], COMPANY_FILL_CONF, (v) => (markedCompanyOk(v) ? v.replace(/\s+,/g, ",") : null));
  if (!domain) return null;
  const named = texts.filter((t) => !isUrlLike(t.loose) && hasDomainWord(t.loose, domain));
  return named.length === 1 ? confident(named[0], COMPANY_FILL_CONF, (v) => (domainCompanyOk(v) ? v : null)) : null;
}

// 한자 이름으로 보이는 낱말(한자 2~4자) — 이름 줄이 다른 문자로 적혀 있다는 신호예요
const HANJA_NAME_RE = /(?:^|\s)[\u4e00-\u9fff]{2,4}(?:\s|$)/;

/**
 * 이름(규칙 1 · 반박 리뷰 1 · 5) — 회사명 줄(법인 표시 · 회사 낱말 · 도메인 이름이 든 줄)과 누리집 줄은 후보에서 빼요.
 * - 한글 이름 후보(koNameCandidates)를 세요. 명함의 다른 줄에 다시 나오는 낱말(「한서진」 + 「주식회사 한서진푸드」)은 상호라 빼요.
 *   후보가 둘 이상이면 비워요. 하나이고 채워도 되는 줄(fillable)이면 채워요. 단:
 *   · 한자 이름 줄이 따로 있으면 비워요(이름이 다른 문자로 적힌 명함 — 한글 낱말 하나만으로는 이름인지 몰라요)
 *   · 영어 이름 모양 줄이 따로 있으면 그 줄에 이 성씨의 로마자 표기가 있을 때만 채워요(「홍길동」 「Hong Gildong」). 없으면 비워요(「이노벨」 + 「Tan Wei Ling」)
 *   · 글자 인식 점수가 NAME_FILL_CONF 아래여도, 이름의 로마자 표기가 이메일 @ 앞이나 영문 이름 줄과 맞으면(성씨 + 이름의 모든 음절) 채워요(기획 17118-3)
 * - 한글 후보가 없으면: 이메일 @ 앞이 뒷받침하는(emailBacksName) 영어 이름 줄이 하나일 때 그 줄. 채운 회사명과 낱말이 겹치는 줄은 빼요.
 *   이메일이 뒷받침하지 않는 영어 두세 낱말 줄(「Golden Dragon」 「Marina Square」)은 사람 이름인지 알 수 없어 채우지 않아요.
 * all = 명함의 모든 칩(다시 나오는 낱말을 볼 때), company = 채운 회사명(없으면 "")
 */
function certainName(texts: readonly TextChip[], all: readonly Chip[], domain: string | null, email: string, company: string): Fill | null {
  const pool = texts.filter(
    (t) => !looksLikeCompany(t.chip.text) && !COMPANY_MARK_RE.test(t.loose) && !isUrlLike(t.loose) && !(domain && hasDomainWord(t.loose, domain)),
  );
  const english = pool.filter((t) => enNameTokens(t.loose) !== null);
  const ko = pool
    .flatMap((t) => koNameCandidates(t.loose, t.chip.text).map((c) => ({ t, ...c })))
    .filter((c) => !all.some((other) => other.id !== c.t.chip.id && other.text.includes(c.name)));
  const koNames = new Set(ko.map((k) => k.name));
  if (koNames.size > 1) return null;
  if (koNames.size === 1) {
    const hit = ko.find((k) => k.fillable);
    if (!hit) return null;
    if (texts.some((t) => HANJA_NAME_RE.test(t.chip.text))) return null;
    const roman = KO_SURNAME_ROMAN[koSurnameOf(hit.name) ?? ""] ?? [];
    const samePerson = (b: TextChip) => (enNameTokens(b.loose) ?? []).some((token) => roman.includes(token.toLowerCase()));
    if (english.length > 0 && !english.some(samePerson)) return null;
    const want = (v: string) => (koNameCandidates(v).some((c) => c.name === hit.name && c.fillable) ? hit.name : null);
    const sure = confident(hit.t, NAME_FILL_CONF, want);
    if (sure) return sure;
    // 점수가 낮아도(NAME_FILL_CONF 아래) 그 이름의 로마자 표기가 이메일 @ 앞 · 영문 이름 줄과 맞으면 채워요(기획 17118-3, ko-roman.ts) —
    // 한글은 글자를 맞게 읽고도 점수가 낮게 나와요. 성씨와 이름의 모든 음절이 맞아야 해서, 틀리게 읽은 이름(「박서순」 ↔ seojun.park@)은 채워지지 않아요.
    // email 은 칸에 채운 주소뿐이에요 — 잘렸을 수 있어 비운 주소는 근거로 쓰지 않아요. 후보 조건(하나뿐 · 이름 모양 · 한자 · 영어 이름 줄)은 위 그대로.
    // 점수 하한은 두지 않았어요: 지어낸 한글 명함 그림 320장(8명 × 글꼴 8 × 크기 5)을 실제 도구로 읽혀 보니, 이 규칙으로 새로 채워진 이름 26건(모두 맞음)의
    // 이름 낱말 최저점은 54~92(직함까지 치면 20~89)였고 틀리게 읽은 이름 글자 11건(「윤서마」 「한지루」 「문재원」 …)은 85~93 이었어요 —
    // 점수로는 가를 수 없고(틀린 글자가 더 높아요), 틀린 글자를 거르는 것은 로마자 대조예요. 줄의 점수를 모르면(도구가 주지 않음) 전처럼 채우지 않아요.
    const surname = koSurnameOf(hit.name) ?? "";
    const given = hit.name.slice(surname.length);
    const surnames = surnameRomans(surname, roman);
    // 영문 이름 줄은 낱말 모양을 따로 가리지 않아요(「Moon Ji-hu」처럼 하이픈 뒤가 소문자인 줄은 enNameTokens 가 이름 줄로 보지 않아요) —
    // 성씨 낱말 + 이름의 모든 음절이 맞는 줄이면 그 사람의 영문 이름이에요
    const spelled = (t: TextChip) => wordsSpellKoName(t.loose.split(/[\s,]+/).filter(Boolean), surnames, given);
    const backed = emailSpellsKoName(email, surnames, given) || pool.some(spelled);
    return backed ? confident(hit.t, 0, want) : null;
  }
  const companyWords = new Set(company.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const backed = english.filter((t) => {
    const tokens = enNameTokens(t.loose) ?? [];
    return emailBacksName(tokens, email) && !tokens.every((token) => companyWords.has(token.toLowerCase()));
  });
  if (backed.length !== 1) return null;
  return confident(backed[0], NAME_FILL_CONF, (v) => {
    const tokens = enNameTokens(v);
    return tokens && emailBacksName(tokens, email) ? tokens.join(" ") : null;
  });
}

/**
 * 한글 명함인지(규칙 6 · 기획 17118-2 — 메일 언어를 「한국어」로). 명함을 읽은 그때 한 번 판단해요(직원이 칸에 한글을 쳐도 바꾸지 않아요 — 화면). 하나라도 맞으면:
 * - 칸에 채운 회사명 · 이름에 한글이 있음(「주식회사 가나다테크」 — 이름을 채우지 못했어도)
 * - 이메일이 .kr 로 끝남 — 칸에 채운 주소, 채우지 못했으면(잘렸을 수 있음 · 또렷하지 않음) 메일 칩에서 뽑은 주소
 * - 칸에 채운 연락처가 010 · +82 로 시작
 * - 또렷이 읽은(낱말 점수 CLEAR_CONF 이상) 글자 줄(메일 · 전화 줄 제외) 가운데 한글 줄(한글 두 글자 이상)이 둘 이상이고 절반 이상(전 규칙 —
 *   회사명 · 이름을 채우지 못한 한글 명함). 영문 명함에 한글 주소 한 줄이 있는 정도로는 한글 명함이 아니에요.
 * 전에는 「채운 이름이 한글」과 마지막 규칙뿐이라, 회사명을 한글로 채웠어도 이름 줄의 점수가 낮으면(이름을 못 채움 · 또렷한 한글 줄이 회사명 하나뿐)
 * English 로 남았어요(기획 17118-2 의 예).
 */
function isKoreanCard(texts: readonly TextChip[], values: ScanValues, chips: readonly Chip[]): boolean {
  if (/[가-힣]/.test(values.company) || /[가-힣]/.test(values.name)) return true;
  const emails = values.email ? [values.email] : chips.filter((c) => c.kind === "email").map((c) => extractEmail(c.value) || extractEmail(c.text));
  if (emails.some((e) => /\.kr$/i.test(e))) return true;
  if (/^010/.test(digitsOf(values.phone)) || /^\+82/.test(values.phone.replace(/[\s(]/g, ""))) return true;
  const sure = texts.filter((t) => t.line !== null && lineFloor(t.line) >= CLEAR_CONF);
  const ko = sure.filter((t) => (t.chip.text.match(/[가-힣]/g)?.length ?? 0) >= 2).length;
  return ko >= 2 && ko * 2 >= sure.length;
}

/**
 * 명함을 읽은 결과(기획 17106 · 반박 리뷰 3).
 * - found: 이메일 · 연락처 가운데 하나라도 찾아 칸에 채움 — 명함이 바로 놓인 것으로 보이면(upright) 전처럼 읽은 모양 그대로,
 *   아니면 「그 값을 이루는 낱말」을 또렷이 읽었을 때만(이메일 EMAIL_FOUND_CONF · 연락처 FOUND_CONF 이상 + 번호 모양).
 *   그 줄의 다른 낱말(라벨 · 아이콘을 읽은 「®」 「©」 · 줄 끝 잡음)과 줄 점수는 보지 않아요 — 아이콘이 있거나 조금 기울어진 명함이 못 읽은 명함이 되지 않게.
 *   거꾸로 찍힌 전화번호는 숫자로 읽혀 전화번호 모양이 되기도 해요(「010-1234-5678」 → 낱말 점수 26 의 「95-7601-010」) — 바로 놓인 명함인지 모르는데
 *   값 낱말 점수가 낮으면 찾은 것으로 치지 않아요.
 * - unsure: 찾은 것은 없지만 메일 모양 글자가 있고, 그 주소 낱말을 또렷이 읽었거나 명함이 바로 놓인 것으로 보임(upright).
 *   주소는 잘렸을 수 있어 비웠고 직원이 읽은 줄에서 골라요(「메일 주소를 확인하지 못했습니다. 읽은 줄에서 고르거나 직접 입력해 주세요.」).
 *   칩은 모두 보여 주고, 또렷이 읽지 못한 번호는 채우지 않아요. 회사명 · 이름은 확실하면 채워요.
 * - unreadable: 그 밖 — 「명함을 읽지 못했습니다」. 아무 칸도(메일 언어도) 채우지 않아요. 거꾸로 · 옆으로 찍힌 명함의 깨진 줄은 칩으로 보여 주지 않아요.
 *   다만 바로 놓인 명함(upright — 또렷이 읽은 글자 줄이 UPRIGHT_LINES 이상)인데 이메일 · 연락처 모양이 아예 없는 것이면 또렷이 읽은 줄의 칩은 남겨요
 *   (chips 에 그 칩만 — 직원이 눌러 넣을 수 있어요). 깨진 칩 13~30개를 감추려는 것이지 또렷한 줄까지 없애려는 것이 아니에요.
 * 점수를 모르면(도구가 줄 점수를 주지 않음) 전처럼 모양만 보고 칩도 모두 돌려줘요.
 */
export type ScanOutcome = "found" | "unsure" | "unreadable";

export type ScanResult = {
  /** 보여 줄 칩 — unreadable 이면 또렷이 읽은 줄의 칩만(바로 놓인 명함이 아니면 빔) */
  chips: Chip[];
  values: ScanValues;
  links: ScanLinks;
  outcome: ScanOutcome;
  /** 값 낱말을 또렷이 읽어 채운 이메일 · 연락처 수(0~2) */
  found: number;
  /** 한글 명함(규칙 6 · 기획 17118-2 — isKoreanCard). 못 읽은 명함(unreadable)은 늘 false */
  korean: boolean;
  /** 읽은 줄 점수의 평균(0~100, 점수를 모르면 0) — 돌려 읽은 방향을 견줄 때 써요(card-rotate.ts) */
  confidence: number;
  /** 바로 놓인 명함으로 보이는지 — 또렷이 읽은 글자 줄이 UPRIGHT_LINES 이상(이메일 · 연락처를 못 찾았어도 돌려 읽을 까닭이 없어요) */
  upright: boolean;
  /** 글자가 거의 읽히지 않은 사진(뒷면 · 빈 사진) — 돌려 읽어도 소용없어요 */
  sparse: boolean;
  /** 바로 놓인 명함인지 모르는데 이메일 없이 연락처만 찾음 — 거꾸로 읽힌 번호일 수 있어 다른 방향도 읽어 봐요(card-rotate.ts) */
  weak: boolean;
};

/**
 * 읽은 글자 → 칩 · 네 칸 값 · 연결 · 읽은 결과. 줄이 하나도 없으면 chips 가 비어요(읽지 못함).
 * ocr = 글자 읽기 도구가 준 줄 · 낱말 점수. 회사명 · 이름은 점수가 있을 때만 채워요(규칙 1 「글자 인식 점수가 높은 줄만」) — 없으면 이메일 · 연락처만.
 * opts.lonePhone = 「바로 놓인 명함인지 모르는데 연락처만 찾은」 읽기(weak)의 번호를 믿을지(기본 믿음) — 돌려 읽기가 정해 줘요(card-rotate.ts pickReading).
 */
export function scanCard(text: string, ocr?: readonly OcrLine[] | null, opts: { lonePhone?: boolean } = {}): ScanResult {
  const { chips, lines } = readCard(text, ocr);
  const filled = autoFill(chips);
  // 도구가 줄 점수를 주지 않았으면(null · 없음) 전처럼 모양만 봐요. 빈 목록은 「아무 줄도 읽히지 않은 방향」이에요 —
  // 점수를 모르는 것이 아니라 읽힌 것이 없는 것이라 바로 놓인 명함으로 치지 않아요(반박 리뷰 후속 2)
  const scored = ocr !== null && ocr !== undefined;
  const lineOf = (chipId: number | undefined) => lines[chips.findIndex((c) => c.id === chipId)] ?? null;
  const sure = (field: "email" | "phone", min: number) => {
    if (filled.links[field] === undefined) return false;
    return !scored || (valueConfidence(filled.values[field], lineOf(filled.links[field])) ?? 0) >= min;
  };
  // 또렷이 읽은 글자 줄 — 글자 · 숫자 셋 이상인 낱말이 있고(옆으로 찍힌 명함의 「는 E 5」 같은 한 글자 조각 줄은 빼요) 글자 낱말 점수가 모두 CLEAR_CONF 이상.
  // 한 줄이 여러 칩으로 나뉘어도 한 번만 세요
  const clear = (i: number) => {
    const line = lines[i];
    if (!scored) return true;
    if (line === null || lineFloor(line) < CLEAR_CONF) return false;
    return chips[i].text.split(" ").some((token) => (token.match(/[\p{L}\p{N}]/gu)?.length ?? 0) >= 3);
  };
  const upright = !scored || new Set(chips.map((_, i) => (clear(i) ? lines[i] : null)).filter(Boolean)).size >= UPRIGHT_LINES;
  // 바로 놓인 명함이면 읽은 주소 · 번호를 전처럼 찾은 것으로 쳐요 — 점수는 거꾸로 · 옆으로 찍힌 명함의 깨진 글자를 거르려는 것이고,
  // 바로 놓인 명함의 잘못 읽은 번호는 점수로 가려지지 않아요(표본에서 틀린 번호의 값 낱말 점수가 10~94 로 고르게 퍼져 있었어요).
  // 아이콘 옆 번호는 맞게 읽혀도 점수가 낮게 나오기도 해요(「+65 9123 4567」 41 · 41 · 95)
  const emailSure = sure("email", EMAIL_FOUND_CONF) || (upright && filled.links.email !== undefined);
  // 바로 놓인 명함인지 모르면 연락처는 번호 모양도 봐요 — 거꾸로 찍힌 번호는 숫자로 또렷이 읽히기도 해요(지어낸 영문 명함을 거꾸로 읽혀 보니
  // 「+65 6123 4567」이 낱말 점수 73 · 73 · 92 의 「957 6619 59」로 채워졌어요). 나라 번호(+) · 한국 · 싱가포르 번호 모양이 아닌 「나눠 쓴 숫자 묶음」은
  // 이메일도 찾았을 때만 찾은 것으로 쳐요
  const phone = filled.values.phone;
  const phoneShaped = phone.trim().startsWith("+") || BARE_PHONE_RE.test(digitsOf(phone));
  const phoneLoose = sure("phone", FOUND_CONF) && (!scored || phoneShaped || emailSure);
  // 바로 놓인 명함인지 모르는데 이메일 없이 연락처만 찾음(weak) — 숫자 0 · 1 · 6 · 8 · 9 위주의 번호는 거꾸로 읽혀도 번호 모양이 돼요
  // (실제 도구: 거꾸로 놓인 「+82 10 5555 0102」 줄이 낱말 점수 66 · 92 의 「8010 9999」로, 「T. 6689 0916」이 「9160 6899」로 읽혔어요, 반박 리뷰 후속 1).
  // 이런 읽기는 방향이 맞는지 알 수 없어, 돌려 읽기(card-rotate.ts)가 이 방향에서 멈추지 않고 남은 방향을 읽어요.
  // opts.lonePhone === false 면(더 나은 방향이 없고 이 읽기를 믿을 수 없다고 정해졌을 때) 찾은 것으로 치지 않아요 — 틀리게 채우느니 비워요
  const weak = scored && !upright && !emailSure && phoneLoose;
  const phoneSure = (upright && filled.links.phone !== undefined) || (phoneLoose && !(weak && opts.lonePhone === false));
  const found = (emailSure ? 1 : 0) + (phoneSure ? 1 : 0);
  // 메일 모양 글자를 또렷이 읽었는지 — 메일 칩은 주소 낱말, 형식이 깨진 메일 모양 줄(「lena@koh sg」)은 그 줄 글자 낱말
  const readEmailLike = (chip: Chip, i: number) => {
    if (!scored) return true;
    const line = lines[i];
    if (line === null) return false;
    const address = chip.kind === "email" ? extractEmail(chip.text) : "";
    return (address ? (valueConfidence(address, line) ?? 0) : lineFloor(line)) >= FOUND_CONF;
  };
  const emailLike = chips.some((c, i) => isEmailLikeChip(c) && (upright || readEmailLike(c, i)));
  const outcome: ScanOutcome = found > 0 ? "found" : emailLike ? "unsure" : "unreadable";
  const letters = (ocr ?? []).reduce((n, l) => n + (l.text.match(/[\p{L}\p{N}]/gu)?.length ?? 0), 0);
  const sparse = scored && letters < SPARSE_CHARS;
  const rated = (ocr ?? []).filter((l) => /[\p{L}\p{N}]/u.test(l.text));
  const confidence = rated.length > 0 ? rated.reduce((sum, l) => sum + l.confidence, 0) / rated.length : 0;
  if (outcome === "unreadable") {
    // 못 읽은 명함은 아무 칸도 채우지 않아요(점수 낮은 낱말에서 뽑은 번호 포함). 바로 놓인 명함이면 또렷이 읽은 줄의 칩만 남겨요
    const kept = upright ? chips.filter((_, i) => clear(i)) : [];
    return { chips: kept, values: { company: "", name: "", email: "", phone: "" }, links: {}, outcome, found, korean: false, confidence, upright, sparse, weak };
  }
  const { values, links } = filled;
  if (outcome === "unsure") {
    // 또렷이 읽지 못한 주소 · 번호는 채우지 않아요(칩은 남아요 — 직원이 명함과 견줘 눌러 넣어요)
    values.email = values.phone = "";
    delete links.email;
    delete links.phone;
  }
  const texts: TextChip[] = [];
  chips.forEach((chip, i) => {
    if (chip.kind === "other") texts.push({ chip, line: lines[i], loose: looseStrip(chip.text).value });
  });
  const domain = values.email ? emailDomainName(values.email) : null;
  const put = (field: "company" | "name", fill: Fill | null) => {
    if (!fill) return;
    values[field] = fill.value;
    links[field] = fill.chip.id;
  };
  put("company", certainCompany(texts, domain));
  put("name", certainName(texts, chips, domain, values.email, values.company));
  return { chips, values, links, outcome, found, korean: isKoreanCard(texts, values, chips), confidence, upright, sparse, weak };
}

/**
 * 메일 모양 글자가 있는 칩인지(UG-451 기획 17030) — 메일 칩이거나, @ 양옆에 로마자 · 숫자가 붙은 글자(「lena@koh sg」 — 형식이 깨져 메일 칩이 되지 못함).
 * 이런 칩이 있으면 명함을 읽은 것으로 보고 「명함을 읽지 못했습니다」 대신 「메일 주소를 확인하지 못했습니다」를 띄워요.
 */
export const isEmailLikeChip = (chip: Chip) => chip.kind === "email" || /[\p{L}\p{N}]@[\p{L}\p{N}]/u.test(chip.text);

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

/** 칸 차례 — 창의 칸 순서(회사명 → 이름 → 이메일 → 연락처) */
const FIELD_ORDER: readonly ScanField[] = ["company", "name", "email", "phone"];

/**
 * 다음 칩이 들어갈 칸(UG-453 기획 5) — 칩을 넣은 뒤 커서(대상 칸)를 어디로 옮길지.
 * 전에는 커서가 있던 칸에 그대로 남아, 이름 칩을 넣은 뒤 회사명 칩을 누르면 이름 칸이 바뀌었어요.
 * - tap = 방금 바뀐 칸 · 값(tapChip 의 set). null 이면 아직 넣은 것이 없음(명함을 막 읽음) — 차례대로 첫 빈 칸
 * - 칸을 비웠으면(「칸에 들어감」 칩을 다시 누름) 그 칸 — 다른 칩으로 바꿔 넣기 쉽게
 * - 메일 · 전화 칩이 제 칸에 들어갔고 커서 칸(previous)이 아직 비어 있으면 커서 칸 그대로
 * - 그 밖에는 넣은 칸 다음부터 차례대로(끝에서 처음으로) 비어 있고 잠기지 않은 칸, 다 찼으면 null.
 *   연락처는 고르지 않아요 — 선택 칸이고 전화 칩은 늘 제 칸으로 가요. 고르면 다음 글자 칩이 연락처에 들어가요(UG-453 리뷰 m1).
 *   이메일은 골라요 — 메일처럼 생겼지만 깨진 칩(「lena@koh sg」)은 글자 칩으로 이메일 칸에 넣어요
 * values = 칩을 넣은 뒤의 칸 값, locked = 지금 고칠 수 없는 칸
 */
export function nextChipTarget(
  tap: { field: ScanField; value: string } | null,
  previous: ScanField | null,
  values: ScanValues,
  locked: readonly ScanField[] = [],
): ScanField | null {
  const open = (f: ScanField) => !locked.includes(f) && !values[f].trim();
  if (tap && !tap.value.trim()) return locked.includes(tap.field) ? null : tap.field;
  if (tap && previous && previous !== tap.field && open(previous)) return previous;
  const start = tap ? FIELD_ORDER.indexOf(tap.field) + 1 : 0;
  for (let k = 0; k < FIELD_ORDER.length; k++) {
    const f = FIELD_ORDER[(start + k) % FIELD_ORDER.length];
    if (f !== "phone" && open(f)) return f;
  }
  return null;
}

/** 직원이 칸을 직접 고치면 그 칸의 칩은 「아직 안 씀」으로(칩 규칙 6). 고친 글자는 그대로 둬요. */
export function unlink(links: ScanLinks, field: ScanField): ScanLinks {
  if (links[field] === undefined) return links;
  const next = { ...links };
  delete next[field];
  return next;
}

/**
 * 명함 글자 읽기에서 서로 헷갈리기 쉬운 글자(0 · O, 1 · l · I). 소문자 o · i 는 빼요 — 모양이 달라 헷갈리지 않고,
 * 거의 모든 주소에 있어 강조가 늘 떠요(기획 16846).
 */
const CONFUSABLE_RE = /[0O1lI]/;

export function hasConfusable(text: string): boolean {
  return CONFUSABLE_RE.test(text);
}

/**
 * 이메일 @ 앞(로컬 부분)에 헷갈리는 글자가 있고, 로컬 부분에 숫자와 로마자가 섞였는지(UG-451 — 「yoon.jl0110」).
 * 숫자가 없는 이름 주소(rachel · daniel)의 l 은 0 · 1 과 헷갈릴 일이 적어 띄우지 않아요.
 * 도메인은 보지 않아요 — 이메일 전체를 따로 「명함과 같은지」 안내해요.
 */
export function emailHasConfusable(email: string): boolean {
  const at = email.lastIndexOf("@");
  const local = at === -1 ? email : email.slice(0, at);
  return hasConfusable(local) && /\d/.test(local) && /[A-Za-z]/.test(local);
}

/** 강조해 보여 줄 조각 — 로컬 부분(@ 앞)의 헷갈리는 글자만 한 글자씩 따로(confusable = true) */
export function confusableParts(text: string): { text: string; confusable: boolean }[] {
  const parts: { text: string; confusable: boolean }[] = [];
  const at = text.lastIndexOf("@");
  let i = 0;
  for (const ch of text) {
    const confusable = (at === -1 || i < at) && CONFUSABLE_RE.test(ch);
    i += ch.length;
    const last = parts[parts.length - 1];
    if (!confusable && last && !last.confusable) last.text += ch;
    else parts.push({ text: ch, confusable });
  }
  return parts;
}

/**
 * 이메일 칸의 헷갈리는 글자 안내(강조할 조각) — read = 그 값을 넣은 메일 칩이 읽은 그대로의 주소(소문자로 바꾸기 전, 없으면 null).
 * 명함에서 넣은 주소는 소문자로 넣어요(chipValueFor, UG-451 기획 17030 — 대문자 I 는 그대로 두지만(17072-4) O 와 전부 대문자인 주소의 I 는
 * 바뀌어요). 그러면 읽은 「kimO1」의 O · 「JI0110」의 I 가 o · i 로 바뀌어 헷갈리는 글자에서 빠져요(반박 리뷰 M1) — 칸 값이 칩에서 넣은 그대로(대소문자만 다름)면 읽은 글자로 판단하고,
 * 강조 위치도 읽은 글자 기준이에요. 보여 주는 글자는 칸 값(보낼 주소) 그대로. 직원이 친 값(read 없음 · 다름)은 칸 값으로 봐요.
 */
export function confusableNote(value: string, read: string | null = null): { confusable: boolean; parts: { text: string; confusable: boolean }[] } {
  const src = read !== null && read.length === value.length && read.toLowerCase() === value.toLowerCase() ? read : value;
  if (!emailHasConfusable(src)) return { confusable: false, parts: [{ text: value, confusable: false }] };
  let i = 0;
  const parts = confusableParts(src).map((p) => {
    const text = value.slice(i, i + p.text.length);
    i += p.text.length;
    return { text, confusable: p.confusable };
  });
  return { confusable: true, parts };
}
