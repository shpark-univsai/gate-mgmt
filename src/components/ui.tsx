"use client";

import { useEffect, useRef, useState } from "react";
import { IcArrowDown, IcCheck, IcInputClose } from "./icons";
import { isTouchPrimary } from "@/lib/pointer";

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

let dialogOpener: HTMLElement | null = null;

/**
 * 확인 · 입력 창. 닫기 ✕는 두지 않아요 — 「취소」, Esc, 창 바깥 누르기로 닫혀요.
 * 열리면 data-autofocus 가 붙은 버튼 → 첫 입력 칸 → 실행 버튼 순으로 초점이 가요.
 * touchInputFocus = false 면 손가락으로 쓰는 기기(pointer: coarse)에서는 입력 칸에 초점을 주지 않고 창 자체에 둬요(UG-453 기획 4 —
 * 계정 만들기 창은 명함 찍기가 먼저인데 안드로이드 키보드가 올라와 화면을 가렸어요). PC 는 그대로 첫 입력 칸.
 * 창 안에서만 Tab 이 돌고, 닫히면 창을 연 버튼으로 초점이 돌아가요.
 */
export function Dialog({
  title,
  onClose,
  closable = true,
  wide = false,
  touchInputFocus = true,
  children,
}: {
  title: string;
  onClose: () => void;
  closable?: boolean;
  /** 칸을 두 줄로 나란히 두는 창(계정 만들기 — 회사명 · 이름 / 이메일 · 연락처)은 조금 넓게 */
  wide?: boolean;
  /** 터치 기기에서도 열릴 때 첫 입력 칸에 초점을 줄지(기본 그대로) — false 면 키보드가 저절로 올라오지 않아요 */
  touchInputFocus?: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);

  // 휴대폰 키보드가 올라오면 화면에 실제로 보이는 영역만 덮어요. 안 그러면 창 아래쪽 버튼이 키보드 뒤로 숨어요.
  useEffect(() => {
    const vv = window.visualViewport;
    const el = scrimRef.current;
    if (!vv || !el) return;
    const fit = () => {
      el.style.top = `${vv.offsetTop}px`;
      el.style.height = `${vv.height}px`;
      el.style.bottom = "auto";
    };
    fit();
    vv.addEventListener("resize", fit);
    vv.addEventListener("scroll", fit);
    return () => {
      vv.removeEventListener("resize", fit);
      vv.removeEventListener("scroll", fit);
    };
  }, []);

  // 터치 기기(휴대폰 · 아이패드): 칸에 초점이 가면 그 칸과 칸 아래 안내(이미 사용 중 · 비밀번호 링크 · 의심 주소 경고 등)를 보이게 스크롤해요
  // (UG-451 기획 17073-6). 칸 아래 안내가 늘거나 줄 때(ResizeObserver)도 다시 맞춰요. 휴대폰은 맨 아래 버튼 줄만큼 비워 두고 맞춰요(.scrim scroll-padding-bottom).
  // 칸 묶음(.field)을 먼저, 그다음 칸 자체를 가장 가까운 자리로 — 묶음이 보이는 영역보다 길어도 칸은 꼭 보여요.
  // 키보드가 올라오는 동안만 다시 맞춰요: 초점이 간 뒤 1초 안에, 보이는 영역이 줄어들 때(visualViewport resize — 위 fit 이 먼저 창 높이를 맞춰요)와
  // 400ms 뒤 한 번 더. 직원이 명함 사진 · 칩과 견주려고 창을 만지거나 스크롤하기 시작하면(touchstart · wheel) 남은 맞춤은 모두 취소해요 —
  // 안드로이드 주소창이 접히는 resize 따위로 보던 자리에서 칸으로 끌려가지 않게.
  useEffect(() => {
    const dialog = ref.current;
    const scrim = scrimRef.current;
    if (!dialog || !scrim || !window.matchMedia("(pointer: coarse)").matches) return;
    const vv = window.visualViewport;
    const REALIGN_WINDOW_MS = 1000;
    let input: HTMLElement | null = null;
    let field: HTMLElement | null = null;
    let timer = 0;
    let realignUntil = 0;
    let lastHeight = vv?.height ?? 0;
    const reveal = () => {
      if (!input || document.activeElement !== input) return;
      field?.scrollIntoView({ block: "nearest" });
      input.scrollIntoView({ block: "nearest" });
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(reveal);
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target;
      if (!(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) || t.type === "file") return;
      input = t;
      field = t.closest<HTMLElement>(".field") ?? t;
      observer?.disconnect();
      observer?.observe(field);
      realignUntil = performance.now() + REALIGN_WINDOW_MS;
      // 키보드가 다 올라온 뒤(resize 가 오지 않는 브라우저도) 한 번 더
      window.clearTimeout(timer);
      timer = window.setTimeout(reveal, 400);
    };
    const onViewportResize = () => {
      const height = vv?.height ?? 0;
      const shrank = height < lastHeight;
      lastHeight = height;
      if (shrank && performance.now() < realignUntil) reveal();
    };
    const onUserScroll = () => {
      realignUntil = 0;
      window.clearTimeout(timer);
    };
    dialog.addEventListener("focusin", onFocusIn);
    scrim.addEventListener("touchstart", onUserScroll, { passive: true });
    scrim.addEventListener("wheel", onUserScroll, { passive: true });
    vv?.addEventListener("resize", onViewportResize);
    return () => {
      dialog.removeEventListener("focusin", onFocusIn);
      scrim.removeEventListener("touchstart", onUserScroll);
      scrim.removeEventListener("wheel", onUserScroll);
      vv?.removeEventListener("resize", onViewportResize);
      observer?.disconnect();
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    // 창이 다른 창으로 바뀌는 경우(만들기 → 실패 결과)에도 처음 연 버튼을 기억해요.
    const active = document.activeElement as HTMLElement | null;
    if (active && active !== document.body && !active.closest(".dialog")) dialogOpener = active;
    const el = ref.current;
    // 터치 기기에서 입력 칸에 초점을 주지 않는 창 — 창 자체에 둬요(낭독기가 창을 읽고, Tab 은 창 안에서 시작해요).
    // 창이 초점을 받을 수 있는 것은 이때 한 번뿐 — 초점이 창을 떠나면 tabindex 를 지워, 뒤에 창 빈 곳을 눌러도 칸에서 초점(키보드)이 빠지지 않게 전과 같아요
    const skipInput = !touchInputFocus && isTouchPrimary() && !el?.querySelector("[data-autofocus]");
    if (el && skipInput) {
      el.tabIndex = -1;
      el.addEventListener("blur", () => el.removeAttribute("tabindex"), { once: true });
      el.focus();
    } else {
      (
        el?.querySelector<HTMLElement>("[data-autofocus]") ??
        el?.querySelector<HTMLElement>("input:not([readonly])") ??
        el?.querySelector<HTMLElement>(".dialog-actions button:last-child")
      )?.focus();
    }
    return () => {
      // 마지막 창이 닫히면 연 버튼으로(메뉴 안 버튼처럼 사라졌으면 그대로)
      if (document.querySelector(".dialog")) return;
      if (dialogOpener?.isConnected) dialogOpener.focus();
      dialogOpener = null;
    };
    // 창이 열릴 때 한 번만 — touchInputFocus 는 창마다 정해진 값이에요
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Tab 이 창 밖(뒤 화면)으로 나가지 않게 처음 ↔ 끝을 이어요. */
  function trapTab(e: React.KeyboardEvent) {
    if (e.key !== "Tab") return;
    const items = [...(ref.current?.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href], [tabindex]:not([tabindex='-1'])") ?? [])].filter(
      (n) => !n.hasAttribute("disabled") && n.offsetParent !== null,
    );
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    // 창 자체에 초점이 있을 때(터치 기기에서 열림) Shift+Tab 도 창 안 마지막으로
    if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && closable) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, closable]);

  return (
    <div ref={scrimRef} className="scrim" onMouseDown={(e) => e.target === e.currentTarget && closable && onClose()}>
      <div
        ref={ref}
        className={`dialog${wide ? " dialog--wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        onKeyDown={trapTab}
      >
        <h2 id="dialog-title" className="dialog-title">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

/**
 * 완료 알림 — 어두운 유리(반투명 + 흐림). 4초 뒤 사라져요.
 * tone="error" = 창이 이미 닫힌 뒤의 실패(「작성 중」 명함 저장 등, UG-431) — 같은 자리 · 모양에 아이콘만 빨간 ✕
 */
/** note = 아래에 한 줄 더(UG-455 기획 17099-5 — 「계정을 만들었습니다」 아래 「명함 사진은 저장하지 못했습니다」) */
export function Toast({ title, detail, note, tone, onDone }: { title: string; detail: string; note?: string; tone?: "error"; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 4000);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div className={`toast${tone === "error" ? " toast--error" : ""}`} role={tone === "error" ? "alert" : "status"} aria-live={tone === "error" ? "assertive" : "polite"}>
      {tone === "error" ? <IcInputClose size={18} className="toast-icon" /> : <IcCheck size={18} className="toast-icon" />}
      <div>
        <p className="toast-title">{title}</p>
        <p className="toast-detail">{detail}</p>
        {note && <p className="toast-note">{note}</p>}
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
