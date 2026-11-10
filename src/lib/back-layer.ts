// 화면 위에 덮는 보기 화면(명함 크게 보기, UG-455 기획 17099-6)을 휴대폰 「뒤로 가기」로 닫게 해요.
// 열 때 history 에 칸을 하나 얹고(주소는 그대로), 뒤로 가기가 그 칸을 빼면 보기 화면만 닫아요 — 뒤의 계정 발급 화면은 그대로예요.
// 「닫기」 · Esc · 바깥 누르기로 닫을 때는 얹어 둔 칸을 우리가 빼요 — history 에 칸이 남지 않고(뒤로 가기를 두 번 누르지 않게),
// 뒤로 가기로 닫힌 뒤에는 또 빼지 않아요(화면을 벗어나지 않게).
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

export function createBackLayer(port: HistoryPort): BackLayer {
  // 우리 칸이 history 맨 위에 얹혀 있어요
  let held = false;
  let handler: (() => void) | null = null;
  // 닫은 직후 칸을 빼려고 잡아 둔 예약 — 바로 다시 열리면(개발 모드의 이중 마운트 · 닫자마자 다시 엶) 취소하고 칸을 이어 써요
  let cancelPop: (() => void) | null = null;
  // 우리가 부른 back() 의 popstate 는 「뒤로 가기」로 세지 않아요
  let ownPops = 0;
  let listening = false;

  function onPop() {
    if (ownPops > 0) {
      ownPops--;
      return;
    }
    if (!held) return;
    // 직원이 뒤로 가기를 눌러 우리 칸이 빠졌어요 — 보기 화면만 닫아요(칸은 이미 없으니 다시 빼지 않아요)
    held = false;
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
      if (cancelPop) {
        // 방금 닫힌 보기 화면의 칸이 아직 그대로예요 — 빼지 않고 이어 써요
        cancelPop();
        cancelPop = null;
      } else if (!held) {
        // 새로 고침 뒤처럼 우리 칸이 이미 맨 위에 남아 있으면 그 칸을 써요(칸이 겹쳐 쌓이지 않게)
        if (!isOurs(port.state())) port.push({ [BACK_LAYER_KEY]: true });
        held = true;
      }
      handler = onBack;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        if (handler !== onBack) return; // 뒤로 가기로 이미 닫혔거나 다른 보기 화면이 이어받았어요
        handler = null;
        if (!held) return;
        cancelPop = port.defer(() => {
          cancelPop = null;
          held = false;
          // 그사이 다른 화면으로 넘어갔으면(로그인 화면 등 — 우리 칸이 아니에요) 건드리지 않아요
          if (!isOurs(port.state())) return;
          ownPops++;
          port.back();
        });
      };
    },
  };
}

let shared: BackLayer | null = null;

/** 브라우저의 history 로 만든 하나뿐인 층 — 보기 화면은 한 번에 하나만 열려요 */
export function browserBackLayer(): BackLayer {
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
  });
  return shared;
}
