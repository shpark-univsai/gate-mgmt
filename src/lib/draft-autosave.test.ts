// 「작성 중」 명함 자동 저장 일정표(draft-autosave.ts) 시험 — `npm test`.
// 예시 값은 모두 지어낸 것이에요(공개 저장소 — 실제 고객 · 회사 · 번호 금지).
import assert from "node:assert/strict";
import { test } from "node:test";

import { createAutosaver, draftContentKey, photoTag, type AutosaveResult } from "./draft-autosave.ts";

/** 손으로 돌리는 타이머 */
function fakeTimers() {
  let next = 1;
  const pending = new Map<number, () => void>();
  return {
    setTimer: (fn: () => void) => {
      const id = next++;
      pending.set(id, fn);
      return id;
    },
    clearTimer: (h: unknown) => void pending.delete(h as number),
    /** 걸린 타이머를 모두 울려요 */
    fire() {
      const fns = [...pending.values()];
      pending.clear();
      fns.forEach((fn) => fn());
    },
    get count() {
      return pending.size;
    },
  };
}

/** 끝을 손으로 정하는 저장 */
function manualSave() {
  const calls: { value: string; resolve: (r: AutosaveResult) => void }[] = [];
  return {
    calls,
    save: (value: string) => new Promise<AutosaveResult>((resolve) => calls.push({ value, resolve })),
  };
}

const flush = () => new Promise<void>((r) => setImmediate(r));

