"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { browserBackLayer } from "@/lib/back-layer";
import { CARD_PHOTO_TEXT } from "@/lib/card-photo";
import { hasSession } from "@/lib/session";
import {
  FIT,
  clampPan,
  distance,
  isFit,
  midpoint,
  MAX_SCALE,
  panBy,
  pinch,
  stepZoom,
  toggleZoom,
  wheelZoom,
  zoomAt,
  type Point,
  type Size,
  type View,
} from "@/lib/zoom";

/** Safari 의 트랙패드 · 손가락 오므리기 이벤트(gesturestart · gesturechange) — 표준 DOM 형식에 없어요 */
type GestureLike = Event & { scale: number; clientX: number; clientY: number };

/** 두 번 누르기로 보는 간격 · 거리 */
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_PX = 30;
/** 이만큼 움직이면 누르기가 아니라 끌기로 봐요(바깥 누르기 닫힘 · 두 번 누르기에서 빼요) */
const MOVE_PX = 4;

type Gesture = { kind: "pan"; id: number; start: View; from: Point } | { kind: "pinch"; start: View; mid: Point; dist: number } | null;

/**
 * 명함 크게 보기(UG-431 · UG-455) — 발급 창의 작은 사진과 목록 ⋮ 「명함 보기」가 같이 써요.
 * src 가 null 이면 불러오는 중(목록에서 서버 사진을 받는 동안)이에요.
 *
 * 확대(1~4배): 두 손가락 벌리기 · 두 번 누르기 · 두 번 클릭(맞춤 ↔ 2.5배) · 휠 · 트랙패드 오므리기(ctrlKey 휠, Safari gesture*)
 * · [−] [+] [맞춤] · 키보드 + − 0. 커져 있으면 한 손가락 · 마우스로 끌어 옮겨요(사진 가장자리까지만).
 * 닫기: 「닫기」 · Esc · 맞춤 배율일 때 사진 바깥 누르기 · 휴대폰 「뒤로 가기」(기획 17099-6 — 이 화면만 닫히고 뒤의 계정 발급 화면은 그대로,
 * back-layer.ts). 발급 창 안에서 열려도 Esc 는 이 화면만 닫아요(창까지 닫히지 않게 먼저 받아요).
 * 초점은 이 화면의 버튼 사이에서만 돌고(Tab · Shift+Tab), 닫으면 연 버튼으로 돌아가요.
 * 화면 전체를 검정으로 덮어요(기획 17099-1 — 사진 앱처럼. 뒤의 창 · 목록 글자 · 버튼이 비치지 않게 불투명).
 * email 이 있으면 맨 위에 한 줄로 보여 줘요(기획 17099-2 — 사진과 이메일을 나란히 비교). 발급 창에서 열면 지금 이메일 칸의 값,
 * 목록에서 열면 그 줄의 이메일. 비어 있으면 줄을 숨겨요. 긴 주소는 자르지 않고 줄을 바꿔요.
 */
