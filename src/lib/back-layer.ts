// 화면 위에 덮는 보기 화면(명함 크게 보기, UG-455 기획 17099-6)을 휴대폰 「뒤로 가기」로 닫게 해요.
// 열 때 history 에 칸을 하나 얹고(주소는 그대로), 뒤로 가기가 그 칸을 빼면 보기 화면만 닫아요 — 뒤의 계정 발급 화면은 그대로예요.
// 「닫기」 · Esc · 바깥 누르기로 닫을 때는 얹어 둔 칸을 우리가 빼요 — history 에 칸이 남지 않고(뒤로 가기를 두 번 누르지 않게),
// 뒤로 가기로 닫힌 뒤에는 또 빼지 않아요(화면을 벗어나지 않게). 로그인이 끊겨 화면이 떠나는 중에도 빼지 않아요(이동을 망가뜨리지 않게).
// 계산은 브라우저 없이 시험할 수 있게 history 를 주입받아요(back-layer.test.ts).

/** 얹은 칸의 표시 — history.state 에 이 값이 있으면 우리 칸이에요 */
export const BACK_LAYER_KEY = "gateMgmtBackLayer";

/** history 가운데 쓰는 것만 */
export type HistoryPort = {
  /** 지금 칸의 state */
  state: () => unknown;
  /** 칸을 하나 얹어요(주소는 바꾸지 않아요) */
  push: (state: Record<string, unknown>) => void;
  /** 한 칸 뒤로(비동기 — 끝나면 popstate 가 와요) */
  back: () => void;
  /** popstate 를 들어요. 돌려준 함수를 부르면 그만 들어요 */
  onPop: (listener: () => void) => () => void;
  /** 조금 뒤에 실행해요. 돌려준 함수를 부르면 취소해요 */
  defer: (task: () => void) => () => void;
  /**
   * 화면이 다른 곳으로 떠나는 중인지(로그인이 끊겨 로그인 화면으로 가는 중). 이때는 얹어 둔 칸을 빼지 않아요 —
   * 우리 back() 이 진행 중인 이동을 취소하거나 되돌려, 로그인 화면 대신 빈 화면에 멈춰요(UG-455 화면 반박 리뷰 1).
   * 이동은 history 에 늦게 반영돼서(location.replace · router.replace 모두) history.state 만 봐서는 알 수 없어요.
   */
  leaving: () => boolean;
};

const isOurs = (state: unknown): boolean =>
  typeof state === "object" && state !== null && (state as Record<string, unknown>)[BACK_LAYER_KEY] === true;

export type BackLayer = {
  /**
   * 보기 화면을 열 때 불러요. onBack = 뒤로 가기로 우리 칸이 빠졌을 때(보기 화면을 닫아요).
   * 돌려준 함수는 보기 화면이 사라질 때(어떤 길로 닫혔든) 한 번 불러요 — 칸이 아직 남아 있으면 빼요.
   */
  open: (onBack: () => void) => () => void;
};

/**
 * 칸의 상태는 셋이에요.
 * - 없음: 우리 칸이 history 에 없어요.
 * - 얹음(held): 우리 칸이 맨 위에 있어요. 보기 화면이 열려 있거나(handler), 방금 닫혀 칸을 빼려고 예약해 둔 사이(cancelPop)예요.
 * - 빼는 중(ownPops > 0): 우리가 back() 을 불렀고 그 popstate 를 아직 못 받았어요. history.state 는 아직 우리 칸으로 보이지만 곧 빠져요.
 */
