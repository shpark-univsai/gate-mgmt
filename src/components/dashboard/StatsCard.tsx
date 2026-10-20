
interface StatItem {
  label: string;
  value: string | number;
}

interface StatsCardProps {
  title: string;
  mainValue: string | number;
  trend?: {
    value: string;
    direction: "up" | "down";
  };
  items: StatItem[];
}

export default function StatsCard({ title, mainValue, trend, items }: StatsCardProps) {
  return (
    <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "12px" }}>
      <p style={{ fontSize: "14px", color: "#64748B", margin: 0 }}>
        {title}
      </p>
      <div className="flex items-end gap-2">
        <span className="font-bold" style={{ fontSize: "36px", color: "#0E162A", lineHeight: "1" }}>
          {typeof mainValue === "number" ? mainValue.toLocaleString() : mainValue}
        </span>
        {trend && (
          <span
            className="flex items-center gap-0.5 font-medium mb-0.5"
            style={{ fontSize: "13px", color: trend.direction === "up" ? "#10B981" : "#EF4444" }}
          >
            {trend.value}
          </span>
        )}
      </div>
      <div className="pt-2" style={{ borderTop: "1px solid #E2E8F0" }}>
        {items.map((item) => (
          <div key={item.label} className="flex justify-between py-1">
            <span style={{ color: "#64748B", fontSize: "12px" }}>{item.label}</span>
            <span className="font-medium" style={{ fontSize: "12px", color: "#324055" }}>
              {typeof item.value === "number" ? item.value.toLocaleString() : item.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
