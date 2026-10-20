import { newProjects } from "@/lib/mockData";

const BORDER = "1px solid #E2E8F0";

export default function NewProjectsList() {
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>

      {/* 섹션 타이틀 — TopCustomersTable 타이틀과 동일 높이 */}
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
          신규 개설 프로젝트
        </h3>
      </div>

      {/* 컬럼 헤더 — TopCustomersTable 컬럼 헤더와 동일 높이 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 24px",
          height: "38px",
          borderBottom: BORDER,
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: "11px", color: "#64748B", fontWeight: 500 }}>프로젝트명</span>
        <span style={{ fontSize: "11px", color: "#64748B", fontWeight: 500 }}>개설일</span>
      </div>

      {/* 데이터 행 — 5등분 그리드로 TopCustomersTable 행과 높이 동기화 */}
      <div style={{ flex: 1, display: "grid", gridTemplateRows: "repeat(5, 1fr)" }}>
        {newProjects.map((p, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0 24px",
              borderBottom: BORDER,
              cursor: "pointer",
            }}
          >
            <span style={{ fontSize: "13px", fontWeight: 500, color: "#1D293B" }}>
              {p.name}
            </span>
            <span
              style={{
                fontSize: "12px",
                color: "#475469",
                whiteSpace: "nowrap",
                marginLeft: "16px",
              }}
            >
              {p.createdAt}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
