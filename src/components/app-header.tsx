"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Brand } from "./ui";

/** 위쪽 메뉴. 「계정 해지」(UG-443)는 「계정 발급」 옆 — 기획 16871 T1 */
const MENU = [
  { key: "accounts", href: "/accounts", label: "계정 발급" },
  { key: "closures", href: "/closures", label: "계정 해지" },
] as const;

export type MenuKey = (typeof MENU)[number]["key"];

/** 화면 위쪽 띠 — 로고 · 메뉴 · 프로필. 휴대폰에서는 메뉴가 숨어요(globals.css). */
export function AppHeader({ current, email, onLogout }: { current: MenuKey; email: string; onLogout: () => void }) {
  return (
    <header className="app-nav">
      <div className="app-nav-left">
        <Brand />
        <nav className="app-menu" aria-label="메뉴">
          {MENU.map((m) => (
            <Link
              key={m.key}
              className={`app-menu-item${m.key === current ? " is-active" : ""}`}
              href={m.href}
              aria-current={m.key === current ? "page" : undefined}
            >
              {m.label}
            </Link>
          ))}
        </nav>
      </div>
      <ProfileMenu current={current} email={email} onLogout={onLogout} />
    </header>
  );
}

/**
 * 오른쪽 위 프로필. 누르면 로그아웃이 있는 작은 메뉴가 열려요.
 * 휴대폰은 이메일과 화면 이동(계정 발급 · 계정 해지)도 메뉴 안에 — 위쪽 메뉴가 숨어서예요.
 */
function ProfileMenu({ current, email, onLogout }: { current: MenuKey; email: string; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="profile" ref={ref}>
      <button type="button" className="profile-button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="avatar" aria-hidden="true">
          {email.slice(0, 1).toUpperCase()}
        </span>
        <span className="identity-name">{email}</span>
      </button>
      {open && (
        <div className="profile-menu" role="menu">
          <p className="profile-menu-email">{email}</p>
          <nav className="profile-menu-nav" aria-label="메뉴">
            {MENU.map((m) => (
              <Link
                key={m.key}
                role="menuitem"
                className={`profile-menu-item${m.key === current ? " is-active" : ""}`}
                href={m.href}
                aria-current={m.key === current ? "page" : undefined}
                onClick={() => setOpen(false)}
              >
                {m.label}
              </Link>
            ))}
          </nav>
          <button type="button" role="menuitem" className="profile-menu-item" onClick={onLogout}>
            로그아웃
          </button>
        </div>
      )}
    </div>
  );
}
