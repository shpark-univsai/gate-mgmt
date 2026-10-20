"use client";

import { Bell, ChevronDown } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { label: "대시보드", href: "/" },
  { label: "고객관리", href: "/customers" },
  { label: "프로젝트 관리", href: "/projects" },
  { label: "Q&A", href: "/qna" },
  { label: "설정", href: "/settings" },
];

export default function Navbar() {
  const pathname = usePathname();

  return (
    <nav
      style={{
        height: "48px",
        backgroundColor: "white",
        borderBottom: "1px solid #E2E8F0",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          maxWidth: "1800px",
          margin: "0 auto",
          height: "100%",
          display: "flex",
          alignItems: "center",
          padding: "0 24px",
          gap: "32px",
        }}
      >
      {/* Logo */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
        <span style={{ fontWeight: 700, fontSize: "14px", color: "#0E162A", letterSpacing: "0.02em" }}>
          UNIVS GATE
        </span>
        <span
          style={{
            fontSize: "11px",
            fontWeight: 600,
            padding: "2px 8px",
            borderRadius: "16px",
            backgroundColor: "#3B82F6",
            color: "white",
          }}
        >
          BACKOFFICE
        </span>
      </div>

      {/* Nav links */}
      <div style={{ display: "flex", alignItems: "center", gap: "4px", flex: 1 }}>
        {navItems.map((item) => {
          const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                position: "relative",
                padding: "4px 14px",
                fontSize: "13px",
                fontWeight: isActive ? 600 : 400,
                color: isActive ? "#0E162A" : "#64748B",
                textDecoration: "none",
              }}
            >
              {item.label}
            </Link>
          );
        })}
      </div>

      {/* Right side */}
      <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
        <button style={{ position: "relative", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
          <Bell size={18} color="#64748B" />
          <span
            style={{
              position: "absolute",
              top: "-4px",
              right: "-4px",
              width: "16px",
              height: "16px",
              fontSize: "11px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "16px",
              backgroundColor: "#EF4444",
              color: "white",
            }}
          >
            4
          </span>
        </button>

        <button
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 0,
          }}
        >
          <div
            style={{
              width: "28px",
              height: "28px",
              borderRadius: "16px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "#0E162A",
              color: "white",
              fontSize: "11px",
              fontWeight: 700,
            }}
          >
            관
          </div>
          <div style={{ textAlign: "left" }}>
            <div style={{ fontSize: "12px", fontWeight: 600, color: "#1D293B", lineHeight: 1.3 }}>관리자</div>
            <div style={{ fontSize: "10px", color: "#94A3B8" }}>Admin</div>
          </div>
          <ChevronDown size={14} color="#94A3B8" />
        </button>
      </div>
      </div>
    </nav>
  );
}
