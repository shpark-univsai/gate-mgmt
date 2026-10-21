"use client";

import { useEffect, useRef } from "react";
import { IcCheck } from "./icons";

/** inverse = 어두운 바탕(로그인)용: 흰색 로고 + 반전 배지 */
export function Brand({ inverse = false }: { inverse?: boolean }) {
  return (
    <div className={`brand${inverse ? " brand--inverse" : ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={inverse ? "/logo-white.svg" : "/logo.svg"} alt="UNIVS GATE" width={134} height={20} />
      <span className="badge t-button-200">BACKOFFICE</span>
    </div>
  );
}

/**
 * 확인 · 입력 창. 닫기 ✕는 두지 않아요 — 「취소」, Esc, 창 바깥 누르기로 닫혀요.
 * 열리면 첫 입력 칸(없으면 실행 버튼)에 초점이 가요.
 */
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
    (el?.querySelector<HTMLElement>("input") ?? el?.querySelector<HTMLElement>(".dialog-actions button:last-child"))?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && closable) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, closable]);

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && closable && onClose()}>
      <div ref={ref} className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <h2 id="dialog-title" className="dialog-title">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

/** 완료 알림 — 어두운 유리(반투명 + 흐림). 4초 뒤 사라져요. */
export function Toast({ title, detail, onDone }: { title: string; detail: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 4000);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div className="toast" role="status" aria-live="polite">
      <IcCheck size={18} className="toast-icon" />
      <div>
        <p className="toast-title">{title}</p>
        <p className="toast-detail">{detail}</p>
      </div>
    </div>
  );
}
