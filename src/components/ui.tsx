"use client";

import { useEffect, useRef, useState } from "react";
import { IcArrowDown, IcCheck } from "./icons";

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

/**
 * 선택 상자 — 브라우저 기본 메뉴 대신 프로필 메뉴와 같은 어두운 유리 팝업.
 * 키보드: ↑↓로 이동, Enter · Space로 고르기, Esc · Tab · 바깥 누르기로 닫기.
 */
export function PopupSelect<T extends string | number>({
  value,
  options,
  onChange,
  label,
  className,
  placement = "bottom",
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
  className?: string;
  placement?: "bottom" | "top";
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const current = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function openMenu() {
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  }
  function choose(i: number) {
    onChange(options[i].value);
    setOpen(false);
    buttonRef.current?.focus();
  }
  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "Tab") setOpen(false);
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(active);
    }
  }

  return (
    <div className={`popup-select${className ? " " + className : ""}`} ref={ref} onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        className="popup-select-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${current.label}`}
        onClick={() => (open ? setOpen(false) : openMenu())}
      >
        <span>{current.label}</span>
        <IcArrowDown size={16} className="popup-select-icon" />
      </button>
      {open && (
        <ul className={`popup-select-menu popup-select-menu--${placement}`} role="listbox" aria-label={label}>
          {options.map((o, i) => (
            <li
              key={String(o.value)}
              role="option"
              aria-selected={o.value === value}
              className={`popup-select-option${i === active ? " is-active" : ""}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(i)}
            >
              <span>{o.label}</span>
              {o.value === value && <IcCheck size={16} className="popup-select-check" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
