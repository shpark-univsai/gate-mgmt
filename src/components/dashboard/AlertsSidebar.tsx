import { alerts } from "@/lib/mockData";

const BORDER = "1px solid #E2E8F0";
const NEUTRAL_BADGE = { bg: "#F8FAFC", text: "#1E293B" };

const badgeStyle: Record<string, { bg: string; text: string }> = {
  "#3B82F6": NEUTRAL_BADGE,
  "#F59E0B": NEUTRAL_BADGE,
  "#64748A": NEUTRAL_BADGE,
  "#EF4444": { bg: "#EE4444", text: "#FFFFFF" },
};

export default function AlertsSidebar() {
  return (
    <div>
      {alerts.map((alert) => {
        const badge = badgeStyle[alert.typeColor] ?? NEUTRAL_BADGE;
        return (
          <div
            key={alert.id}
            style={{
              padding: "12px 16px",
              borderBottom: BORDER,
              backgroundColor: alert.urgent ? "#FDF2F2" : "transparent",
              cursor: "pointer",
            }}
          >
            <div style={{ display: "flex", gap: "7px" }}>
              {/* 배지 */}
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  padding: "2px 6px",
                  borderRadius: "16px",
                  backgroundColor: badge.bg,
                  color: badge.text,
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                  alignSelf: "flex-start",
                }}
              >
                {alert.type}
              </span>

              {/* 회사명 / 메시지 (좌) + 날짜 (우) */}
              <div style={{ flex: 1, minWidth: 0, display: "flex", gap: "8px" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ marginBottom: "3px" }}>
                    <span style={{ fontSize: "12px", fontWeight: 600, color: "#1D293B" }}>
                      {alert.company}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: "11px",
                      color: alert.urgent ? "#EE4444" : "#64748B",
                      lineHeight: 1.55,
                    }}
                  >
                    {alert.message}
                  </div>
                </div>
                <span style={{ fontSize: "11px", color: "#64748B", flexShrink: 0, whiteSpace: "nowrap", paddingTop: "2px" }}>
                  {alert.time}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
