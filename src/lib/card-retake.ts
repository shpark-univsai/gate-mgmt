// 「명함 다시 찍기」에서 직원이 넣은 값을 어떻게 할지(UG-451 기획 17118-1) — 화면 · 브라우저에 기대지 않는 순수 함수만 둬요.
// 다시 찍어도 직원이 입력 · 고친 값 · 칩으로 넣은 값은 그대로 두는 것이 전 규칙이에요(기획 16991 · 17100 규칙 5 — 같은 명함을 다시 찍는 흔한 경우).
// 하지만 다시 찍은 명함이 다른 사람 것이면 앞 사람의 이름이 남아, 새 사람에게 앞 사람 이름으로 메일이 나가요(기획 17118 — 전시 전 꼭).
// 그래서 다시 찍은 명함의 이메일을 앞 명함의 이메일과 견줘 같은 사람인지 보고(retakeVerdict), 다른 사람이면 직원이 넣은 값도 비워요(retakePlan).
import { isEmailLikeChip, nameFromLine, type Chip, type ScanField, type ScanValues } from "./card-scan.ts";

/** same = 같은 명함(같은 사람), different = 다른 사람, unknown = 알 수 없음(새 사진을 읽지 못함 · 앞 명함의 이메일을 모름) */
export type RetakeVerdict = "same" | "different" | "unknown";

const EMAIL_SHAPE_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FIELDS: readonly ScanField[] = ["company", "name", "email", "phone"];

/** 주소를 견줄 글자로 — 앞뒤 공백을 떼고 소문자로(대소문자만 다른 것은 같은 주소) */
const addressKey = (email: string) => email.trim().toLowerCase();
/** 읽은 그대로의 메일 글자를 견줄 글자로 — 로마자 · 숫자 · @ 만(「haneul · jung@x.co.kr」 = 「haneul.jung@x.co.kr」, 「tan@x.com · sg」 = 「tan@x.com.sg」) */
const squash = (text: string) => text.toLowerCase().replace(/[^a-z0-9@]/g, "");

/**
 * 명함 칩의 메일 모양 글자들(견줄 글자로) — 메일 칩은 칩 값(잘렸을 수 있는 칩은 떨어진 앞 덩어리 · 꼬리까지 읽은 그대로),
 * 형식이 깨져 메일 칩이 되지 못한 줄(「lena@koh sg」)은 읽은 글자.
 * 잘렸을 수 있는 칩에서 뽑은 꼬리 주소(「haneul · jung@x.co.kr」 → jung@x.co.kr)는 쓰지 않아요 — 성씨가 같은 동료(minjae.jung@)의 주소와 같아져요.
 */
function chipMailKeys(chips: readonly Chip[]): string[] {
  const out = new Set<string>();
  for (const c of chips) {
    if (!isEmailLikeChip(c)) continue;
    const key = squash(c.kind === "email" ? c.value : c.text);
    if (key.includes("@")) out.add(key);
  }
  return [...out];
}

/** 두 글자의 편집 거리(글자 넣기 · 빼기 · 바꾸기 수) — max 를 넘으면 max + 1 에서 멈춰요 */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (Math.min(...next) > max) return max + 1;
    row = next;
  }
  return row[b.length];
}

/**
 * 칸의 주소가 앞 명함에서 읽은 주소를 고친 것으로 볼 만큼 가까운지(반박 리뷰 4) — 주소 전체(소문자)의 편집 거리 FIX_DISTANCE 이하.
 * 글자 읽기의 오독은 한두 글자예요(0 ↔ o · 1 ↔ l · rn ↔ m · 빠진 점). 직원이 오독을 고친 주소는 이 안에 들고,
 * 다른 사람 주소(이름이 다름)는 대개 이보다 멀어요. 남는 위험: 한두 글자만 다른 두 사람의 주소(kim1@ · kim2@)는 가까운 것으로 봐요.
 */
const FIX_DISTANCE = 2;
const nearAddress = (field: string, read: string) => editDistance(field, read, FIX_DISTANCE) <= FIX_DISTANCE;

