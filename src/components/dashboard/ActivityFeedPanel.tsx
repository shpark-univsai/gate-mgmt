import { activityFeed } from "@/lib/mockData";
import { ChevronRight } from "lucide-react";

const BORDER = "1px solid #E2E8F0";

export default function ActivityFeedPanel() {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>

      {/* 헤더 — 다른 섹션 타이틀과 동일 height: 49px */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          height: "49px",
          padding: "0 16px",
          borderBottom: BORDER,
          flexShrink: 0,
        }}
      >
        <h3 style={{ fontSize: "14px", fontWeight: 600, color: "#1D293B", margin: 0 }}>
          실시간 관리자 활동 피드
        </h3>
      </div>

      {/* 피드 아이템 */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {activityFeed.map((item, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              gap: "8px",
              padding: "10px 16px",
              borderBottom: BORDER,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "12px", color: "#1D293B", lineHeight: 1.55 }}>{item.content}</div>
              <div style={{ fontSize: "11px", color: "#64748B", marginTop: "2px" }}>{item.actor}</div>
            </div>
            <span
              style={{
                fontSize: "11px",
                color: "#64748B",
                flexShrink: 0,
                whiteSpace: "nowrap",
                paddingTop: "2px",
              }}
            >
              {item.time}
            </span>
          </div>
        ))}
      </div>

      {/* 전체보기 */}
      <button
        style={{
          display: "flex",
          alignItems: "center",
          gap: "4px",
          padding: "10px 16px",
          fontSize: "12px",
          color: "#1D293B",
          fontWeight: 500,
          background: "none",
          border: "none",
          borderBottom: BORDER,
          cursor: "pointer",
          width: "100%",
          flexShrink: 0,
        }}
      >
        전체보기 <ChevronRight size={12} />
      </button>
    </div>
  );
}
