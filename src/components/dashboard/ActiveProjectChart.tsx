"use client";

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { activeProjectData } from "@/lib/mockData";

const BORDER = "1px solid #E2E8F0";
const AVG         = activeProjectData.reduce((s, d) => s + d.value, 0) / activeProjectData.length;
const COLOR_ABOVE = "#475469";
const COLOR_BELOW = "#CBD5E1";

export default function ActiveProjectChart() {
  const latest = activeProjectData[activeProjectData.length - 1];
  const diff   = latest.value - latest.prev;
  const isUp   = diff >= 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: "49px", padding: "0 24px", borderBottom: BORDER, flexShrink: 0 }}>
        <h3 style={{ fontSize: "14px", fontWeight: 600, color: "#1D293B", margin: 0 }}>
          활성 프로젝트 추이
        </h3>
        <span style={{ fontSize: "11px", fontWeight: 600, color: isUp ? "#16A34A" : "#DC2626" }}>
          {isUp ? "▲" : "▼"} {Math.abs(diff).toLocaleString()} 전주 대비
        </span>
      </div>

      <div style={{ flex: 1, padding: "16px 24px 20px", display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ flex: 1, minHeight: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={activeProjectData} margin={{ top: 5, right: 4, left: -22, bottom: 5 }} barCategoryGap="30%">
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#64748B" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#64748B" }} axisLine={false} tickLine={false}
                tickFormatter={(v) => v === 0 ? "0" : `${(v / 1000).toFixed(0)}k`} />
              <Tooltip
                contentStyle={{ backgroundColor: "white", border: BORDER, borderRadius: "16px", fontSize: "11px" }}
                formatter={(v: unknown) => [`${Number(v).toLocaleString()}건`, "활성 프로젝트"]}
              />
              <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                {activeProjectData.map((entry) => (
                  <Cell key={entry.date} fill={entry.value >= AVG ? COLOR_ABOVE : COLOR_BELOW} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div style={{ display: "flex", gap: "14px", marginTop: "8px", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <span style={{ width: "10px", height: "10px", borderRadius: "50%", backgroundColor: COLOR_ABOVE, display: "inline-block" }} />
            <span style={{ fontSize: "11px", color: "#64748B" }}>평균 이상</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <span style={{ width: "10px", height: "10px", borderRadius: "50%", backgroundColor: COLOR_BELOW, display: "inline-block" }} />
            <span style={{ fontSize: "11px", color: "#64748B" }}>평균 이하</span>
          </div>
        </div>
      </div>
    </div>
  );
}
