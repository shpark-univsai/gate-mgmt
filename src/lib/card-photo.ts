// 명함 사진 (UG-431). 읽은 글자(특히 이메일의 0 · O, 1 · l · I)를 명함과 다시 비교하려고, 줄인 사진을 「계정 만들기」 창에만 둬요.
// 사진은 창의 상태(메모리)에만 있어요 — 서버로 보내지 않고 기기에도 저장하지 않아요(기획 16841).
// 계정을 만들면(메일 발송까지) 바로 지우고, 메일 주소 오류로 주소를 고치는 동안에는 남겨 두며, 창을 닫으면 지워요.

/** 명함 사진 · 헷갈리는 글자 안내 문구 */
export const CARD_PHOTO_TEXT = {
  scanHelp: "명함에서 이메일 · 이름 · 회사명 · 연락처를 읽어 아래 칸을 채웁니다. 명함 사진은 계정을 만들면 바로 지웁니다.",
  confusable: "0 · O, 1 · l · I 는 명함과 한 번 더 비교해 주세요.",
  /** 명함에서 읽은 이메일 — 앞에 도메인(굵게)이 붙어요(「univs.ai — 명함과 같은지 확인해 주세요.」) */
  domainCheck: "명함과 같은지 확인해 주세요.",
  thumbLabel: "찍은 명함 크게 보기",
  viewerTitle: "찍은 명함",
  close: "닫기",
} as const;

/** 예전(PR #17, 7일 기기 보관) 저장소 이름 */
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
