// 보기 화면의 「뒤로 가기」 처리(back-layer.ts) 시험 — `npm test`. UG-455 기획 17099-6.
// 브라우저의 history 를 흉내 낸 가짜로 칸 수를 세요(실제 기기의 뒤로 가기는 기기에서 확인).
import assert from "node:assert/strict";
import { test } from "node:test";

import { BACK_LAYER_KEY, createBackLayer, type HistoryPort } from "./back-layer.ts";

/** 가짜 history — 칸 목록과 지금 자리. back() 은 브라우저처럼 나중에(flush) popstate 를 보내요 */
function fakeHistory(entries: unknown[] = [{ page: "accounts" }]) {
  const stack = [...entries];
  let at = stack.length - 1;
  const listeners = new Set<() => void>();
  const pendingPops: (() => void)[] = [];
  const deferred = new Set<() => void>();
  let backCalls = 0;
  let leaving = false;

  const port: HistoryPort = {
    state: () => stack[at],
    push: (state) => {
      stack.splice(at + 1); // 앞으로 가기 칸은 버려져요
      stack.push(state);
      at = stack.length - 1;
    },
    back: () => {
      backCalls++;
      pendingPops.push(() => {
        if (at > 0) at--;
        for (const l of [...listeners]) l();
      });
    },
    onPop: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    defer: (task) => {
      deferred.add(task);
      return () => deferred.delete(task);
    },
    leaving: () => leaving,
  };

  return {
    port,
    /** 지금 자리(0 = 처음 화면) */
    at: () => at,
    length: () => stack.length,
    top: () => stack[at],
    /** back() 을 부른 횟수(직원의 뒤로 가기 포함) */
    backCalls: () => backCalls,
    /** 로그인이 끊겨 화면이 떠나는 중으로 바꿔요(세션이 지워짐) */
    startLeaving() {
      leaving = true;
    },
    /** 예약한 일(setTimeout 0)만 처리해요 — 그 안에서 부른 back() 의 popstate 는 아직 오지 않아요 */
    runDeferred() {
      for (const task of [...deferred]) {
        deferred.delete(task);
        task();
      }
    },
    /** 밀린 popstate 만 보내요 */
    deliverPops() {
      while (pendingPops.length > 0) pendingPops.shift()!();
    },
    /** 예약한 일(setTimeout 0)과 밀린 popstate 를 모두 처리해요 */
    flush() {
      for (let i = 0; i < 10 && (deferred.size > 0 || pendingPops.length > 0); i++) {
        for (const task of [...deferred]) {
          deferred.delete(task);
          task();
        }
        while (pendingPops.length > 0) pendingPops.shift()!();
      }
    },
    /** 직원이 뒤로 가기를 눌러요 */
    userBack() {
      port.back();
      this.flush();
    },
    /** 다른 화면으로 바꿔요(router.replace — 지금 칸을 바꿔 써요) */
    replace(state: unknown) {
      stack[at] = state;
    },
  };
}

test("기획 17099-6 열면 칸을 하나 얹고, 뒤로 가기는 보기 화면만 닫아요(계정 발급 화면에 그대로)", () => {
  const h = fakeHistory();
  const layer = createBackLayer(h.port);
  let closed = 0;
  const release = layer.open(() => closed++);
  assert.equal(h.at(), 1);
  assert.equal((h.top() as Record<string, unknown>)[BACK_LAYER_KEY], true);

  h.userBack();
  assert.equal(closed, 1, "보기 화면을 닫아요");
  assert.equal(h.at(), 0, "처음 화면(계정 발급)에 있어요");

  // 닫히면서 정리가 불려도 한 번 더 뒤로 가지 않아요(화면을 벗어나지 않게)
  release();
  h.flush();
  assert.equal(h.at(), 0);
  assert.equal(closed, 1);
});

test("기획 17099-6 「닫기」 · Esc · 바깥 누르기로 닫으면 얹은 칸을 빼요 — 뒤로 가기를 두 번 누르지 않게", () => {
  const h = fakeHistory();
  const layer = createBackLayer(h.port);
  let closed = 0;
  const release = layer.open(() => closed++);
  assert.equal(h.at(), 1);

  release(); // 버튼으로 닫아 보기 화면이 사라졌어요
  h.flush();
  assert.equal(h.at(), 0, "칸이 남지 않아요");
  assert.equal(closed, 0, "우리가 뺀 칸은 뒤로 가기로 세지 않아요(닫기를 또 부르지 않아요)");

  // 그 뒤의 뒤로 가기는 평소대로(이 층은 관여하지 않아요)
  h.userBack();
  assert.equal(closed, 0);
});