export function createBackLayer(port: HistoryPort): BackLayer {
  let held = false;
  let handler: (() => void) | null = null;
  // 닫은 직후 칸을 빼려고 잡아 둔 예약 — 바로 다시 열리면(개발 모드의 이중 마운트 · 닫자마자 다시 엶) 취소하고 칸을 이어 써요
  let cancelPop: (() => void) | null = null;
  // 우리가 부른 back() 가운데 popstate 를 아직 못 받은 수 — 그 popstate 는 「뒤로 가기」로 세지 않아요
  let ownPops = 0;
  let listening = false;

  /** 우리 칸을 맨 위에 둬요 — 새로 고침 뒤처럼 이미 남아 있으면 그 칸을 써요(칸이 겹쳐 쌓이지 않게) */
  function hold() {
    if (!isOurs(port.state())) port.push({ [BACK_LAYER_KEY]: true });
    held = true;
  }

  function onPop() {
    if (ownPops > 0) {
      ownPops--;
      // 빼는 중에 보기 화면이 다시 열렸으면(반박 리뷰 2) 칸이 다 빠진 지금 새로 얹어요 — 빠지기 전에 얹으면 곧 빠질 칸을 우리 칸으로 착각해요
      if (ownPops === 0 && handler && !held && !port.leaving()) hold();
      return;
    }
    if (!held) return;
    // 직원이 뒤로 가기를 눌러 우리 칸이 빠졌어요 — 보기 화면만 닫아요(칸은 이미 없으니 다시 빼지 않아요)
    held = false;
    if (cancelPop) {
      // 닫히고 칸을 빼려던 참이었어요 — 이미 빠졌으니 예약을 버려요(한 칸 더 뒤로 가지 않게)
      cancelPop();
      cancelPop = null;
    }
    const h = handler;
    handler = null;
    h?.();
  }

  return {
    open(onBack) {
      if (!listening) {
        port.onPop(onPop);
        listening = true;
      }
      handler = onBack;
      if (cancelPop) {
        // 방금 닫힌 보기 화면의 칸이 아직 그대로예요 — 빼지 않고 이어 써요
        cancelPop();
        cancelPop = null;
      } else if (!held && ownPops === 0) {
        hold();
      }
      // 빼는 중(ownPops > 0)이면 여기서 얹지 않아요 — 우리 popstate 를 받은 뒤 onPop 이 얹어요
      let released = false;
      return () => {
        if (released) return;
        released = true;
        if (handler !== onBack) return; // 뒤로 가기로 이미 닫혔거나 다른 보기 화면이 이어받았어요
        handler = null;
        if (!held) return; // 얹은 칸이 없어요(빼는 중에 열렸다 닫힘 포함)
        if (port.leaving()) {
          // 로그인이 끊겨 화면이 떠나는 중 — 칸을 그대로 둬요(이동이 그 칸을 바꿔 써요)
          held = false;
          return;
        }
        cancelPop = port.defer(() => {
          cancelPop = null;
          held = false;
          // 그사이 떠나기 시작했거나(예약한 뒤에 로그인이 끊김) 이미 다른 화면이면(우리 칸이 아님) 건드리지 않아요
          if (port.leaving() || !isOurs(port.state())) return;
          ownPops++;
          port.back();
        });
      };
    },
  };
}

let shared: BackLayer | null = null;

/**
 * 브라우저의 history 로 만든 하나뿐인 층 — 보기 화면은 한 번에 하나만 열려요.
 * leaving = 화면이 떠나는 중인지(HistoryPort.leaving) — 처음 부를 때 준 것을 써요.
 */
export function browserBackLayer(leaving: () => boolean): BackLayer {
  shared ??= createBackLayer({
    state: () => window.history.state,
    // Next 가 pushState 를 감싸 라우터 상태를 함께 실어 줘요 — 주소를 주지 않으면 화면은 그대로예요
    push: (state) => window.history.pushState(state, ""),
    back: () => window.history.back(),
    onPop: (listener) => {
      window.addEventListener("popstate", listener);
      return () => window.removeEventListener("popstate", listener);
    },
    defer: (task) => {
      const t = window.setTimeout(task, 0);
      return () => window.clearTimeout(t);
    },
    leaving,
  });
  return shared;
}