/**
 * 끝 도메인만 한 글자 잘못 읽힌 같은 주소인지(UG-451 기획 17132 반박 리뷰 M1) — 「kim@x.ai」 ↔ 「kim@x.qi」 · 「kim@x.com」 ↔ 「kim@x.cor」.
 * 실재하지 않는 끝 도메인은 채우지 않아 앞 · 새 명함 한쪽만 또렷하게 읽히면 글자가 달라 다른 사람이 돼요.
 * @ 앞(로마자 · 숫자만)이 같고, 도메인(로마자 · 숫자만)이 끝 3글자 안쪽에서만 달라지며 그 차이가 한 글자(편집 거리 1)일 때만 —
 * 「info@ab.kr」 ↔ 「info@cd.kr」 · 「kim@x.kr」 ↔ 「kim@x.sg」(두 글자)는 같은 주소로 보지 않아요. 같은 끝 도메인이면 이미 같은 글자예요.
 */
function tldSlip(a: string, b: string): boolean {
  const at = (s: string) => s.lastIndexOf("@");
  if (at(a) < 1 || at(b) < 1 || squash(a.slice(0, at(a))) !== squash(b.slice(0, at(b)))) return false;
  const da = squash(a.slice(at(a) + 1));
  const db = squash(b.slice(at(b) + 1));
  if (da === db) return false;
  let p = 0;
  while (p < da.length && p < db.length && da[p] === db[p]) p++;
  const ta = da.slice(p);
  const tb = db.slice(p);
  return p > 0 && ta.length <= 3 && tb.length <= 3 && editDistance(ta, tb, 1) <= 1;
}
const sameMail = (a: string, b: string) => a === b || tldSlip(a, b);

/**
 * 다시 찍은 명함이 앞 명함과 같은 사람 것인지 — 이메일로만 판단해요.
 * prev.read = 앞 명함에서 읽어 채웠던 이메일(직원이 그 뒤 칸을 고쳤어도 명함에서 읽은 값, 없으면 ""), prev.field = 지금 이메일 칸 값,
 * prev.chips = 앞 명함의 칩. next.email = 다시 찍은 명함에서 읽어 채울 이메일(잘렸을 수 있어 비웠거나 못 읽었으면 ""), next.chips = 그 명함의 칩,
 * next.readable = 새 사진에서 읽은 줄(칩)이 있는지 — 「못 읽은 명함」(빈 사진 · 거꾸로 찍혀 깨진 줄뿐)이면 false.
 * 앞 명함의 주소 = 읽은 주소와, 칸의 주소가 그것을 고친 것으로 볼 만큼 가까우면(nearAddress) 칸의 주소도. 읽은 주소가 없으면(이어서 만들기 ·
 * 앞 명함에서 주소를 못 읽음) 칸의 주소. 칸의 주소를 읽은 주소와 상관없이 쓰면 직원이 칸을 먼저 새 사람 주소로 바꾸고 찍었을 때 같은 사람이 돼요(반박 리뷰 4).
 * - 새 사진을 읽지 못함(readable = false): unknown — 같은 명함을 다시 찍은 것일 수 있어요.
 * - 두 명함 모두 또렷한 주소가 있음: 새 주소가 앞 명함의 주소 가운데 하나와 같으면(대소문자 없이) same, 아니면 different.
 * - 한쪽이 또렷한 주소 없이 메일 모양 글자(잘렸을 수 있는 칩 · 형식이 깨진 줄)만 있음: 읽은 그대로의 글자를 로마자 · 숫자 · @ 만 남겨 견줘요.
 *   하나라도 같으면 same(「haneul · jung@x.co.kr」 ↔ haneul.jung@x.co.kr), 하나도 같지 않으면 different.
 *   같은 명함을 다시 찍었는데 글자가 다르게 읽혀 different 가 될 수 있어요 — 그때도 새 명함에 그대로 적힌 값은 남겨요(retakePlan).
 * - 새 명함에 메일 모양 글자가 하나도 없음: 앞 명함에서 주소를 읽었거나(prev.read) 앞 명함에 메일 모양 글자가 있었으면(채우지 않은 의심 주소 —
 *   기획 17132 반박 리뷰 M1) different(반박 리뷰 1 — 같은 명함이면 메일 줄이 다시 읽히는 것이 보통이에요), 아니면 unknown.
 * - 주소를 견줄 때 끝 도메인만 한 글자 잘못 읽힌 것(tldSlip — 「kim@x.ai」 ↔ 「kim@x.qi」)은 같은 주소로 봐요(반박 리뷰 M1).
 * - 앞 명함의 메일 모양 글자를 모름(이어서 만들기에서 칸이 비었음 · 메일 없는 명함): unknown.
 */