test("정리를 두 번 불러도 한 번만 빼요", () => {
  const h = fakeHistory([{ page: "list" }, { page: "accounts" }]);
  const layer = createBackLayer(h.port);
  const release = layer.open(() => {});
  assert.equal(h.at(), 2);
  release();
  release();
  h.flush();
  assert.equal(h.at(), 1, "계정 발급 화면까지만 — 그 앞 화면으로 가지 않아요");
});

test("닫자마자 다시 열리면(개발 모드의 이중 마운트 · 사진을 바로 다시 엶) 칸을 이어 써요 — 열린 보기 화면이 저절로 닫히지 않아요", () => {
  const h = fakeHistory();
  const layer = createBackLayer(h.port);
  let closed = 0;
  const first = layer.open(() => closed++);
  first(); // 마운트 → 정리
  const release = layer.open(() => closed++); // → 다시 마운트(예약이 돌기 전)
  h.flush();
  assert.equal(h.at(), 1, "칸은 하나 그대로");
  assert.equal(h.length(), 2, "칸이 겹쳐 쌓이지 않아요");
  assert.equal(closed, 0, "다시 열린 보기 화면은 그대로 열려 있어요");

  h.userBack();
  assert.equal(closed, 1);
  assert.equal(h.at(), 0);
  release();
  h.flush();
  assert.equal(h.at(), 0);
});

test("닫은 뒤(칸을 뺀 뒤) 다시 열면 칸을 새로 얹어요 — 목록에서 열 때도 발급 창 위에서 열 때도 같아요", () => {
  const h = fakeHistory();
  const layer = createBackLayer(h.port);
  let closed = 0;
  layer.open(() => closed++)();
  h.flush();
  assert.equal(h.at(), 0);

  const release = layer.open(() => closed++);
  assert.equal(h.at(), 1);
  h.userBack();
  assert.equal(closed, 1);
  assert.equal(h.at(), 0);
  release();
  h.flush();
  assert.equal(h.at(), 0);
});

test("뒤로 가기로 닫힌 뒤의 뒤로 가기는 이 층이 받지 않아요(닫기를 또 부르지 않아요)", () => {
  const h = fakeHistory([{ page: "list" }, { page: "accounts" }]);
  const layer = createBackLayer(h.port);
  let closed = 0;
  const release = layer.open(() => closed++);
  h.userBack();
  release();
  h.flush();
  assert.equal(closed, 1);
  h.userBack(); // 이제 진짜로 앞 화면으로
  assert.equal(closed, 1);
  assert.equal(h.at(), 0);
});

test("새로 고침 뒤처럼 우리 칸이 이미 맨 위에 남아 있으면 그 칸을 써요(또 얹지 않아요)", () => {
  const h = fakeHistory([{ page: "accounts" }, { [BACK_LAYER_KEY]: true }]);
  const layer = createBackLayer(h.port);
  const release = layer.open(() => {});
  assert.equal(h.length(), 2);
  assert.equal(h.at(), 1);
  release();
  h.flush();
  assert.equal(h.at(), 0, "남아 있던 칸까지 정리돼요");
});

test("닫히는 사이 다른 화면으로 넘어갔으면(로그인 화면으로 바뀜) 뒤로 가지 않아요", () => {
  const h = fakeHistory();
  const layer = createBackLayer(h.port);
  const release = layer.open(() => {});
  h.replace({ page: "login" }); // 로그인이 끊겨 화면이 바뀌었어요(우리 칸 자리가 로그인 화면이 됨)
  release();
  h.flush();
  assert.equal(h.at(), 1, "로그인 화면에 그대로");
});

test("보기 화면이 바뀌어도(앞 화면의 정리가 늦게 불림) 새 보기 화면의 칸을 빼지 않아요", () => {
  const h = fakeHistory();
  const layer = createBackLayer(h.port);
  let closedA = 0;
  let closedB = 0;
  const releaseA = layer.open(() => closedA++);
  const releaseB = layer.open(() => closedB++); // 같은 칸을 이어받아요
  releaseA();
  h.flush();
  assert.equal(h.at(), 1, "새 보기 화면의 칸은 그대로");
  h.userBack();
  assert.equal(closedA, 0);
  assert.equal(closedB, 1);
  releaseB();
  h.flush();
  assert.equal(h.at(), 0);
});

// ── 화면 반박 리뷰 1: 보기 화면이 열린 채 로그인이 끊김 ──
// 실제 순서: 세션이 지워짐 → 보기 화면이 닫힘(정리) → 0ms 뒤 예약한 일 → 그 뒤에야 로그인 화면 이동이 history 에 반영돼요.
// 예약한 일이 돌 때 history.state 는 아직 우리 칸이라, 이것만 보고 back() 을 부르면 진행 중인 이동을 망가뜨려요.