export function CardPhotoViewer({ src, email, onClose }: { src: string | null; email?: string; onClose: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLParagraphElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const zoomInRef = useRef<HTMLButtonElement>(null);
  const zoomOutRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // 휴대폰 「뒤로 가기」는 이 화면만 닫아요(기획 17099-6). 다른 길로 닫히면 얹어 둔 history 칸을 빼요(back-layer.ts).
  // 로그인이 끊겨 로그인 화면으로 떠나는 중이면 빼지 않아요 — 뒤로 가기가 그 이동을 망가뜨려 빈 화면에 멈춰요(화면 반박 리뷰 1)
  useEffect(() => browserBackLayer(leavingForLogin).open(() => onCloseRef.current()), []);

  /** 사진이 아닌 조작부(위 이메일 줄 · 아래 버튼 줄) — 여기서 시작한 누르기는 확대 · 이동 · 바깥 누르기 닫힘으로 보지 않아요 */
  const inChrome = (target: EventTarget | null) =>
    !!barRef.current?.contains(target as Node) || !!headRef.current?.contains(target as Node);

  const [view, setView] = useState<View>(FIT);
  // 버튼 · 두 번 누르기처럼 한 번에 바뀔 때만 부드럽게(손가락을 따라갈 때는 바로)
  const [animate, setAnimate] = useState(false);
  const viewRef = useRef<View>(FIT);
  // 맞춤 크기의 사진(base)과 보기 영역(stage) — 불러온 뒤 · 화면 크기가 바뀌면 다시 재요
  const sizes = useRef<{ base: Size; stage: Size }>({ base: { w: 0, h: 0 }, stage: { w: 0, h: 0 } });
  const loaded = src !== null;
  const loadedRef = useRef(loaded);
  useEffect(() => {
    loadedRef.current = loaded;
  }, [loaded]);

  const apply = useCallback((next: View, smooth = false) => {
    viewRef.current = next;
    setAnimate(smooth);
    setView(next);
  }, []);

  /** 화면 좌표 → 보기 영역 가운데 기준 */
  const focalOf = useCallback((clientX: number, clientY: number): Point => {
    const r = stageRef.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return { x: clientX - (r.left + r.width / 2), y: clientY - (r.top + r.height / 2) };
  }, []);

  const measure = useCallback(() => {
    const img = imgRef.current;
    const stage = stageRef.current;
    if (!img || !stage) return;
    // offsetWidth 는 transform(확대)을 빼고 잰 맞춤 크기예요
    sizes.current = { base: { w: img.offsetWidth, h: img.offsetHeight }, stage: { w: stage.clientWidth, h: stage.clientHeight } };
    const cur = viewRef.current;
    const next = clampPan(cur, sizes.current.base, sizes.current.stage);
    if (next.scale !== cur.scale || next.x !== cur.x || next.y !== cur.y) apply(next);
  }, [apply]);

  // 화면 크기 · 방향이 바뀌면 다시 재고 이동 범위를 맞춰요
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    if (typeof ResizeObserver === "function") {
      const ro = new ResizeObserver(() => measure());
      ro.observe(stage);
      return () => ro.disconnect();
    }
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  // ── 키보드 · 초점 ──
  const step = useCallback(
    (dir: 1 | -1) => {
      if (!loadedRef.current) return;
      apply(stepZoom(viewRef.current, dir, sizes.current.base, sizes.current.stage), true);
    },
    [apply],
  );
  const fit = useCallback(() => apply(FIT, true), [apply]);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Tab") {
        // 초점은 이 화면의 버튼 사이에서만(뒤 창 · 목록으로 빠지지 않게)
        e.preventDefault();
        e.stopPropagation();
        const list = [...(barRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
        if (list.length === 0) return;
        const at = list.indexOf(document.activeElement as HTMLButtonElement);
        const next = e.shiftKey ? (at <= 0 ? list.length - 1 : at - 1) : at < 0 || at === list.length - 1 ? 0 : at + 1;
        list[next].focus();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      // Ctrl · Cmd + − 는 브라우저 확대 — 건드리지 않아요
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      let handled = true;
      if (e.key === "+" || e.key === "=") step(1);
      else if (e.key === "-" || e.key === "_") step(-1);
      else if (e.key === "0") fit();
      else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      if (opener?.isConnected) opener.focus();
    };
  }, [step, fit]);

  // 누른 버튼이 꺼지면(끝까지 확대 · 축소 · 맞춤) 초점이 화면 밖으로 빠지지 않게 남은 확대 · 축소 버튼으로 옮겨요
  useEffect(() => {
    const active = document.activeElement;
    const root = rootRef.current;
    if (!root) return;
    const lost = !active || active === document.body || !root.contains(active) || (active instanceof HTMLButtonElement && active.disabled);
    if (!lost) return;
    const target = [zoomInRef.current, zoomOutRef.current, closeRef.current].find((b) => b && !b.disabled);
    target?.focus();
  }, [view]);

  // ── 손가락 · 마우스(Pointer Events) ──
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture>(null);
  const moved = useRef(false);
  const downAt = useRef<Point>({ x: 0, y: 0 });
  // 이번 누르기가 바깥 누르기 닫힘이 될 수 있는지 — 맞춤 배율에서 사진 · 버튼 밖을 눌러 움직이지 않고 뗐을 때만
  const closable = useRef(false);
  const lastTap = useRef<{ t: number; p: Point } | null>(null);
  const lastPointerType = useRef("mouse");

  function begin() {
    const list = [...pointers.current.entries()];
    if (list.length >= 2) {
      const a = list[0][1];
      const b = list[1][1];
      gesture.current = { kind: "pinch", start: viewRef.current, mid: focalOf(...xy(midpoint(a, b))), dist: distance(a, b) };
    } else if (list.length === 1) {
      gesture.current = { kind: "pan", id: list[0][0], start: viewRef.current, from: list[0][1] };
    } else gesture.current = null;
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!loaded || inChrome(e.target)) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    lastPointerType.current = e.pointerType;
    const p = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 1) {
      moved.current = false;
      downAt.current = p;
      closable.current = isFit(viewRef.current) && !imgRef.current?.contains(e.target as Node);
    } else {
      moved.current = true; // 두 손가락 — 누르기가 아니에요
      closable.current = false;
    }
    // 마우스로 커진 사진을 끌 때 화면 밖으로 나가도 따라가게. 맞춤일 때는 잡지 않아요(누르기가 사진 · 바깥 그대로 가게)
    if (e.pointerType === "mouse" && !isFit(viewRef.current)) e.currentTarget.setPointerCapture?.(e.pointerId);
    setAnimate(false);
    begin();
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(e.pointerId)) return;
    const p = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, p);
    const g = gesture.current;
    if (!g) return;
    const { base, stage } = sizes.current;
    if (g.kind === "pinch") {
      const list = [...pointers.current.values()];
      if (list.length < 2) return;
      apply(pinch(g.start, g.mid, g.dist, focalOf(...xy(midpoint(list[0], list[1]))), distance(list[0], list[1]), base, stage));
      return;
    }
    if (g.id !== e.pointerId) return;
    const dx = p.x - g.from.x;
    const dy = p.y - g.from.y;
    if (!moved.current && Math.hypot(p.x - downAt.current.x, p.y - downAt.current.y) > MOVE_PX) {
      moved.current = true;
      closable.current = false;
    }
    if (!isFit(g.start)) apply(panBy(g.start, dx, dy, base, stage));
  }

  function onPointerEnd(e: React.PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(e.pointerId)) return;
    const single = pointers.current.size === 1;
    pointers.current.delete(e.pointerId);
    // 손가락 두 번 누르기(마우스는 dblclick 으로) — 움직이지 않은 한 손가락 누르기 둘이 짧은 간격 · 가까운 자리면
    if (e.type === "pointerup" && single && !moved.current && e.pointerType !== "mouse") {
      const p = { x: e.clientX, y: e.clientY };
      const prev = lastTap.current;
      if (prev && e.timeStamp - prev.t < DOUBLE_TAP_MS && Math.hypot(p.x - prev.p.x, p.y - prev.p.y) < DOUBLE_TAP_PX) {
        lastTap.current = null;
        closable.current = false;
        apply(toggleZoom(viewRef.current, focalOf(p.x, p.y), sizes.current.base, sizes.current.stage), true);
      } else lastTap.current = { t: e.timeStamp, p };
    }
    // 남은 손가락이 있으면 지금 보기에서 이어서(두 손가락 → 한 손가락이 돼도 튀지 않게)
    begin();
  }

  function onDoubleClick(e: React.MouseEvent<HTMLDivElement>) {
    // 손가락은 위 pointerup 에서 처리했어요(브라우저가 dblclick 을 함께 보내도 두 번 바뀌지 않게)
    if (!loaded || lastPointerType.current !== "mouse" || inChrome(e.target)) return;
    closable.current = false;
    apply(toggleZoom(viewRef.current, focalOf(e.clientX, e.clientY), sizes.current.base, sizes.current.stage), true);
  }

  function onClick(e: React.MouseEvent<HTMLDivElement>) {
    // 바깥 누르기 닫기 — 맞춤 배율에서만(확대 중에는 끌다 손을 뗀 것이 닫기가 되지 않게). 사진 · 버튼 줄 · 이메일 줄은 빼요
    const target = e.target as Node;
    if (inChrome(target) || imgRef.current?.contains(target)) return;
    if (!isFit(viewRef.current)) return;
    // 불러오는 중이면 손가락 처리를 하지 않아 closable 이 없어요 — 바깥 누르기는 그대로 닫아요
    if (loaded && (!closable.current || moved.current)) return;
    onClose();
  }

  // 휠 · 트랙패드 오므리기 · Safari gesture* — 페이지가 함께 스크롤 · 확대되지 않게 막아야 해서(passive: false) 직접 붙여요
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let gestureStart: View | null = null;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (!loadedRef.current) return;
      const { base, stage } = sizes.current;
      apply(wheelZoom(viewRef.current, e.deltaY, e.deltaMode, e.ctrlKey, focalOf(e.clientX, e.clientY), base, stage));
    };
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      // 손가락 두 개는 Pointer Events 가 처리해요(iOS) — 트랙패드(macOS Safari)일 때만 여기서
      gestureStart = pointers.current.size >= 2 || !loadedRef.current ? null : viewRef.current;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      if (!gestureStart || pointers.current.size >= 2) return;
      const g = e as GestureLike;
      const { base, stage } = sizes.current;
      apply(zoomAt(gestureStart, gestureStart.scale * g.scale, focalOf(g.clientX, g.clientY), base, stage));
    };
    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      gestureStart = null;
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    root.addEventListener("gesturestart", onGestureStart);
    root.addEventListener("gesturechange", onGestureChange);
    root.addEventListener("gestureend", onGestureEnd);
    return () => {
      root.removeEventListener("wheel", onWheel);
      root.removeEventListener("gesturestart", onGestureStart);
      root.removeEventListener("gesturechange", onGestureChange);
      root.removeEventListener("gestureend", onGestureEnd);
    };
  }, [apply, focalOf]);

  const fitted = isFit(view);
  const shownEmail = email?.trim() ?? "";
  return (
    <div
      ref={rootRef}
      className={`photo-viewer${fitted ? "" : " is-zoomed"}`}
      role="dialog"
      aria-modal="true"
      aria-label={CARD_PHOTO_TEXT.viewerTitle}
      aria-busy={loaded ? undefined : true}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onDoubleClick={onDoubleClick}
    >
      {shownEmail && (
        <p ref={headRef} className="photo-viewer-email" translate="no">
          <span className="visually-hidden">{CARD_PHOTO_TEXT.viewerEmailLabel} </span>
          {shownEmail}
        </p>
      )}
      <div ref={stageRef} className="photo-viewer-stage">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element -- data URL(명함 사진)이라 next/image 를 쓸 수 없어요
          <img
            ref={imgRef}
            src={src}
            alt={CARD_PHOTO_TEXT.viewerTitle}
            draggable={false}
            className={animate ? "is-animating" : undefined}
            style={{ transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})` }}
            onLoad={measure}
          />
        ) : (
          <p className="photo-viewer-status">{CARD_PHOTO_TEXT.loading}</p>
        )}
      </div>
      <div ref={barRef} className="photo-viewer-bar">
        <button
          ref={zoomOutRef}
          type="button"
          className="btn btn-outline photo-viewer-zoom"
          aria-label={CARD_PHOTO_TEXT.zoomOut}
          title={CARD_PHOTO_TEXT.zoomOut}
          onClick={() => step(-1)}
          disabled={!loaded || fitted}
        >
          −
        </button>
        <button
          ref={zoomInRef}
          type="button"
          className="btn btn-outline photo-viewer-zoom"
          aria-label={CARD_PHOTO_TEXT.zoomIn}
          title={CARD_PHOTO_TEXT.zoomIn}
          onClick={() => step(1)}
          disabled={!loaded || view.scale >= MAX_SCALE}
        >
          +
        </button>
        <button type="button" className="btn btn-outline" onClick={fit} disabled={!loaded || fitted}>
          {CARD_PHOTO_TEXT.fit}
        </button>
        <button ref={closeRef} type="button" className="btn btn-outline" onClick={onClose}>
          {CARD_PHOTO_TEXT.close}
        </button>
      </div>
    </div>
  );
}

const xy = (p: Point): [number, number] => [p.x, p.y];

/** 로그인 상태가 지워졌으면(세션 만료 · 로그아웃 · 다른 탭 로그아웃) 화면이 로그인 화면으로 떠나는 중이에요 */
const leavingForLogin = () => !hasSession();
