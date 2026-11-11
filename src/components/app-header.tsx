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

/**
 * 화면 위쪽 띠 — 로고 · 메뉴 · 프로필. 휴대폰(≤ 640)에서는 위쪽 메뉴가 숨고, 대신 머리 줄 바로 아래 탭 줄(「계정 발급」 · 「계정 해지」)로
 * 바로 옮겨요(UG-458 기획 17188 — 프로필 메뉴 안의 이동을 새 직원이 찾지 못했어요). 탭 줄은 PC · 아이패드에서 숨어요(globals.css).
 */
export function AppHeader({ current, email, onLogout }: { current: MenuKey; email: string; onLogout: () => void }) {
  return (
    <>
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
      {/* 휴대폰 탭 줄 — 거르기 조건 없이 그 화면 처음 모양으로 가요(위쪽 메뉴와 같은 주소). 뒤로 가기는 앞 화면의 조건(주소)으로 돌아가요 */}
      <nav className="app-tabs" aria-label="화면 이동">
        {MENU.map((m) => (
          <Link
            key={m.key}
            className={`app-tab${m.key === current ? " is-active" : ""}`}
            href={m.href}
            aria-current={m.key === current ? "page" : undefined}
          >
            {m.label}
          </Link>
        ))}
      </nav>
    </>
  );
}

/**
 * 오른쪽 위 프로필. 누르면 로그아웃이 있는 작은 메뉴가 열려요.
 * 휴대폰은 이메일과 화면 이동(계정 발급 · 계정 해지)도 메뉴 안에 — 위쪽 메뉴가 숨어서예요. 탭 줄(UG-458)이 생긴 뒤에도 그대로 둬요.
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
