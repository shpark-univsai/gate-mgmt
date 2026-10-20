"use client";

import { useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { apiCallTrendData } from "@/lib/mockData";

const tabs = ["얼굴/손바닥", "얼굴 인증", "손바닥 인증"];

export default function ApiCallTrendChart() {
  const [activeTab, setActiveTab] = useState("얼굴/손바닥");

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 24px",
          borderBottom: "1px solid #E2E8F0",
        }}
      >
        <h3 style={{ fontSize: "14px", fontWeight: 600, color: "#1D293B", margin: 0 }}>
          API 호출 추이
        </h3>
        <div className="flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="px-3 py-1 rounded text-xs font-medium transition-colors"
              style={{
                backgroundColor: activeTab === tab ? "#1D293B" : "transparent",
                color: activeTab === tab ? "white" : "#64748A",
                border: activeTab === tab ? "none" : "1px solid #E2E8F0",
              }}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: "20px 24px 24px" }}>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={apiCallTrendData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: "#94A3B8" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "#94A3B8" }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "white",
              border: "1px solid #E2E8F0",
              borderRadius: "16px",
              fontSize: "12px",
            }}
          />
          {(activeTab === "얼굴/손바닥" || activeTab === "얼굴 인증") && (
            <Line
              type="monotone"
              dataKey="face"
              name="얼굴 인증"
              stroke="#1D293B"
              strokeWidth={2}
              dot={{ fill: "white", stroke: "#1D293B", strokeWidth: 2, r: 4 }}
              activeDot={{ r: 5 }}
            />
          )}
          {(activeTab === "얼굴/손바닥" || activeTab === "손바닥 인증") && (
            <Line
              type="monotone"
              dataKey="palm"
              name="손바닥 인증"
              stroke="#94A3B8"
              strokeWidth={2}
              strokeDasharray="5 5"
              dot={{ fill: "white", stroke: "#94A3B8", strokeWidth: 2, r: 4 }}
              activeDot={{ r: 5 }}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
      </div>
    </div>
  );
}
