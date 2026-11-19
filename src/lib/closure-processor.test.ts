// 계정 해지 처리자 칸(closure-processor.ts, UG-468) 시험.
import assert from "node:assert/strict";
import { test } from "node:test";

import { SELF_PROCESSOR_LABEL, processorText } from "./closure-processor.ts";

test("직원이 처리한 줄은 직원 이메일의 @ 앞", () => {
  assert.equal(processorText({ processedBy: "staff1@example.com", requestedVia: "STAFF" }), "staff1");
});

test("고객이 콘솔에서 직접 탈퇴한 줄은 「본인(콘솔)」", () => {
  assert.equal(processorText({ processedBy: null, requestedVia: "SELF" }), SELF_PROCESSOR_LABEL);
});

test("예전 서버(requestedVia 없음)는 지금처럼 직원 이메일 · 없으면 빈칸", () => {
  assert.equal(processorText({ processedBy: "staff1@example.com", requestedVia: null }), "staff1");
  assert.equal(processorText({ processedBy: null, requestedVia: null }), "");
});
