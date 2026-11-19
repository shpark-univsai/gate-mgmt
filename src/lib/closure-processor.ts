// 계정 해지 목록의 처리자 칸(UG-468). 고객이 콘솔에서 직접 탈퇴한 기록은 실행한 직원이 없어요(processedBy null) —
// 빈칸이면 직원이 처리한 줄과 헷갈리므로 「본인(콘솔)」로 보여요. 화면에 기대지 않는 순수 함수만 둬요(closure-processor.test.ts).
import { handle } from "./format.ts";
import type { ClosureRequestedVia } from "./api";

export const SELF_PROCESSOR_LABEL = "본인(콘솔)";

export function processorText(c: { processedBy: string | null; requestedVia: ClosureRequestedVia | null }): string {
  if (c.requestedVia === "SELF") return SELF_PROCESSOR_LABEL;
  return handle(c.processedBy);
}
