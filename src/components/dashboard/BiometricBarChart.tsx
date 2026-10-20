"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { faceHourlyData, palmHourlyData } from "@/lib/mockData";

const FACE_LAYERS = [
  { key: "등록",    color: "#0E162A" },
  { key: "1:N매칭", color: "#324055" },
  { key: "1:1인증", color: "#475469" },
  { key: "1:1사진", color: "#64748B" },
  { key: "라이브니스", color: "#94A3B8" },
];

const PALM_LAYERS = [
  { key: "등록",    color: "#0E162A" },
  { key: "1:N매칭", color: "#475469" },
  { key: "라이브니스", color: "#94A3B8" },
];

const faceStats = [
  { label: "등록",    value: "2,000건(20.0%)" },
  { label: "1:N 매칭", value: "1,000건(10.0%)" },
  { label: "1:1인증", value: "2,500건(25.0%)" },
  { label: "1:1사진", value: "2,500건(25.0%)" },
  { label: "라이브니스", value: "2,000건(20.0%)" },
];

const palmStats = [
  { label: "등록",    value: "1,000건(20.0%)" },
  { label: "1:N 매칭", value: "500건(10.0%)" },
  { label: "라이브니스", value: "3,500건(70.0%)" },
];

interface BiometricBarChartProps {
  type: "face" | "palm";
}

export default function BiometricBarChart({ type }: BiometricBarChartProps) {
  const isFace = type === "face";
  const data = isFace ? faceHourlyData : palmHourlyData;
  const layers = isFace ? FACE_LAYERS : PALM_LAYERS;
  const stats = isFace ? faceStats : palmStats;

  return (
    <div style={{ padding: "24px", display: "flex", flexDirection: "column" }}>
      <h3 style={{ fontSize: "14px", fontWeight: 600, color: "#1D293B", margin: "0 0 20px 0" }}>
        {isFace ? "얼굴" : "손바닥"}
      </h3>

      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <defs>
            {layers.map((l) => (
              <linearGradient key={l.key} id={`grad-${type}-${l.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={l.color} stopOpacity={0.85} />
                <stop offset="95%" stopColor={l.color} stopOpacity={0.55} />
              </linearGradient>
            ))}
          </defs>

          <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
          <XAxis
            dataKey="time"
            tick={{ fontSize: 10, fill: "#94A3B8" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 10, fill: "#94A3B8" }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "white",
              border: "1px solid #E2E8F0",
              borderRadius: "16px",
              fontSize: "11px",
            }}
            formatter={(v: unknown, name: unknown) => [`${Number(v).toLocaleString()}건`, String(name)]}
          />

          {layers.map((l) => (
            <Area
              key={l.key}
              type="monotone"
              dataKey={l.key}
              stackId="a"
              stroke={l.color}
              strokeWidth={1}
              fill={`url(#grad-${type}-${l.key})`}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div style={{ marginTop: "16px", display: "flex", flexDirection: "column", gap: "6px" }}>
        {stats.map((s, i) => (
          <div key={s.label} style={{ display: "flex", alignItems: "center", fontSize: "11px" }}>
            <span
              style={{
                display: "inline-block",
                width: "14px",
                height: "3px",
                borderRadius: "16px",
                backgroundColor: layers[i].color,
                marginRight: "6px",
                flexShrink: 0,
              }}
            />
            <span style={{ flex: 1, color: "#324055" }}>{s.label}</span>
            <span style={{ color: "#64748B", whiteSpace: "nowrap" }}>{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
