"use client";

import { useState } from "react";
import {
  ComposedChart, Area, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  apiCallTrendData, faceHourlyByDate, palmHourlyByDate,
  apiCallTrend30, faceHourlyBy30, palmHourlyBy30,
  apiCallTrend90, faceDailyByWeek, palmDailyByWeek,
} from "@/lib/mockData";

const BORDER = "1px solid #E2E8F0";

const DATES_7  = apiCallTrendData.map((d) => d.date);
const DATES_30 = apiCallTrend30.map((d) => d.date);
const WEEKS_90 = apiCallTrend90.map((d) => d.week);

const DEFAULT_DATE   = DATES_7[DATES_7.length - 1];
const DEFAULT_DATE30 = DATES_30[DATES_30.length - 1];
const DEFAULT_WEEK   = WEEKS_90[WEEKS_90.length - 1];

const FACE_LAYERS = [
  { key: "등록",      color: "#0E172A" },
  { key: "1:N매칭",   color: "#1E40AF" },
  { key: "1:1인증",   color: "#0369A1" },
  { key: "1:1사진",   color: "#0891B2" },
  { key: "라이브니스", color: "#94A3B8" },
];
const PALM_LAYERS = [
  { key: "등록",      color: "#0E172A" },
  { key: "1:N매칭",   color: "#1E40AF" },
  { key: "라이브니스", color: "#94A3B8" },
];

function makeDot(selected: string, xKey: string, onSelect: (d: string) => void, stroke: string) {
  return function CustomDot(props: { cx?: number; cy?: number; payload?: Record<string, string> }) {
    const { cx, cy, payload } = props;
    if (!cx || !cy || !payload || payload[xKey] !== selected) return <circle r={0} />;
    return (
      <circle
        cx={cx} cy={cy} r={4}
        fill={stroke} stroke={stroke} strokeWidth={1.5}
        style={{ cursor: "pointer" }}
        onClick={() => onSelect(payload[xKey])}
      />
    );
  };
}

function makeActiveDot(xKey: string, onSelect: (d: string) => void, stroke: string) {
  return function ActiveDot(props: { cx?: number; cy?: number; payload?: Record<string, string> }) {
    const { cx, cy, payload } = props;
    if (!cx || !cy) return null;
    return (
      <circle
        cx={cx} cy={cy} r={3}
        fill="white" stroke={stroke} strokeWidth={1.5}
        style={{ cursor: "pointer" }}
        onClick={() => payload && onSelect(payload[xKey])}
      />
    );
  };
}

