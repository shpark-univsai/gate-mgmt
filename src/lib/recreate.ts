// 주소를 고쳐 「재발송」(주소 고쳐 새로 만들기 — UG-455 기획 17099-7): 고친 주소로 새 계정을 만들고 잘못된 주소의 옛 발급은 취소해요.
// 화면은 요청을 한 번만 보내요(계정 만들기에 sourceIssuanceId + cancelSource). 순서는 서버가 책임져요 —
// 옛 발급의 링크부터 막고(계정 삭제 · 데모 파기) → 새 계정을 만들고 → 옛 발급 줄을 정리해요.
// 서버가 옛 줄 정리만 못 했으면(sourceCancel = failed) 화면이 알리고 다시 취소할 수 있게 해요 — 「계정을 만들었습니다」로만 끝내지 않아요.

/** 옛 발급 취소 안내 문구 */
export const RECREATE_TEXT = {
  /** 새 계정은 만들었는데 옛 발급 줄을 취소하지 못함 — 창에 남아 [닫기] [다시 시도] */
  oldCancelFailed: "새 계정은 만들었지만 옛 발급을 취소하지 못했습니다. [다시 시도]를 누르거나 목록의 ⋮ 「발급 취소」로 취소해 주세요.",
  /** 옛 발급을 취소할 수 없어(고객이 이미 로그인 · 해지 처리 중) 서버가 새 계정을 만들지 않음 — 버튼 위 안내 */
  sourceBlocked: "옛 발급을 취소할 수 없어 새 계정을 만들지 않았습니다. 목록에서 옛 발급의 상태를 확인해 주세요.",
  retry: "다시 시도",
  retrying: "취소하는 중…",
} as const;

/**
 * 서버가 알려 준 옛 발급 취소 결과(서버 sourceCancel).
 * cancelled = 이 요청이 취소함 / already_cancelled = 이미 취소돼 있었음(같은 요청을 다시 보냄 · 다른 직원이 먼저 취소)
 * failed = 옛 발급의 계정 · 데모는 지웠지만(보낸 메일의 링크는 쓸 수 없음) 목록의 옛 줄을 취소로 바꾸지 못함
 */
export type SourceCancel = "cancelled" | "already_cancelled" | "failed";

const SOURCE_CANCELS: readonly string[] = ["cancelled", "already_cancelled", "failed"] satisfies SourceCancel[];
export const isSourceCancel = (v: unknown): v is SourceCancel => typeof v === "string" && SOURCE_CANCELS.includes(v);

/**
 * 새 계정을 만든 뒤 옛 발급을 어떻게 할지.
 * done = 서버가 취소했어요(이미 취소돼 있던 것 포함) — 더 할 일이 없어요
 * left = 서버가 옛 줄을 정리하지 못했어요 — 알리고 다시 취소하게 해요
 * legacy = 예전 서버(한 요청으로 취소하지 않아 결과를 주지 않음) — 전처럼 화면이 발급 취소를 따로 보내요
 */
export function oldIssueAfterCreate(sourceCancel: SourceCancel | undefined): "done" | "left" | "legacy" {
  if (sourceCancel === undefined) return "legacy";
  return sourceCancel === "failed" ? "left" : "done";
}

/**
 * 화면이 보낸 발급 취소(예전 서버 · [다시 시도])가 끝난 뒤에도 옛 발급이 남았는지.
 * 이미 취소된 줄(not_found)은 남지 않은 것으로 봐요 — 또 취소하다 오류로 보이지 않게.
 */
export function oldIssueLeft(result: { ok: true } | { ok: false; reason: string }): boolean {
  return !result.ok && result.reason !== "not_found";
}
