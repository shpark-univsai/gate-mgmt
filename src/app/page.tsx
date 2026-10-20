"use client";

import { useState } from "react";
import Navbar from "@/components/layout/Navbar";
import StatsCard from "@/components/dashboard/StatsCard";
import ApiSection from "@/components/dashboard/ApiSection";
import TopCustomersTable from "@/components/dashboard/TopCustomersTable";
import NewProjectsList from "@/components/dashboard/NewProjectsList";
import ActiveProjectChart from "@/components/dashboard/ActiveProjectChart";
import AlertsSidebar from "@/components/dashboard/AlertsSidebar";
import ActivityFeedPanel from "@/components/dashboard/ActivityFeedPanel";
import PeriodSelector from "@/components/dashboard/PeriodSelector";
import { alerts } from "@/lib/mockData";

const BORDER = "1px solid #E2E8F0";
const SIDEBAR_W = "320px";

const statsCards = [
  {
    title: "통합 호출 건수",
    mainValue: 10000,
    trend: { value: "▲800(8.7%)", direction: "up" as const },
    items: [
      { label: "얼굴 인증", value: 7000 },
      { label: "손바닥 인증", value: 3000 },
    ],
  },
  {
    title: "프로젝트 이용 비율",
    mainValue: "40.0%",
    trend: { value: "▼1.0(2.4%)", direction: "down" as const },
    items: [
      { label: "활성 프로젝트 수", value: 20 },
      { label: "비활성 프로젝트 수", value: 30 },
    ],
  },
  {
    title: "만료 프로젝트 수",
    mainValue: 300,
    trend: { value: "▼100(25.0%)", direction: "down" as const },
    items: [
      { label: "이력 있는 프로젝트 수", value: 100 },
      { label: "이력 없는 프로젝트 수", value: 200 },
    ],
  },
  {
    title: "신규 가입 수",
    mainValue: 10,
    trend: { value: "▲3(42.9%)", direction: "up" as const },
    items: [
      { label: "누적 총 고객 수", value: 50 },
      { label: "기업 도메인 가입 수", value: 20 },
    ],
  },
];

export default function DashboardPage() {
  const [period, setPeriod] = useState("최근 7일");

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh", backgroundColor: "white" }}>
      <Navbar />

      {/* ── 브레드크럼 + 사이드바 헤더 (1fr / SIDEBAR_W 동일 비율) ── */}
      <div style={{ flexShrink: 0 }}>
        <div
          style={{
            width: "100%",
            maxWidth: "1800px",
            margin: "0 auto",
            display: "grid",
            gridTemplateColumns: `1fr ${SIDEBAR_W}`,
            borderBottom: BORDER,
            borderLeft: BORDER,
            borderRight: BORDER,
          }}
        >
          {/* 왼쪽: 브레드크럼 + 최근 7일 */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 24px",
              borderRight: BORDER,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#64748B" }}>
              <span style={{ fontWeight: 600, color: "#1D293B" }}>UNIVS ADMIN</span>
              <span>›</span>
              <span>통합 실시간 모니터링 대시보드</span>
            </div>
            <PeriodSelector value={period} onChange={setPeriod} />
          </div>

          {/* 오른쪽: 주요 조치 필요 사항 헤더 */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 16px",
            }}
          >
            <h3 style={{ fontSize: "14px", fontWeight: 600, color: "#1D293B", margin: 0 }}>
              주요 조치 필요 사항
            </h3>
            <span
              style={{
                fontSize: "11px",
                fontWeight: 600,
                padding: "2px 9px",
                borderRadius: "16px",
                border: BORDER,
                color: "#475469",
              }}
            >
              {alerts.length}건 대기
            </span>
          </div>
        </div>
      </div>

      {/* ── 메인 컨텐츠 ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <div
          style={{
            width: "100%",
            maxWidth: "1800px",
            margin: "0 auto",
            flex: 1,
            height: "100%",
            display: "grid",
            gridTemplateColumns: `1fr ${SIDEBAR_W}`,
            gridTemplateRows: `minmax(140px, auto) minmax(400px, 1fr) minmax(320px, 320px)`,
            border: BORDER,
            borderTop: "none",
          }}
        >
          {/* Row 1, Col 1: KPI 4분할 */}
          <div
            style={{
              gridRow: 1,
              gridColumn: 1,
              borderRight: BORDER,
              borderBottom: BORDER,
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr 1fr",
            }}
          >
            {statsCards.map((card, i) => (
              <div key={card.title} style={{ borderRight: i < 3 ? BORDER : "none" }}>
                <StatsCard {...card} />
              </div>
            ))}
          </div>

          {/* Row 1-2, Col 2: 주요 조치 필요 사항 목록 */}
          <div
            style={{
              gridRow: "1 / 3",
              gridColumn: 2,
              borderBottom: BORDER,
              overflow: "hidden",
            }}
          >
            <AlertsSidebar />
          </div>

          {/* Row 2, Col 1: API 호출 추이 */}
          <div
            style={{
              gridRow: 2,
              gridColumn: 1,
              borderRight: BORDER,
              borderBottom: BORDER,
            }}
          >
            <ApiSection period={period} />
          </div>

          {/* Row 3, Col 1: 하단 3분할 차트 */}
          <div
            style={{
              gridRow: 3,
              gridColumn: 1,
              borderRight: BORDER,
              display: "flex",
              minHeight: 0,
            }}
          >
            <div style={{ flex: 1, borderRight: BORDER, minWidth: 0, overflow: "hidden" }}>
              <TopCustomersTable />
            </div>
            <div style={{ flex: 1, borderRight: BORDER, minWidth: 0, overflow: "hidden" }}>
              <NewProjectsList />
            </div>
            <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
              <ActiveProjectChart />
            </div>
          </div>

          {/* Row 3, Col 2: 실시간 관리자 활동 피드 */}
          <div
            style={{
              gridRow: 3,
              gridColumn: 2,
              overflow: "hidden",
            }}
          >
            <ActivityFeedPanel />
          </div>
        </div>
      </div>
    </div>
  );
}
