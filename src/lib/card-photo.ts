// 명함 사진 기기 보관 (UG-431 후속). 읽은 글자(특히 이메일의 0 · O, 1 · l · I)를 명함과 다시 비교하려고,
// 줄인 사진(긴 변 1200px JPEG)을 이 브라우저(IndexedDB)에만 잠깐 둬요 — 서버로는 보내지 않아요.
// 문구 · 기간은 기획 가안이라 바뀔 수 있어요 — 이 파일의 상수만 고치면 돼요.
// 저장 · 읽기가 안 되는 브라우저(사파리 사생활 보호 모드, 용량 부족)에서는 조용히 넘어가요 — 발급은 막지 않아요.

/** 보관 기간(일). 지나면 목록을 불러올 때 지워요. */
export const CARD_PHOTO_KEEP_DAYS = 7;

/** 명함 사진 · 헷갈리는 글자 안내 문구(가안) */
export const CARD_PHOTO_TEXT = {
  scanHelp: `명함에서 이메일 · 이름 · 회사명 · 연락처를 읽어 아래 칸을 채웁니다. 명함 사진은 이 기기에만 ${CARD_PHOTO_KEEP_DAYS}일 보관하고 서버로 보내지 않습니다.`,
  confusable: "0 · O, 1 · l · I 는 명함과 한 번 더 비교해 주세요.",
  thumbLabel: "찍은 명함 크게 보기",
  listButton: "명함",
  viewerTitle: "찍은 명함",
  close: "닫기",
} as const;

const DB_NAME = "gate-mgmt-card-photos";
const STORE = "photos";
const DAY_MS = 24 * 60 * 60 * 1000;

/** 한 장. id = 발급 기록 번호, savedAt = 저장 시각(ms), dataUrl = 줄인 JPEG */
type PhotoRecord = { id: string; savedAt: number; dataUrl: string };

/** 보관 기한이 지났는지 */
export function isExpired(savedAt: number, now: number, days: number = CARD_PHOTO_KEEP_DAYS): boolean {
  return now - savedAt >= days * DAY_MS;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

/** 저장소 열기. 열 수 없으면 null(사생활 보호 모드 등) — 다음 호출 때 다시 시도해요. */
function openDb(): Promise<IDBDatabase | null> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase | null>((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          const store = req.result.createObjectStore(STORE, { keyPath: "id" });
          store.createIndex("savedAt", "savedAt");
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    }).then((db) => {
      if (!db) dbPromise = null;
      return db;
    });
  }
  return dbPromise;
}

/** 한 번의 거래. 실패하면 undefined — 부르는 쪽은 결과가 없을 때를 늘 생각해요. */
async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  try {
    const db = await openDb();
    if (!db) return undefined;
    return await new Promise<T | undefined>((resolve) => {
      const tx = db.transaction(STORE, mode);
      const req = work(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => resolve(undefined);
      tx.onabort = () => resolve(undefined);
    });
  } catch {
    return undefined;
  }
}

/** 발급 기록 번호로 저장(같은 번호면 바꿔 써요). */
export async function saveCardPhoto(id: string, dataUrl: string): Promise<void> {
  await run("readwrite", (s) => s.put({ id, savedAt: Date.now(), dataUrl } satisfies PhotoRecord));
}

/** 사진(data URL). 없거나 기한이 지났으면 null(지난 것은 지워요). */
export async function loadCardPhoto(id: string): Promise<string | null> {
  const rec = await run<PhotoRecord | undefined>("readonly", (s) => s.get(id));
  if (!rec) return null;
  if (isExpired(rec.savedAt, Date.now())) {
    void deleteCardPhoto(id);
    return null;
  }
  return rec.dataUrl;
}

export async function deleteCardPhoto(id: string): Promise<void> {
  await run("readwrite", (s) => s.delete(id));
}

/**
 * 목록을 불러올 때: 기한이 지난 사진과, 보이는 줄 가운데 고객이 이미 로그인한(사용 중) 계정의 사진을 지우고
 * 남은 사진의 발급 번호를 돌려줘요(「명함」 버튼을 보일 줄).
 */
export async function syncCardPhotos(rows: readonly { id: string; status: string }[]): Promise<Set<string>> {
  const cutoff = Date.now() - CARD_PHOTO_KEEP_DAYS * DAY_MS;
  await run("readwrite", (s) => {
    s.index("savedAt").openCursor(IDBKeyRange.upperBound(cutoff)).onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
    for (const r of rows) if (r.status === "in_use") s.delete(r.id);
  });
  const keys = await run<IDBValidKey[]>("readonly", (s) => s.getAllKeys());
  return new Set((keys ?? []).map(String));
}
