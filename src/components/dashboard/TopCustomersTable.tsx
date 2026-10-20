import { topCustomers } from "@/lib/mockData";

const BORDER = "1px solid #E2E8F0";
// 4컬럼 공통 너비 (NewProjectsList 컬럼 헤더 높이와 맞춤)
const COLS = "44px 1fr 112px 88px";

export default function TopCustomersTable() {
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>

      {/* 섹션 타이틀 — NewProjectsList 타이틀과 동일 높이 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 24px",
          height: "49px",
          borderBottom: BORDER,
          flexShrink: 0,
        }}
      >
        <h3 style={{ fontSize: "14px", fontWeight: 600, color: "#1D293B", margin: 0 }}>
          우량 고객 TOP 5
        </h3>
      </div>

      {/* 컬럼 헤더 — NewProjectsList 컬럼 헤더와 동일 높이 */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: COLS,
          alignItems: "center",
          height: "38px",
          borderBottom: BORDER,
          flexShrink: 0,
        }}
      >
        {(["순위", "회사명", "인증 방식", "호출 수"] as const).map((col, i) => (
          <span
            key={col}
            style={{
              paddingLeft: i === 0 ? "24px" : 0,
              paddingRight: i === 3 ? "24px" : 0,
              fontSize: "11px",
              fontWeight: 500,
              color: "#64748B",
              textAlign: i === 3 ? "right" : "left",
            }}
          >
            {col}
          </span>
        ))}
      </div>

      {/* 데이터 행 — 5등분 그리드로 NewProjectsList 행과 높이 동기화 */}
      <div style={{ display: "grid", gridTemplateRows: "repeat(5, 1fr)", flex: 1 }}>
        {topCustomers.map((c) => (
          <div
            key={c.rank}
            style={{
              display: "grid",
              gridTemplateColumns: COLS,
              alignItems: "center",
              borderBottom: BORDER,
            }}
          >
            {/* 순위 */}
            <span style={{ paddingLeft: "24px", fontSize: "12px", color: "#64748B" }}>
              {c.rank}
            </span>

            {/* 회사명 */}
            <span
              style={{
                fontSize: "13px",
                fontWeight: 500,
                color: "#1D293B",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                paddingRight: "8px",
              }}
            >
              {c.company || c.email}
            </span>

            {/* 인증 방식 */}
            <div style={{ display: "flex", gap: "4px" }}>
              {["손바닥", "얼굴"].map((type) => {
                const active = c.authTypes.includes(type);
                return (
                  <span
                    key={type}
                    style={{
                      padding: "3px 7px",
                      borderRadius: "16px",
                      fontSize: "11px",
                      fontWeight: 600,
                      backgroundColor: active ? "#1D293B" : "transparent",
                      color: active ? "white" : "#64748B",
                      border: active ? "none" : "1px solid #E2E8F0",
                    }}
                  >
                    {type}
                  </span>
                );
              })}
            </div>

            {/* 호출 수 */}
            <span
              style={{
                paddingRight: "24px",
                fontSize: "13px",
                fontWeight: 700,
                color: "#1D293B",
                textAlign: "right",
              }}
            >
              {c.calls.toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
