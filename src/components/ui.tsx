"use client";

import { useEffect, useRef } from "react";

export function Brand() {
  return (
    <div className="brand">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.svg" alt="UNIVS GATE" width={134} height={20} />
      <span className="badge t-button-200">BACKOFFICE</span>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 21 22" fill="none" aria-hidden="true">
      <path d="M0.53 0.53L20.53 20.53M20.53 0.53L0.53 20.53" stroke="var(--gray-500)" strokeWidth="1.5" />
    </svg>
  );
}

/** 확인 · 완료 창. Esc와 바깥 클릭으로 닫히고, 열리면 첫 버튼에 초점이 가요. */
export function Dialog({
  title,
  onClose,
  closable = true,
  children,
}: {
  title: string;
  onClose: () => void;
  closable?: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    el?.querySelector<HTMLElement>(".dialog-actions button:last-child")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && closable) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, closable]);

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && closable && onClose()}>
      <div ref={ref} className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <h2 className="dialog-head t-heading-300">
          <span id="dialog-title">{title}</span>
          <button type="button" className="dialog-close" onClick={onClose} disabled={!closable} aria-label="닫기">
            <CloseIcon />
          </button>
        </h2>
        {children}
      </div>
    </div>
  );
}
