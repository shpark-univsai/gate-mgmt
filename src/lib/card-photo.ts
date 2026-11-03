// 명함 사진 (UG-431). 읽은 글자(특히 이메일의 0 · O, 1 · l · I)를 명함과 다시 비교하려고, 줄인 사진을 「계정 만들기」 창에 둬요.
// 사진은 서버로 보내지 않아요. 창을 닫아도 「작성하던 명함」(사진 · 칩 · 네 칸 · 메일 언어)은 이 기기 브라우저에 하나만 남겨
// 다시 열 때 이어서 만들지 물어요(기획 16861). 지우는 때: 계정을 만들었을 때(메일 발송까지) · [지우기] · 새 명함을 찍었을 때 ·
// 로그아웃할 때(직접 · 로그인 만료) · 찍은 지 24시간이 지났을 때(창 · 페이지를 열 때 확인).
// 메일 주소 오류로 주소를 고치는 중(이미 만든 계정)인 명함은 「작성하던 명함」이 아니에요 — 창 메모리에만 두고 창을 닫으면 사라져요.
import type { MailLanguage } from "./api";
import type { Chip, ScanLinks, ScanValues } from "./card-scan";

/** 명함 사진 · 헷갈리는 글자 안내 문구 */
export const CARD_PHOTO_TEXT = {
  scanHelp: "명함에서 이메일 · 연락처를 읽어 채웁니다. 이름 · 회사명은 읽은 줄을 눌러 넣어 주세요.",
  /** 명함 사진 아래 */
  photoNote: "명함 사진은 계정을 만들거나 지우기를 누르면 바로 지워요.",
  draftFound: "작성하던 명함이 있어요.",
  draftResume: "이어서 만들기",
  draftDiscard: "지우기",
  confusable: "0 · O, 1 · l · I 는 명함과 한 번 더 비교해 주세요.",
  /** 명함에서 읽은 이메일 — 앞에 도메인(굵게)이 붙어요(「company-a.com — 명함과 같은지 확인해 주세요.」) */
  domainCheck: "명함과 같은지 확인해 주세요.",
  thumbLabel: "찍은 명함 크게 보기",
  viewerTitle: "찍은 명함",
  close: "닫기",
} as const;

/** 예전(PR #17, 7일 기기 보관) 저장소 이름 — 아래 작성하던 명함 저장소와 다른 이름이에요 */
const LEGACY_DB_NAME = "gate-mgmt-card-photos";
let legacyPurged = false;

/**
 * 정리용 — 기기 보관을 없앤 뒤(UG-431 · 기획 16841) 예전 판이 dev 기기에 남긴 명함 사진 저장소를 지워요. 앱을 열 때 한 번.
 * 예전 판의 보관 기간이 7일이었으므로, 예전 판이 나간 모든 환경(dev 등)에 이 변경이 반영되고 7일이 지나면 이 함수와 호출을 지워도 돼요.
 * 저장소가 없거나 지울 수 없는 브라우저(사생활 보호 모드 등)는 조용히 넘어가요.
 */
export function purgeLegacyCardPhotos(): void {
  if (legacyPurged) return;
  legacyPurged = true;
  try {
    if (typeof indexedDB === "undefined") return;
    const req = indexedDB.deleteDatabase(LEGACY_DB_NAME);
    req.onerror = () => undefined;
    req.onblocked = () => undefined;
  } catch {
    // 지우지 못해도 화면은 그대로
  }
}

/** 작성하던 명함 — 이 기기 브라우저에 하나만. owner = 찍은 직원(로그인 이메일, 소문자), takenAt = 찍은 시각(ms) */
export type CardDraft = {
  owner: string;
  takenAt: number;
  photo: string | null;
  scan: { chips: Chip[]; links: ScanLinks } | null;
  values: ScanValues;
  language: MailLanguage;
};

/** 찍은 뒤 이만큼 지나면 지워요 */
export const CARD_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
const DRAFT_DB_NAME = "gate-mgmt-card-draft";
const DRAFT_STORE = "draft";
const DRAFT_KEY = "current";

