// 명함 사진 (UG-431). 읽은 글자(특히 이메일의 0 · O, 1 · l · I)를 명함과 다시 비교하려고, 줄인 사진을 「계정 만들기」 창에 둬요.
// 기기에는 저장하지 않아요(기획 16841). 계정을 만들면(메일 발송까지) 바로 지우고, 메일 주소 오류로 주소를 고치는 동안에는 남겨 둬요.
// 계정을 만들지 않고 창을 닫으면 「작성 중」 명함과 함께 서버에 남겨요(기획 16864 — card-draft.ts · 계정을 만들거나 30일이면 서버가 지움).

/** 명함 사진 · 헷갈리는 글자 안내 문구 */
export const CARD_PHOTO_TEXT = {
  scanHelp: "명함에서 이메일 · 연락처를 읽어 채웁니다. 이름 · 회사명은 읽은 줄을 눌러 넣어 주세요. 명함 사진은 계정을 만들면 지웁니다.",
  /** 휴대폰(폭 640 이하)용 한 줄 안내(UG-453) — PC · 아이패드는 위 scanHelp 그대로 */
  scanHelpShort: "명함의 이메일 · 연락처를 읽어 채웁니다.",
  confusable: "0 · O, 1 · l · I 는 명함과 한 번 더 비교해 주세요.",
  /** 명함에서 읽은 이메일 — 앞에 이메일 전체(굵게)가 붙어요(「user1@company-a.com — 명함과 같은지 확인해 주세요.」, UG-451) */
  emailCheck: "명함과 같은지 확인해 주세요.",
  thumbLabel: "찍은 명함 크게 보기",
  viewerTitle: "찍은 명함",
  close: "닫기",
} as const;

/**
 * 예전 판들이 기기에 만든 명함 저장소 이름 — PR #17(7일 사진 보관)의 gate-mgmt-card-photos,
 * 「작성하던 명함」 기기 보관 시안(기획 16861, 16864 에서 서버 보관으로 바뀌어 빠짐)의 gate-mgmt-card-draft
 */
const LEGACY_DB_NAMES = ["gate-mgmt-card-photos", "gate-mgmt-card-draft"];
let legacyPurged = false;

/**
 * 정리용 — 기기 보관을 없앤 뒤(UG-431 · 기획 16841 · 16864) 예전 판이 dev 기기에 남긴 명함 저장소를 지워요. 앱을 열 때 한 번.
 * 예전 판의 보관 기간이 7일(사진) · 24시간(작성하던 명함)이었으므로, 예전 판이 나간 모든 환경(dev 등)에 이 변경이 반영되고
 * 7일이 지나면 이 함수와 호출을 지워도 돼요.
 * 저장소가 없거나 지울 수 없는 브라우저(사생활 보호 모드 등)는 조용히 넘어가요.
 */
export function purgeLegacyCardPhotos(): void {
  if (legacyPurged) return;
  legacyPurged = true;
  try {
    if (typeof indexedDB === "undefined") return;
    for (const name of LEGACY_DB_NAMES) {
      const req = indexedDB.deleteDatabase(name);
      req.onerror = () => undefined;
      req.onblocked = () => undefined;
    }
  } catch {
    // 지우지 못해도 화면은 그대로
  }
}