test("리뷰 1 로그인이 끊겨 떠나는 중에 닫히면 칸을 빼지 않아요 — 뒤따르는 로그인 화면 이동이 그대로 끝나요", () => {
  const h = fakeHistory();
  const layer = createBackLayer(h.port);
  let closed = 0;
  const release = layer.open(() => closed++);
  assert.equal(h.at(), 1);

  h.startLeaving(); // 세션이 지워졌어요(만료 · 로그아웃 · 다른 탭 로그아웃)
  release(); // 화면이 비면서 보기 화면이 사라져요
  h.runDeferred(); // 0ms 뒤 — 이동은 아직 history 에 반영 전이라 state 는 우리 칸 그대로예요
  assert.equal(h.backCalls(), 0, "back() 을 부르지 않아요");
  h.replace({ page: "login" }); // 이제야 이동이 반영돼요(location.replace · router.replace)
  h.flush();

  assert.equal(h.backCalls(), 0);
  assert.equal(h.at(), 1);
  assert.deepEqual(h.top(), { page: "login" }, "로그인 화면에 있어요");
  assert.equal(closed, 0);
});

test("리뷰 1 닫힌 뒤 · 예약한 일이 돌기 전에 로그인이 끊겨도 칸을 빼지 않아요", () => {
  const h = fakeHistory();
  const layer = createBackLayer(h.port);
  const release = layer.open(() => {});
  release(); // 「닫기」로 닫힘 — 이때는 로그인 상태
  h.startLeaving(); // 예약한 일이 돌기 전에 세션이 지워짐
  h.runDeferred();
  assert.equal(h.backCalls(), 0);
  h.replace({ page: "login" });
  h.flush();
  assert.deepEqual(h.top(), { page: "login" });
});

test("리뷰 1 떠나는 중이 아니면 전처럼 칸을 빼요(대조)", () => {
  const h = fakeHistory();
  const layer = createBackLayer(h.port);
  layer.open(() => {})();
  h.runDeferred();
  assert.equal(h.backCalls(), 1);
  h.deliverPops();
  assert.equal(h.at(), 0);
});

// ── 화면 반박 리뷰 2: 우리 back() 을 부르고 그 popstate 를 받기 전의 짧은 틈 ──

test("리뷰 2 칸을 빼는 중(back 을 불렀고 popstate 전)에 다시 열리면 popstate 를 받은 뒤 새로 얹어요 — 보기 화면이 칸 없이 열려 있지 않아요", () => {
  const h = fakeHistory();
  const layer = createBackLayer(h.port);
  let closedA = 0;
  let closedB = 0;
  layer.open(() => closedA++)();
  h.runDeferred(); // back() 을 불렀어요 — popstate 는 아직
  assert.equal(h.backCalls(), 1);
  assert.equal((h.top() as Record<string, unknown>)[BACK_LAYER_KEY], true, "history.state 는 아직 우리 칸으로 보여요");

  const release = layer.open(() => closedB++); // 이 틈에 다시 열림
  assert.equal(h.length(), 2, "곧 빠질 칸 위에 또 얹지 않아요");
  h.deliverPops(); // 우리 popstate 도착 — 옛 칸이 빠지고 새 칸을 얹어요
  assert.equal(h.at(), 1, "새로 얹은 칸이 맨 위");
  assert.equal((h.top() as Record<string, unknown>)[BACK_LAYER_KEY], true);
  assert.equal(closedA + closedB, 0, "우리가 뺀 칸의 popstate 로 보기 화면이 닫히지 않아요");

  h.userBack(); // 뒤로 가기는 보기 화면만 닫아요(화면을 벗어나지 않아요)
  assert.equal(closedB, 1);
  assert.equal(h.at(), 0);
  release();
  h.flush();
  assert.equal(h.at(), 0);
});

test("리뷰 2 빼는 중에 열렸다가 popstate 전에 다시 닫히면 얹지도 빼지도 않아요", () => {
  const h = fakeHistory([{ page: "list" }, { page: "accounts" }]);
  const layer = createBackLayer(h.port);
  layer.open(() => {})();
  h.runDeferred();
  const release = layer.open(() => {});
  release();
  h.flush();
  assert.equal(h.backCalls(), 1, "back() 은 처음 닫을 때 한 번뿐");
  assert.equal(h.at(), 1, "계정 발급 화면에 그대로");
  assert.deepEqual(h.top(), { page: "accounts" });
});

test("닫히고 칸을 빼려던 참에 직원이 뒤로 가기를 누르면 한 칸만 가요(예약한 back 을 버려요)", () => {
  const h = fakeHistory([{ page: "list" }, { page: "accounts" }]);
  const layer = createBackLayer(h.port);
  layer.open(() => {})(); // 닫힘 — 예약만 걸린 상태
  h.port.back(); // 직원의 뒤로 가기
  h.deliverPops();
  h.flush();
  assert.equal(h.at(), 1, "계정 발급 화면에 그대로 — 그 앞 화면으로 넘어가지 않아요");
  assert.equal(h.backCalls(), 1);
});
