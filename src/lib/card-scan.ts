// 명함 읽기(UG-431) — 읽은 글자를 줄(칩)로 나누고, 네 칸(회사명 · 이름 · 고객 이메일 · 연락처)에 넣는 규칙.
// 화면 · 브라우저에 기대지 않는 순수 함수만 둬요(글자 읽기 자체는 card-ocr.ts). 칩 규칙 번호는 Figma 「칩 동작 규칙 (N3b)」.
// 처음 채우기는 모양이 정해진 이메일 · 연락처만 — 회사명 · 이름은 잘못 읽는 일이 많아(한글 이름 「Sau TH」 등, 기획 16846) 직원이 칩을 눌러 넣어요.

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
type Segment = { text: string; suspect: boolean; value?: string };

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
  const lines = text
    .split(/\r?\n/)
    .map((raw) => raw.slice(0, MAX_LINE).replace(/＠/g, "@").replace(/\s*@\s*/g, "@").replace(/\s+/g, " ").trim())
    .filter(Boolean);
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
          if (!headCut && tailed === null) return void out.push({ text: seg, suspect });
          if (headCut && lead) {
            // 앞 덩어리 + 이 조각(값에서는 조각 앞 메일 라벨을 빼요)
            const rest = tailed?.text ?? seg;
            out.push({ text: lead.text + rest, suspect: true, value: lead.value + rest.replace(LEADING_EMAIL_LABEL_RE, "") });
          } else out.push({ text: tailed?.text ?? seg, suspect: true, value: tailed?.value ?? seg });
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
 *   소문자 라벨이 붙은 모양(GLUED_LOWER_LABEL_TLD_RE — 「…comtel」)
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
  const typo = TLD_TYPOS.has(tld.toLowerCase()) || GLUED_CC_TLD_RE.test(tld) || GLUED_LOWER_LABEL_TLD_RE.test(tld);
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

/** 명함 칩의 메일 주소들(뽑은 주소, 겹치지 않게) — 잘렸을 수 있는 칩도 뽑은 꼬리 주소로(「daeun · jung@x.co.kr」 → jung@x.co.kr) */
export function chipEmailAddresses(chips: readonly Chip[]): string[] {
  const out = new Set<string>();
  for (const c of chips) {
    if (c.kind !== "email") continue;
    const e = extractEmail(c.value) || extractEmail(c.text);
    // 의심이 아닌 칩은 칸에 넣을 때처럼 소문자로(chipValueFor — 기획 17030) — 칸 주소와 같은 글자로 확인해요
    if (e) out.add(isSuspectChip(c) ? e : e.toLowerCase());
  }
  return [...out];
}

export function toChips(text: string): Chip[] {
  return readSegments(text)
    .slice(0, MAX_CHIPS)
    .map((seg, i) => {
      const chip: Chip = { id: i + 1, text: seg.text, ...classifyLine(seg.text) };
      if (chip.kind !== "email" || !seg.suspect) return chip;
      // 떨어진 앞 덩어리 · 꼬리까지 이은 칩은 값도 보이는 글자 그대로(UG-451 기획 17022 — 잘린 주소가 들어가지 않게)
      return { ...chip, suspect: true, ...(seg.value !== undefined ? { value: seg.value } : {}) };
    });
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
 * 메일 칩은 주소 전체를 소문자로(UG-451 기획 17030) — 처음 채우기(autoFill)와 칩 누르기(tapChip)가 모두 여기를 지나요.
 * 글자 읽기의 대소문자는 믿을 수 없고(「USER1+X@EXAMPLE.COM」) 메일 배달은 실제로 대소문자를 가르지 않아요.
 * 그런데 auth 는 이메일을 대소문자 그대로 저장 · 비교해서, 대문자로 읽힌 주소가 있는 계정 「user1+x@example.com」와 다른 계정으로 보여
 * 같은 고객의 계정이 하나 더 생길 수 있어요 — auth 쪽(대소문자 없이 저장 · 비교)이 근본 해결이에요. 직원이 손으로 친 값은 친 그대로 둬요.
 * 잘렸을 수 있는 칩(isSuspectChip)은 명함과 견줘 고치도록 읽은 그대로 둬요.
 */
export function chipValueFor(chip: Chip, field: ScanField): string {
  if (field === "email" && chip.kind === "email") return isSuspectChip(chip) ? chip.value : chip.value.toLowerCase();
  if (field === "phone" && chip.kind === "phone") return chip.value;
  if (field === "name") return nameFromLine(chip.text) ?? chip.text;
  return chip.text;
}

/**
 * 처음 채우기(동작 규칙 3 · 칩 규칙 1 · 7): 모양이 정해진 메일(@ 모양) · 연락처(숫자 묶음 — 휴대전화 → 전화 라벨 → 라벨 없음, UG-451)만 채워요.
 * 회사명 · 이름은 비워 두고 직원이 칩을 눌러 넣어요(기획 16846 — 잘못 읽은 이름 · 회사명이 칸에 들어가 그대로 보내지지 않게).
 * 못 찾은 칸도 비워요(동작 규칙 4).
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

/** 읽은 글자 → 칩 · 네 칸 값 · 연결. 줄이 하나도 없으면 chips 가 비어요(읽지 못함). */
export function scanCard(text: string): { chips: Chip[]; values: ScanValues; links: ScanLinks } {
  const chips = toChips(text);
  return { chips, ...autoFill(chips) };
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