export function retakeVerdict(
  prev: { read: string; field: string; chips: readonly Chip[] },
  next: { email: string; chips: readonly Chip[]; readable?: boolean },
): RetakeVerdict {
  if (next.readable === false) return "unknown";
  const read = addressKey(prev.read);
  const field = EMAIL_SHAPE_RE.test(prev.field.trim()) ? addressKey(prev.field) : "";
  const prevClean = read ? [read, ...(field && field !== read && nearAddress(field, read) ? [field] : [])] : field ? [field] : [];
  const nextClean = addressKey(next.email);
  if (nextClean && prevClean.length > 0) return prevClean.some((p) => sameMail(p, nextClean)) ? "same" : "different";
  const nextKeys = nextClean ? [squash(nextClean)] : chipMailKeys(next.chips);
  // 앞 명함에 메일 모양 글자가 있었으면(채우지 않은 의심 주소 — 「kim@x.qi」 · 잘린 주소 포함) 주소를 읽은 것과 같아요(기획 17132 반박 리뷰 M1)
  if (nextKeys.length === 0) return read || chipMailKeys(prev.chips).length > 0 ? "different" : "unknown";
  const prevKeys = prevClean.length > 0 ? prevClean.map(squash) : chipMailKeys(prev.chips);
  if (prevKeys.length === 0) return "unknown";
  return nextKeys.some((key) => prevKeys.some((p) => sameMail(p, key))) ? "same" : "different";
}

/** 글자 값(회사명 · 이름)을 견줄 글자로 — 공백을 빼고 소문자로(「정 하 늘」 = 「정하늘」) */
const textKey = (text: string) => text.replace(/\s+/g, "").toLowerCase();
const digitsOf = (text: string) => text.replace(/\D/g, "");

/**
 * 직원이 넣은 칸 값이 다시 찍은 명함의 읽은 줄(칩)에 그대로 적혀 있는지 — 그 값은 이 명함의 것이라 남겨도 돼요.
 * - 이름: 이름 줄로 보이는 칩(nameFromLine — 직함을 뗀 이름)과 통째로 같음(공백 · 대소문자 없이, 직원 값에 붙은 직함도 떼고). 줄 안의 일부와 같은 것은 아니에요
 *   (반박 리뷰 3 — 상호 「정하늘 꽃집」 · 주소 「하늘빌딩」 · 「Tanjong」 안에 앞 사람 이름이 들어 있어도 남기지 않아요)
 * - 회사명: 어느 글자 칩과 줄 통째로 같음(공백 · 대소문자 없이)
 * - 이메일: 어느 메일 모양 칩과 같은 주소(로마자 · 숫자 · @ 만 견줘요)
 * - 연락처: 숫자 8자리 이상이고 어느 전화 칩의 숫자 안에 그대로 들어 있음
 */
export function isOnCard(field: ScanField, value: string, chips: readonly Chip[]): boolean {
  if (field === "email") {
    const key = squash(value);
    return key.includes("@") && chipMailKeys(chips).includes(key);
  }
  if (field === "phone") {
    const digits = digitsOf(value);
    return digits.length >= 8 && chips.some((c) => c.kind === "phone" && digitsOf(c.text).includes(digits));
  }
  const texts = chips.filter((c) => c.kind === "other");
  if (field === "name") {
    const key = textKey(nameFromLine(value) ?? value);
    return key !== "" && texts.some((c) => textKey(nameFromLine(c.text) ?? "") === key);
  }
  const key = textKey(value);
  return key !== "" && texts.some((c) => textKey(c.text) === key);
}

