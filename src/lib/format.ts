// 목록 화면들(계정 발급 · 계정 해지)이 같이 쓰는 표시 규칙. 시각은 한국 시각으로 보여 줘요.

export function kstParts(iso: string) {
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const p = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
  return { y: p("year"), m: p("month"), d: p("day"), h: p("hour"), min: p("minute") };
}

export const fmtFull = (iso: string) => {
  const t = kstParts(iso);
  return `${t.y}.${t.m}.${t.d} ${t.h}:${t.min}`;
};

export const fmtShort = (iso: string) => {
  const t = kstParts(iso);
  return `${t.m}.${t.d} ${t.h}:${t.min}`;
};

/** 날짜만(yyyy.MM.dd) */
export const fmtDate = (iso: string) => {
  const t = kstParts(iso);
  return `${t.y}.${t.m}.${t.d}`;
};

/** 오늘(한국 날짜) yyyy-MM-dd — 날짜 칸 값 */
export function kstToday(now: Date = new Date()): string {
  const t = kstParts(now.toISOString());
  return `${t.y}-${t.m}-${t.d}`;
}

/** 직원은 이름 대신 회사 이메일로 구분해요. 목록 · 안내에는 @ 앞부분만. */
export const handle = (email: string) => email.split("@")[0];

/** 페이지 번호: 7개가 넘으면 처음 · 끝 · 지금 앞뒤만 보이고 사이는 「…」 */
export function pageItems(current: number, count: number): (number | "gap")[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
  const keep = new Set([1, count, current - 1, current, current + 1]);
  if (current <= 4) [2, 3, 4, 5].forEach((n) => keep.add(n));
  if (current >= count - 3) [count - 4, count - 3, count - 2, count - 1].forEach((n) => keep.add(n));
  const nums = [...keep].filter((n) => n >= 1 && n <= count).sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  nums.forEach((n, i) => {
    if (i > 0 && n - nums[i - 1] > 1) out.push("gap");
    out.push(n);
  });
  return out;
}
