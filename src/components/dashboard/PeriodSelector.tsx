"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

const BORDER = "1px solid #E2E8F0";
const OPTIONS = ["오늘", "최근 7일", "최근 30일", "최근 3개월"];

interface Props {
  value: string;
  onChange: (v: string) => void;
}

export default function PeriodSelector({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "4px",
          fontSize: "12px",
          padding: "5px 12px",
          border: BORDER,
          borderRadius: "16px",
          color: "#324055",
          backgroundColor: "white",
          cursor: "pointer",
        }}
      >
        {value}
        <ChevronDown size={12} />
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            right: 0,
            backgroundColor: "white",
            border: BORDER,
            borderRadius: "16px",
            overflow: "hidden",
            zIndex: 20,
            minWidth: "108px",
          }}
        >
          {OPTIONS.map((opt) => (
            <button
              key={opt}
              onClick={() => { onChange(opt); setOpen(false); }}
              style={{
                display: "block",
                width: "100%",
                padding: "7px 14px",
                fontSize: "12px",
                textAlign: "left",
                background: opt === value ? "#F8FAFC" : "white",
                fontWeight: opt === value ? 600 : 400,
                color: "#1D293B",
                border: "none",
                cursor: "pointer",
              }}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
