// 명함 사진 (UG-431 · UG-455). 읽은 글자(특히 이메일의 0 · O, 1 · l · I)를 명함과 다시 비교하려고, 줄인 사진을 「계정 만들기」 창에 둬요.
// 기기에는 저장하지 않아요(기획 16841). 계정을 만들면 그 사진을 계정과 함께 서버에 보내 남기고(UG-455), 목록 ⋮ 「명함 보기」로 다시 봐요.
// 창은 계정을 만들고 나면 들고 있던 사진을 메모리에서 비우고, 메일 주소 오류로 주소를 고치는 동안에는 남겨 둬요.
// 계정을 만들지 않고 창을 닫으면 「작성 중」 명함과 함께 서버에 남겨요(기획 16864 — card-draft.ts · 계정을 만들거나 30일이면 서버가 지움).

/** 명함 사진 · 헷갈리는 글자 안내 문구 */
export const CARD_PHOTO_TEXT = {
  // 이름 · 회사명은 확실할 때만 채워요(UG-451 기획 17100) — 전의 「읽은 줄을 눌러 넣어 주세요」는 맞지 않아 바꿨어요
  scanHelp: "명함에서 이메일 · 연락처를 읽어 채웁니다. 이름 · 회사명은 확실할 때만 채우니 비어 있으면 넣어 주세요.",
  /** 휴대폰(폭 640 이하)용 한 줄 안내(UG-453) — PC · 아이패드는 위 scanHelp 그대로 */
  scanHelpShort: "명함의 이메일 · 연락처를 읽어 채웁니다.",
  confusable: "0 · O, 1 · l · I 는 명함과 한 번 더 비교해 주세요.",
  /** 명함에서 읽은 이메일 — 앞에 이메일 전체(굵게)가 붙어요(「user1@company-a.com — 명함과 같은지 확인해 주세요.」, UG-451) */
  emailCheck: "명함과 같은지 확인해 주세요.",
  thumbLabel: "찍은 명함 크게 보기",
  viewerTitle: "찍은 명함",
  /** 크게 보기 맨 위 이메일 줄(기획 17099-2) — 화면에는 이메일만 보이고, 낭독기에는 이 말을 앞에 읽어 줘요 */
  viewerEmailLabel: "이메일",
  close: "닫기",
  /** 크게 보기 버튼(UG-455) — − · + 는 글자 대신 기호라 읽어 줄 이름 */
  zoomIn: "확대",
  zoomOut: "축소",
  fit: "맞춤",
  loading: "명함 사진을 불러오는 중…",
  /** 목록 ⋮ 메뉴(UG-455) — 첫 로그인 전 · 사용 중이고 서버에 사진이 있는 계정만 */
  listView: "명함 보기",
  notFound: "명함 사진이 없습니다",
  notFoundDetail: "목록을 새로 불러왔습니다",
  loadFailed: "명함 사진을 불러오지 못했습니다",
  loadFailedDetail: "잠시 후 다시 시도해 주세요",
  /** 계정은 만들었지만 서버가 사진을 받지 않았거나 저장하지 못함(기획 17099-5) — 「계정을 만들었습니다」 알림 아래 줄 */
  notSaved: "명함 사진은 저장하지 못했습니다",
  /** 알림 아래 줄(기획 17124) — 사진이 서버에 없으니 명함 실물을 남겨 두라고. 이 알림은 직원이 닫을 때까지 남아요 */
  notSavedDetail: "명함 실물은 따로 보관해 주세요",
  /** 발급 취소 확인 창 「삭제 대상」에 붙는 말(기획 17099-4) — 명함 사진이 있는 줄만 */
  cancelTarget: "명함 사진",
} as const;

/**
 * 서버가 알려 준 명함 사진 저장 결과(UG-455 기획 17099-5, 서버 cardPhoto).
 * kept = 남김 / none = 남길 사진이 없었음 / policy = 정책상 남기지 않음(서버 보관이 꺼져 있음 · 보관 시작 전에 찍은 명함)
 * rejected = 서버가 사진을 받지 않음(형식 · 크기) / failed = 저장하지 못함
 */
export type CardPhotoStatus = "kept" | "none" | "policy" | "rejected" | "failed";

const CARD_PHOTO_STATUSES: readonly string[] = ["kept", "none", "policy", "rejected", "failed"] satisfies CardPhotoStatus[];
export const isCardPhotoStatus = (v: unknown): v is CardPhotoStatus => typeof v === "string" && CARD_PHOTO_STATUSES.includes(v);

/**
 * 「명함 사진은 저장하지 못했습니다」를 보여 줄지(기획 17099-5) — 서버가 사진을 받지 않았거나(rejected) 저장하지 못했을 때(failed)만.
 * 정책상 남기지 않은 것(policy) · 사진을 보내지 않은 발급(none) · 남긴 것(kept)에는 보여 주지 않아요.
 * photoRejected = 서버가 사진 때문에 요청을 거절해(너무 큼 · 형식) 사진 없이 한 번 더 보내 만든 경우 — 이때 서버는 사진을 본 적이 없어
 * none 으로 답하므로 화면이 따로 알아요. 예전 서버(cardPhoto 를 주지 않음)는 이 경우만 알 수 있어요.
 * lostBefore = 이 창에서 앞서 만든 계정의 사진 저장이 이미 실패했어요(화면 반박 리뷰 3). 그 뒤 주소를 고쳐 재발송하면 옮길 사진이 없어
 * 서버는 none 으로 답하지만 새 계정에도 사진은 없으니 같은 줄을 보여 줘요 — 서버가 남겼다고(kept) 답한 때만 빼요.
 */
export function cardPhotoNotSaved(result: { cardPhoto?: CardPhotoStatus; photoRejected?: boolean }, lostBefore = false): boolean {
  if (result.photoRejected === true || result.cardPhoto === "rejected" || result.cardPhoto === "failed") return true;
  return lostBefore && result.cardPhoto !== "kept";
}

/**
 * 발급 취소 확인 창의 「삭제 대상」(기획 17099-4) — 「계정 · 데모 프로젝트(데모 기록 N건) · 명함 사진」.
 * 데모 기록 수는 서버가 줄 때만, 명함 사진은 서버에 사진이 있는 줄(hasCardPhoto)만 붙여요.
 */
export function cancelTargetsText(account: { demoRecords?: number; hasCardPhoto?: boolean }): string {
  const demo = `데모 프로젝트${account.demoRecords !== undefined ? `(데모 기록 ${account.demoRecords}건)` : ""}`;
  return ["계정", demo, ...(account.hasCardPhoto === true ? [CARD_PHOTO_TEXT.cancelTarget] : [])].join(" · ");
}

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