/** release = 비우고 새 명함 값으로 채울 칸(직원이 넣은 값이지만 앞 사람 것), stale = 남겼지만 새 명함에서 찾지 못해 직원이 확인해야 하는 칸 */
export type RetakePlan = { verdict: RetakeVerdict; release: ScanField[]; stale: ScanField[] };

/**
 * 다시 찍은 명함에서 직원이 넣은 값(staff — 칸 → 값, 빈 칸 · 앞 명함이 자동으로 채운 그대로인 칸은 넣지 않아요)을 어떻게 할지.
 * - same: 모두 그대로(전 규칙).
 * - different: 새 명함에 그대로 적혀 있지 않은 값은 비워요(release) — 회사명 · 이름뿐 아니라 이메일 · 연락처도(앞 사람 주소 · 번호가 남지 않게).
 *   새 명함에 그대로 적힌 값은 그 명함의 것이라 남겨요(같은 명함인데 주소가 다르게 읽힌 경우 · 같은 회사 동료의 회사명).
 * - unknown: 모두 그대로 두되, 새 명함에서 찾지 못한 값(못 읽은 명함이면 모든 값)은 stale 로 알려요 — 화면이 「이 명함과 맞는지 확인해 주세요」를 띄워요.
 *   같은 명함을 다시 찍은 것일 수 있어(처음에 메일을 못 읽어 다시 찍음) 지우지 않아요.
 * chips = 다시 찍은 명함의 칩(못 읽었으면 빈 목록).
 */
export function retakePlan(verdict: RetakeVerdict, staff: Partial<ScanValues>, chips: readonly Chip[]): RetakePlan {
  const plan: RetakePlan = { verdict, release: [], stale: [] };
  if (verdict === "same") return plan;
  for (const field of FIELDS) {
    const value = staff[field]?.trim();
    if (!value || isOnCard(field, value, chips)) continue;
    (verdict === "different" ? plan.release : plan.stale).push(field);
  }
  return plan;
}

/** 다시 찍은 뒤 띄울 안내 — released = 다른 사람이라 직원이 넣은 값을 지움, stale = 알 수 없어 남긴 값. values = 그 칸들의 이번 읽기 직후 값 */
export type RetakeNote = { kind: "released" | "stale"; values: Partial<ScanValues> };

/** plan → 안내(알릴 칸이 없으면 null). after = 이번 읽기를 칸에 반영한 뒤의 네 칸 값 */
export function retakeNote(plan: RetakePlan, after: ScanValues): RetakeNote | null {
  const fields = plan.release.length > 0 ? plan.release : plan.stale;
  if (fields.length === 0) return null;
  const values: Partial<ScanValues> = {};
  for (const field of fields) values[field] = after[field];
  return { kind: plan.release.length > 0 ? "released" : "stale", values };
}

/**
 * 안내 문구 — 그 뒤로 직원이 손대지 않은(값이 그대로인) 칸만 이름을 나열해요. 모두 손댔으면 null(안내를 내려요).
 * labels = 칸 이름(창의 칸 이름과 같게), current = 지금 네 칸 값.
 */
export function retakeNoteText(note: RetakeNote | null, current: ScanValues, labels: Record<ScanField, string>): string | null {
  if (!note) return null;
  const names = FIELDS.filter((f) => note.values[f] !== undefined && note.values[f] === current[f]).map((f) => labels[f]);
  if (names.length === 0) return null;
  const list = names.join(" · ");
  return note.kind === "released"
    ? `앞 명함과 다른 사람의 명함으로 보여 직접 입력한 값(${list})을 지웠습니다. 이 명함에서 읽은 값을 확인해 주세요.`
    : `직접 입력한 값(${list})은 그대로 두었습니다. 이 명함과 맞는지 확인해 주세요.`;
}
