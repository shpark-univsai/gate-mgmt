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

  const port: HistoryPort = {
    state: () => stack[at],
    push: (state) => {
      stack.splice(at + 1); // 앞으로 가기 칸은 버려져요
      stack.push(state);
      at = stack.length - 1;
    },
    back: () => {
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
  };

  return {
    port,
    /** 지금 자리(0 = 처음 화면) */
    at: () => at,
    length: () => stack.length,
    top: () => stack[at],
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