function AreaPanel({
  title, layers, data,
}: {
  title: string;
  layers: typeof FACE_LAYERS;
  data: Record<string, number | string>[];
  type: string;
  xAxisKey?: string;
}) {
  const totals = layers.map((l) => ({
    ...l,
    total: data.reduce((sum: number, row) => sum + (Number(row[l.key]) || 0), 0),
  }));
  const grandTotal = totals.reduce((s: number, t) => s + t.total, 0);

  return (
    <div style={{ padding: "0 24px 24px", height: "100%", display: "flex", flexDirection: "column", boxSizing: "border-box" }}>
      {/* 타이틀 + 총 건수 */}
      <p style={{ fontSize: "12px", fontWeight: 600, color: "#64748B", margin: "0 0 12px", flexShrink: 0 }}>
        {title}
      </p>
      <div style={{ marginBottom: "24px", flexShrink: 0 }}>
        <span style={{ fontSize: "26px", fontWeight: 700, color: "#1D293B", letterSpacing: "-0.5px" }}>
          {grandTotal.toLocaleString()}
        </span>
        <span style={{ fontSize: "12px", color: "#64748B", marginLeft: "4px" }}>건</span>
      </div>

      {/* 프로그레스 바 목록 */}
      <div style={{ display: "flex", flexDirection: "column", gap: "16px", flex: 1 }}>
        {totals.map((t) => {
          const pct = grandTotal > 0 ? (t.total / grandTotal) * 100 : 0;
          return (
            <div key={t.key}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{
                    width: "8px", height: "8px", borderRadius: "50%",
                    backgroundColor: t.color, flexShrink: 0,
                  }} />
                  <span style={{ fontSize: "11px", color: "#324055" }}>{t.key}</span>
                </div>
                <span style={{ fontSize: "11px", color: "#64748B", whiteSpace: "nowrap" }}>
                  {t.total.toLocaleString()}건 ({pct.toFixed(1)}%)
                </span>
              </div>
              <div style={{ height: "6px", backgroundColor: "#F1F5F9", borderRadius: "16px", overflow: "hidden" }}>
                <div style={{
                  height: "100%",
                  width: `${pct}%`,
                  backgroundColor: t.color,
                  borderRadius: "16px",
                }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function ApiSection({ period = "최근 7일" }: { period?: string }) {
  const [selectedDate,   setSelectedDate]   = useState(DEFAULT_DATE);
  const [selectedDate30, setSelectedDate30] = useState(DEFAULT_DATE30);
  const [selectedWeek,   setSelectedWeek]   = useState(DEFAULT_WEEK);

  const isToday = period === "오늘";
  const is7     = period === "최근 7일";
  const is30    = period === "최근 30일";
  const is90    = period === "최근 3개월";

  // ── 좌측 차트 데이터 ──────────────────────────────────────────────────
  let leftChartData: { face: number; palm: number; [key: string]: number | string }[];
  let leftXKey: string;

  if (isToday) {
    const fd = faceHourlyByDate[DEFAULT_DATE] ?? [];
    const pd = palmHourlyByDate[DEFAULT_DATE] ?? [];
    leftChartData = fd.map((f, i) => ({
      time: f.time as string,
      face: FACE_LAYERS.reduce((s, l) => s + (Number((f as Record<string, unknown>)[l.key]) || 0), 0),
      palm: PALM_LAYERS.reduce((s, l) => s + (Number((pd[i] as Record<string, unknown>)?.[l.key]) || 0), 0),
    }));
    leftXKey = "time";
  } else if (is7) {
    leftChartData = apiCallTrendData as typeof leftChartData;
    leftXKey = "date";
  } else if (is30) {
    leftChartData = apiCallTrend30 as typeof leftChartData;
    leftXKey = "date";
  } else {
    leftChartData = apiCallTrend90 as typeof leftChartData;
    leftXKey = "week";
  }

  // ── 우측 패널 데이터 (선택된 날짜/주의 시간대별·요일별 상세) ────────────
  let faceData: Record<string, number | string>[];
  let palmData: Record<string, number | string>[];
  let panelLabel: string;
  let panelXAxisKey: string;

  if (isToday) {
    faceData     = (faceHourlyByDate[DEFAULT_DATE] ?? []) as typeof faceData;
    palmData     = (palmHourlyByDate[DEFAULT_DATE] ?? []) as typeof palmData;
    panelLabel   = "오늘";
    panelXAxisKey = "time";
  } else if (is7) {
    faceData     = (faceHourlyByDate[selectedDate] ?? faceHourlyByDate[DEFAULT_DATE]) as typeof faceData;
    palmData     = (palmHourlyByDate[selectedDate] ?? palmHourlyByDate[DEFAULT_DATE]) as typeof palmData;
    panelLabel   = selectedDate;
    panelXAxisKey = "time";
  } else if (is30) {
    faceData     = (faceHourlyBy30[selectedDate30] ?? faceHourlyBy30[DEFAULT_DATE30]) as typeof faceData;
    palmData     = (palmHourlyBy30[selectedDate30] ?? palmHourlyBy30[DEFAULT_DATE30]) as typeof palmData;
    panelLabel   = selectedDate30;
    panelXAxisKey = "time";
  } else {
    faceData     = (faceDailyByWeek[selectedWeek] ?? faceDailyByWeek[DEFAULT_WEEK]) as typeof faceData;
    palmData     = (palmDailyByWeek[selectedWeek] ?? palmDailyByWeek[DEFAULT_WEEK]) as typeof palmData;
    panelLabel   = selectedWeek;
    panelXAxisKey = "day";
  }

  // 현재 period의 선택값
  const selectedKey = is7 ? selectedDate : is30 ? selectedDate30 : selectedWeek;
  const setSelected = is7 ? setSelectedDate : is30 ? setSelectedDate30 : setSelectedWeek;

  // ── 힌트 메시지 ───────────────────────────────────────────────────────
  const hintText = isToday
    ? "오늘 시간대별 API 호출 현황입니다"
    : is90
    ? "주차를 선택하면 요일별 상세를 확인할 수 있습니다"
    : "날짜를 클릭하면 시간대별 상세를 확인할 수 있습니다";

  // ── 탭 목록 (오늘 / 30일은 탭 없음) ─────────────────────────────────
  const showTabs   = is7 || is90;
  const tabLabels  = is7 ? DATES_7 : WEEKS_90;

  // 30일: XAxis interval (every 5th)
  const xAxisInterval = is30 ? 4 : 0;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* 섹션 헤더 */}
      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 24px", borderBottom: BORDER, gap: "16px" }}>
        <h3 style={{ fontSize: "14px", fontWeight: 600, color: "#1D293B", margin: 0, flexShrink: 0 }}>
          API 호출 추이
        </h3>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {/* 힌트 */}
          <p style={{ fontSize: "11px", color: "#64748B", margin: 0, whiteSpace: "nowrap" }}>
            {hintText}
          </p>

          {/* 7일: 날짜 탭 / 3개월: 주차 탭 */}
          {showTabs && (
            <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", justifyContent: "flex-end" }}>
              {tabLabels.map((label) => (
                <button
                  key={label}
                  onClick={() => setSelected(label)}
                  style={{
                    padding: "2px 7px",
                    fontSize: "11px",
                    borderRadius: "16px",
                    border: BORDER,
                    cursor: "pointer",
                    backgroundColor: selectedKey === label ? "#0E162A" : "white",
                    color: selectedKey === label ? "white" : "#475469",
                    fontWeight: selectedKey === label ? 600 : 400,
                    whiteSpace: "nowrap",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {/* 30일: 선택 날짜 인디케이터 */}
          {is30 && (
            <span style={{ fontSize: "11px", color: "#64748B", flexShrink: 0 }}>
              선택: <strong style={{ color: "#1D293B" }}>{selectedDate30}</strong>
            </span>
          )}
        </div>
      </div>

      {/* 컨텐츠 그리드 */}
      <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "2fr 1fr 1fr" }}>

        {/* 좌: 추이 차트 */}
        <div style={{ height: "100%", borderRight: BORDER, padding: "20px 24px 24px", display: "flex", flexDirection: "column", boxSizing: "border-box" }}>

          {/* 차트 */}
          <div style={{ flex: 1, minHeight: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={leftChartData} margin={{ top: 15, right: 20, left: 0, bottom: 5 }}>
                <defs>
                  <linearGradient id="palmAreaGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor="#94A3B8" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="#94A3B8" stopOpacity={0.01} />
                  </linearGradient>
                </defs>

                <XAxis
                  dataKey={leftXKey}
                  interval={xAxisInterval}
                  tick={isToday
                    ? { fontSize: 11, fill: "#64748B" }
                    : ({ x, y, payload }: { x: number | string; y: number | string; payload: { value: string } }) => {
                        const isSel = !isToday && payload.value === selectedKey;
                        return (
                          <text
                            x={Number(x)} y={Number(y) + 12}
                            textAnchor="middle"
                            fontSize={11}
                            fontWeight={isSel ? 700 : 400}
                            fill={isSel ? "#0E162A" : "#64748B"}
                            style={{ cursor: isToday ? "default" : "pointer" }}
                            onClick={() => !isToday && setSelected(payload.value)}
                          >
                            {payload.value}
                          </text>
                        );
                      }
                  }
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "#64748B" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) =>
                    v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`
                  }
                  width={36}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: "white", border: BORDER, borderRadius: "16px", fontSize: "11px" }}
                  formatter={(v: unknown, name: unknown) => [`${Number(v).toLocaleString()}건`, name === "face" ? "얼굴" : "손바닥"]}
                />

                <Area
                  type="monotone"
                  dataKey="palm"
                  stroke="#94A3B8"
                  strokeWidth={1.5}
                  strokeDasharray="6 4"
                  fill="url(#palmAreaGrad)"
                  dot={isToday ? false : makeDot(selectedKey, leftXKey, setSelected, "#94A3B8") as never}
                  activeDot={isToday ? undefined : makeActiveDot(leftXKey, setSelected, "#94A3B8") as never}
                />

                <Line
                  type="monotone"
                  dataKey="face"
                  stroke="#1D293B"
                  strokeWidth={2}
                  dot={isToday ? false : makeDot(selectedKey, leftXKey, setSelected, "#1D293B") as never}
                  activeDot={isToday ? undefined : makeActiveDot(leftXKey, setSelected, "#1D293B") as never}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 중: 얼굴 */}
        <div style={{ height: "100%", borderRight: BORDER, paddingTop: "20px", boxSizing: "border-box" }}>
          <AreaPanel
            title={`얼굴 · ${panelLabel}`}
            layers={FACE_LAYERS}
            data={faceData}
            type="face"
            xAxisKey={panelXAxisKey}
          />
        </div>

        {/* 우: 손바닥 */}
        <div style={{ height: "100%", paddingTop: "20px", boxSizing: "border-box" }}>
          <AreaPanel
            title={`손바닥 · ${panelLabel}`}
            layers={PALM_LAYERS}
            data={palmData}
            type="palm"
            xAxisKey={panelXAxisKey}
          />
        </div>
      </div>
    </div>
  );
}
