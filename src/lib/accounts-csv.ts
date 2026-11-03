// 발급 목록 CSV(UG-431 「CSV 내려받기」). 서버는 줄만 주고(GET /accounts/export) 파일은 브라우저가 만들어요.
// 엑셀이 한글을 깨뜨리지 않게 UTF-8 BOM, 줄 끝은 CRLF, 칸은 RFC 4180 따옴표 규칙.
// 고객이 적은 값(회사명 · 이름 등)이 엑셀에서 수식으로 실행되지 않게 = + - @ 탭 · CR 로 시작하면 앞에 ' 를 붙여요(CSV 수식 주입 방지).
import type { AccountStatus, ExportRow, MailLanguage } from "./api";

export const CSV_HEADERS = [
  "회사명",
  "이름",
  "이메일",
  "연락처",
  "메일 언어",
  "상태",
  "첫 로그인 동의",
  "영업 연락 동의",
  "만든 사람",
  "만든 일시",
] as const;

/** 한 칸. 수식으로 읽힐 첫 글자는 ' 로 막고, 쉼표 · 따옴표 · 줄바꿈이 있으면 따옴표로 감싸요(안의 " 는 "" 로). */
export function csvCell(value: string | null | undefined): string {
  let v = value ?? "";
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function kst(iso: string | Date) {
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(typeof iso === "string" ? new Date(iso) : iso);
  const p = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
  return { y: p("year"), m: p("month"), d: p("day"), h: p("hour"), min: p("minute") };
}

/** 만든 일시 — 한국 시각 YYYY-MM-DD HH:mm */
export function kstDateTime(iso: string): string {
  const t = kst(iso);
  return `${t.y}-${t.m}-${t.d} ${t.h}:${t.min}`;
}

/** 파일 이름 — gate-accounts-YYYYMMDD-HHmm.csv (한국 시각) */
export function exportFileName(now: Date): string {
  const t = kst(now);
  return `gate-accounts-${t.y}${t.m}${t.d}-${t.h}${t.min}.csv`;
}

export type CsvLabels = { language: (l: MailLanguage) => string; status: (s: AccountStatus) => string };

/** 줄 → CSV 글자(BOM 포함). 언어 · 상태는 목록과 같은 이름으로, 동의는 Y · N(모르면 빈 칸), 만든 사람은 이메일 전체. */
export function buildAccountsCsv(rows: readonly ExportRow[], labels: CsvLabels): string {
  const lines = [
    CSV_HEADERS.join(","),
    ...rows.map((r) =>
      [
        r.company,
        r.name,
        r.email,
        r.phone,
        labels.language(r.language),
        labels.status(r.status),
        r.firstLoginConsent,
        r.marketingConsent,
        r.createdBy,
        kstDateTime(r.createdAt),
      ]
        .map(csvCell)
        .join(","),
    ),
  ];
  return `﻿${lines.join("\r\n")}\r\n`;
}