// IndexedDB 를 쓸 수 없는 브라우저(사생활 보호 모드 등)에서는 이 탭의 메모리에만 둬요 — 새로고침하면 사라져요.
let memoryDraft: CardDraft | null = null;
let dbBroken = false;
// 로그아웃(dropCardDrafts)마다 올려요 — 그 전에 부른 쓰기가 늦게 돌아 지운 명함을 되살리지 않게
let generation = 0;
// 읽기 · 쓰기 · 지우기를 부른 순서대로 처리해요(지운 뒤에 앞선 쓰기가 늦게 끝나 되살아나지 않게)
let queue: Promise<unknown> = Promise.resolve();

function inQueue<T>(run: () => Promise<T>): Promise<T> {
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (dbBroken || typeof indexedDB === "undefined") return reject(new Error("no indexedDB"));
    const req = indexedDB.open(DRAFT_DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DRAFT_STORE);
    req.onsuccess = () => {
      const db = req.result;
      // 다른 탭이 저장소를 지우려 하면(로그아웃) 바로 놓아 줘요
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("blocked"));
  });
}

/** 저장소 하나에 한 번 쓰기 · 읽기. 실패하면 이후로는 메모리만 써요. */
async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch (e) {
    dbBroken = true;
    throw e;
  }
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(DRAFT_STORE, mode);
      const req = run(tx.objectStore(DRAFT_STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

const sameOwner = (draft: CardDraft, owner: string) => draft.owner === owner.trim().toLowerCase();
const expired = (draft: CardDraft, now: number) => !(now - draft.takenAt < CARD_DRAFT_TTL_MS) || draft.takenAt > now + 60_000;

/**
 * 이 직원의 작성하던 명함(없으면 null). 24시간이 지났거나 다른 직원 것이면 지우고 null —
 * 공용 기기에서 다른 직원이 로그인했다면 앞 직원의 로그인은 이미 끝났어요(같은 브라우저의 로그인은 하나뿐).
 */
export function loadCardDraft(owner: string): Promise<CardDraft | null> {
  return inQueue(async () => {
    let draft: CardDraft | null = memoryDraft;
    if (!dbBroken) {
      try {
        draft = ((await withStore("readonly", (s) => s.get(DRAFT_KEY))) as CardDraft | undefined) ?? null;
      } catch {
        draft = memoryDraft;
      }
    }
    if (!draft) return null;
    if (!sameOwner(draft, owner) || expired(draft, Date.now())) {
      await removeNow();
      return null;
    }
    return draft;
  });
}

/** 작성하던 명함을 남겨요(하나만 — 앞 것을 바꿔요). owner 는 소문자로. */
export function saveCardDraft(draft: CardDraft): void {
  const value: CardDraft = { ...draft, owner: draft.owner.trim().toLowerCase() };
  const asked = generation;
  void inQueue(async () => {
    if (asked !== generation) return;
    memoryDraft = value;
    if (dbBroken) return;
    try {
      await withStore("readwrite", (s) => s.put(value, DRAFT_KEY));
    } catch {
      // 기기에 남기지 못하면 메모리에만(이 탭에서 창을 다시 열 때까지)
    }
  });
}

async function removeNow(): Promise<void> {
  memoryDraft = null;
  if (dbBroken) return;
  try {
    await withStore("readwrite", (s) => s.delete(DRAFT_KEY));
  } catch {
    // 지우지 못해도 다음에 열 때 24시간 · 직원 확인에서 다시 지워요
  }
}

/** 작성하던 명함을 지워요(계정을 만들었을 때 · [지우기] · 새 명함을 찍었을 때). */
export function clearCardDraft(): Promise<void> {
  return inQueue(removeNow);
}

/**
 * 로그아웃(직접 · 로그인 만료 · 권한 없어짐)할 때 — 작성하던 명함 저장소를 통째로 지워요.
 * 곧 화면을 옮기므로 기다리지 않고 바로 요청해요(열린 연결은 versionchange 로 닫혀요). 다음 로그인 · 페이지 열기 때도 직원 · 24시간을 다시 봐요.
 */
export function dropCardDrafts(): void {
  generation += 1;
  memoryDraft = null;
  try {
    if (typeof indexedDB === "undefined") return;
    const req = indexedDB.deleteDatabase(DRAFT_DB_NAME);
    req.onerror = () => undefined;
    req.onblocked = () => undefined;
  } catch {
    // 지우지 못해도 다음에 열 때 24시간 · 직원 확인에서 지워요
  }
}