function setup() {
  const timers = fakeTimers();
  const saver = manualSave();
  let current: string | null = "a";
  const autosave = createAutosaver<string>({
    delayMs: 2000,
    snapshot: () => (current === null ? null : { value: current, key: current }),
    save: saver.save,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  return {
    timers,
    saver,
    autosave,
    set: (v: string | null) => {
      current = v;
    },
  };
}

test("UG-451 입력이 멈추면 한 번만 저장해요(되풀이 예약은 마지막 것만)", async () => {
  const { timers, saver, autosave } = setup();
  autosave.schedule();
  autosave.schedule();
  autosave.schedule();
  assert.equal(timers.count, 1);
  timers.fire();
  assert.equal(saver.calls.length, 1);
  saver.calls[0].resolve("saved");
  await flush();
  assert.equal(autosave.saving, false);
});

test("UG-451 바뀐 것이 없으면 다시 보내지 않아요", async () => {
  const { timers, saver, autosave } = setup();
  autosave.saveNow();
  saver.calls[0].resolve("saved");
  await flush();
  autosave.schedule();
  timers.fire();
  autosave.saveNow();
  assert.equal(saver.calls.length, 1);
});

test("UG-451 보내는 동안 바뀌면 겹쳐 보내지 않고, 끝난 뒤 최신 값으로 한 번 더", async () => {
  const { saver, autosave, set } = setup();
  autosave.saveNow();
  set("b");
  autosave.saveNow();
  set("c");
  autosave.saveNow();
  assert.equal(saver.calls.length, 1, "보내는 중에는 하나만");
  saver.calls[0].resolve("saved");
  await flush();
  assert.equal(saver.calls.length, 2);
  assert.equal(saver.calls[1].value, "c", "중간 값(b)은 건너뛰고 최신 값");
  saver.calls[1].resolve("saved");
  await flush();
  assert.equal(saver.calls.length, 2);
});

test("UG-451 실패하면 같은 값으로 곧바로 되풀이하지 않고, 다음 변경 때 다시 해요", async () => {
  const { timers, saver, autosave, set } = setup();
  autosave.saveNow();
  saver.calls[0].resolve("failed");
  await flush();
  assert.equal(timers.count, 0, "실패만으로는 다시 예약하지 않아요");
  set("a2");
  autosave.schedule();
  timers.fire();
  assert.equal(saver.calls.length, 2);
  assert.equal(saver.calls[1].value, "a2");
});

test("UG-451 실패 뒤 같은 값이어도 다시 바뀌었다고 알리면 다시 보내요(성공한 적이 없으니까)", async () => {
  const { timers, saver, autosave } = setup();
  autosave.saveNow();
  saver.calls[0].resolve("failed");
  await flush();
  autosave.schedule();
  timers.fire();
  assert.equal(saver.calls.length, 2);
});

test("UG-451 저장이 예외를 던져도 실패로 보고 멈추지 않아요", async () => {
  const timers = fakeTimers();
  let n = 0;
  let v = "a";
  const autosave = createAutosaver<string>({
    delayMs: 10,
    snapshot: () => ({ value: v, key: v }),
    save: async () => {
      n++;
      if (n === 1) throw new Error("network");
      return "saved";
    },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  autosave.saveNow();
  await flush();
  assert.equal(autosave.saving, false);
  v = "b";
  autosave.saveNow();
  await flush();
  assert.equal(n, 2);
});

test("UG-451 남길 것이 없으면(snapshot null) 보내지 않아요", () => {
  const { saver, autosave, set } = setup();
  set(null);
  autosave.saveNow();
  assert.equal(saver.calls.length, 0);
});

test("UG-451 suspend 는 예약을 지우고 보내는 중인 저장이 끝날 때까지 기다려요 — 멈춘 동안은 보내지 않아요", async () => {
  const { timers, saver, autosave, set } = setup();
  autosave.saveNow();
  set("b");
  autosave.schedule();
  let suspended = false;
  let release: () => void = () => {};
  const p = autosave.suspend().then((r) => {
    suspended = true;
    release = r;
  });
  assert.equal(timers.count, 0, "예약은 지워요");
  await flush();
  assert.equal(suspended, false, "보내는 중이면 기다려요");
  saver.calls[0].resolve("saved");
  await p;
  assert.equal(suspended, true);
  assert.equal(saver.calls.length, 1, "멈춘 동안에는 「한 번 더」도 하지 않아요");
  autosave.saveNow();
  autosave.schedule();
  assert.equal(saver.calls.length, 1);
  assert.equal(timers.count, 0);
  // 다시 켜면 그사이 바뀐 값을 저장해요
  release();
  timers.fire();
  assert.equal(saver.calls.length, 2);
  assert.equal(saver.calls[1].value, "b");
});

test("UG-451 바뀐 것 없이 다시 켜기만 하면 보내지 않아요(닫을 때 저장 실패 뒤 같은 값을 곧바로 되풀이하지 않게)", async () => {
  const { timers, saver, autosave } = setup();
  autosave.saveNow();
  saver.calls[0].resolve("failed");
  const release = await autosave.suspend();
  release();
  assert.equal(timers.count, 0);
  timers.fire();
  assert.equal(saver.calls.length, 1);
});

test("UG-451 멈추며 지운 예약은 다시 켜면 저장해요", async () => {
  const { timers, saver, autosave } = setup();
  autosave.schedule();
  const release = await autosave.suspend();
  assert.equal(timers.count, 0);
  release();
  timers.fire();
  assert.equal(saver.calls.length, 1);
});

test("UG-451 F3 멈춤은 센 수 — 한쪽(보내기)이 풀어도 다른 쪽(닫을 때 저장)이 멈춰 둔 동안은 보내지 않아요", async () => {
  const { timers, saver, autosave, set } = setup();
  const closing = autosave.hold();
  const submitting = autosave.hold();
  set("b");
  autosave.schedule();
  autosave.saveNow();
  submitting();
  submitting(); // 두 번 불러도 한 번만 풀려요
  timers.fire();
  assert.equal(saver.calls.length, 0, "닫을 때 저장이 멈춰 둔 동안은 보내지 않아요");
  closing();
  timers.fire();
  assert.equal(saver.calls.length, 1);
  assert.equal(saver.calls[0].value, "b");
});

test("UG-451 suspend 는 보내는 중이 아니면 바로 끝나요", async () => {
  const { autosave } = setup();
  await autosave.suspend();
  assert.equal(autosave.saving, false);
});

test("UG-451 stop 뒤에는 어떤 저장도 시작하지 않아요(계정을 만든 뒤 · 지운 뒤 되살리지 않게)", async () => {
  const { timers, saver, autosave, set } = setup();
  autosave.saveNow();
  set("b");
  autosave.saveNow(); // 끝난 뒤 한 번 더 — stop 이면 하지 않아요
  const stopped = autosave.stop();
  saver.calls[0].resolve("saved");
  await stopped;
  assert.equal(saver.calls.length, 1);
  autosave.hold()();
  autosave.schedule();
  autosave.saveNow();
  timers.fire();
  assert.equal(saver.calls.length, 1);
  assert.equal(autosave.stopped, true);
});

test("UG-451 저장 결과가 stop(명함이 서버에서 없어짐)이면 스스로 꺼져요", async () => {
  const { saver, autosave, set } = setup();
  autosave.saveNow();
  saver.calls[0].resolve("stop");
  await flush();
  set("b");
  autosave.saveNow();
  assert.equal(saver.calls.length, 1);
  assert.equal(autosave.stopped, true);
});

test("UG-451 markSaved — 이어서 만든 명함을 그대로 열면 보내지 않아요", () => {
  const { saver, autosave } = setup();
  autosave.markSaved("a");
  autosave.saveNow();
  assert.equal(saver.calls.length, 0);
});

test("UG-451 내용 열쇠 — 한 번 올린 사진을 keepPhoto 로 보내도 같은 내용이에요", () => {
  const photo = "data:image/jpeg;base64,QUJDREVGR0g=";
  const first = draftContentKey({ company: "company-a", photo: "QUJDREVGR0g=" }, null);
  const later = draftContentKey({ company: "company-a", keepPhoto: true }, photo);
  assert.equal(first, later);
  // 칸 차례가 달라도 같은 내용
  assert.equal(draftContentKey({ name: "Hong", company: "company-a" }, null), draftContentKey({ company: "company-a", name: "Hong" }, null));
  // 칸 · 사진이 바뀌면 달라요
  assert.notEqual(draftContentKey({ company: "company-b", keepPhoto: true }, photo), later);
  assert.notEqual(draftContentKey({ company: "company-a" }, photo), later, "사진이 빠지면 달라요");
  assert.notEqual(draftContentKey({ company: "company-a", photo: "WFlaV1ZVVFNS" }, photo), later, "다른 사진");
});

test("UG-451 사진 표는 data URL · 순수 base64 를 같게 봐요", () => {
  assert.equal(photoTag("data:image/jpeg;base64,QUJD"), photoTag("QUJD"));
  assert.equal(photoTag(null), null);
  assert.equal(photoTag(""), null);
});
