// 주소 고쳐 새로 만들기(recreate.ts) · 명함 사진 저장 결과 표시(card-photo.ts) 시험 — `npm test`. UG-455 기획 17099-4 · 5 · 7.
import assert from "node:assert/strict";
import { test } from "node:test";

import { CARD_PHOTO_TEXT, cancelTargetsText, cardPhotoNotSaved, isCardPhotoStatus } from "./card-photo.ts";
import { RECREATE_TEXT, isSourceCancel, newAccountMailText, oldIssueAfterCreate, oldIssueLeft, oldIssueRevoked } from "./recreate.ts";

test("기획 17099-5 서버가 사진을 받지 않았거나 저장하지 못했을 때만 「명함 사진은 저장하지 못했습니다」", () => {
  assert.equal(cardPhotoNotSaved({ cardPhoto: "rejected" }), true);
  assert.equal(cardPhotoNotSaved({ cardPhoto: "failed" }), true);
});

test("기획 17099-5 정책상 남기지 않은 경우(보관 꺼짐 · 보관 시작 전에 찍은 명함)에는 띄우지 않아요", () => {
  assert.equal(cardPhotoNotSaved({ cardPhoto: "policy" }), false);
});

test("기획 17099-5 사진을 보내지 않은 발급 · 남긴 발급에는 아무 표시도 없어요", () => {
  assert.equal(cardPhotoNotSaved({ cardPhoto: "none" }), false);
  assert.equal(cardPhotoNotSaved({ cardPhoto: "kept" }), false);
  assert.equal(cardPhotoNotSaved({}), false, "예전 서버(결과를 주지 않음)도 표시 없음");
});

test("기획 17099-5 서버가 사진 때문에 요청을 거절해 사진 없이 다시 보내 만든 경우는 서버 값과 무관하게 알려요", () => {
  assert.equal(cardPhotoNotSaved({ photoRejected: true, cardPhoto: "none" }), true);
  assert.equal(cardPhotoNotSaved({ photoRejected: true, cardPhoto: "policy" }), true);
  assert.equal(cardPhotoNotSaved({ photoRejected: true }), true, "예전 서버");
});

test("서버 값이 아는 값일 때만 받아요", () => {
  for (const v of ["kept", "none", "policy", "rejected", "failed"]) assert.equal(isCardPhotoStatus(v), true);
  for (const v of ["KEPT", "", null, undefined, true, "skipped"]) assert.equal(isCardPhotoStatus(v), false);
});

test("기획 17099-4 발급 취소 「삭제 대상」 — 명함 사진이 있는 줄만 「명함 사진」을 붙여요", () => {
  assert.equal(cancelTargetsText({}), "계정 · 데모 프로젝트");
  assert.equal(cancelTargetsText({ hasCardPhoto: false }), "계정 · 데모 프로젝트");
  assert.equal(cancelTargetsText({ hasCardPhoto: true }), `계정 · 데모 프로젝트 · ${CARD_PHOTO_TEXT.cancelTarget}`);
  assert.equal(cancelTargetsText({ hasCardPhoto: true }), "계정 · 데모 프로젝트 · 명함 사진");
});

test("기획 17099-4 데모 기록 수가 있으면 전과 같은 자리에(데모 프로젝트 뒤) 두고 명함 사진은 맨 끝", () => {
  assert.equal(cancelTargetsText({ demoRecords: 0 }), "계정 · 데모 프로젝트(데모 기록 0건)");
  assert.equal(cancelTargetsText({ demoRecords: 3, hasCardPhoto: true }), "계정 · 데모 프로젝트(데모 기록 3건) · 명함 사진");
});

test("기획 17099-7 서버가 옛 발급을 취소했으면(이미 취소돼 있던 것 포함) 화면은 따로 취소하지 않아요", () => {
  assert.equal(oldIssueAfterCreate("cancelled"), "done");
  assert.equal(oldIssueAfterCreate("already_cancelled"), "done");
});

test("기획 17099-7 서버가 옛 줄을 정리하지 못했으면 알리고 다시 취소하게 해요 — 조용히 넘어가지 않아요", () => {
  assert.equal(oldIssueAfterCreate("failed"), "left");
});

test("기획 17099-7 예전 서버(결과를 주지 않음)면 전처럼 화면이 발급 취소를 보내요", () => {
  assert.equal(oldIssueAfterCreate(undefined), "legacy");
});

test("기획 17099-7 화면이 보낸 취소가 실패하면 옛 발급이 남은 것 — 이미 취소된 줄(not_found)은 남지 않은 것", () => {
  assert.equal(oldIssueLeft({ ok: true }), false);
  assert.equal(oldIssueLeft({ ok: false, reason: "not_found" }), false);
  assert.equal(oldIssueLeft({ ok: false, reason: "failed" }), true);
  assert.equal(oldIssueLeft({ ok: false, reason: "in_use" }), true);
  assert.equal(oldIssueLeft({ ok: false, reason: "closing" }), true);
});

test("옛 발급 취소 결과도 아는 값일 때만 받아요", () => {
  for (const v of ["cancelled", "already_cancelled", "failed"]) assert.equal(isSourceCancel(v), true);
  for (const v of ["CANCELLED", "", null, undefined, "done"]) assert.equal(isSourceCancel(v), false);
});

test("리뷰 M1 새 계정을 만들지 못했는데 옛 발급의 링크가 이미 막혔으면(revoked) 알려요 — 어떤 실패 까닭이든", () => {
  assert.equal(oldIssueRevoked({ ok: false, sourceCancel: "revoked" }), true);
});

test("리뷰 M1 옛 발급이 그대로인 실패 · 예전 서버(값 없음) · 성공 응답에는 알리지 않아요", () => {
  assert.equal(oldIssueRevoked({ ok: false }), false);
  assert.equal(oldIssueRevoked({ ok: false, sourceCancel: "failed" }), false);
  assert.equal(oldIssueRevoked({ ok: true, sourceCancel: "cancelled" }), false);
  assert.equal(oldIssueRevoked({ ok: true, sourceCancel: "revoked" }), false);
});

test("리뷰 M1 성공 응답의 옛 발급 결과에는 revoked 가 없어요(실패 응답 전용 값)", () => {
  assert.equal(isSourceCancel("revoked"), false);
});

test("화면 리뷰 3 이 창에서 사진 저장 실패를 이미 겪었으면 주소를 고쳐 재발송한 완료 알림에도 같은 줄 — 서버는 옮길 사진이 없어 none", () => {
  assert.equal(cardPhotoNotSaved({ cardPhoto: "none" }, true), true);
  assert.equal(cardPhotoNotSaved({ cardPhoto: "policy" }, true), true);
  assert.equal(cardPhotoNotSaved({}, true), true, "예전 서버");
});

test("화면 리뷰 3 서버가 남겼다고 답하면(kept) 앞서 실패했어도 표시 없음, 앞서 실패한 적이 없으면 전과 같아요", () => {
  assert.equal(cardPhotoNotSaved({ cardPhoto: "kept" }, true), false);
  assert.equal(cardPhotoNotSaved({ cardPhoto: "none" }, false), false);
  assert.equal(cardPhotoNotSaved({ cardPhoto: "failed" }, false), true);
});

test("기획 17120-2 옛 발급 취소 실패 창의 「새 계정」 줄 — 메일을 보냈으면 (메일 보냄), 못 보냈으면 (메일 보내지 못함)", () => {
  assert.equal(newAccountMailText(true), "(메일 보냄)");
  assert.equal(newAccountMailText(false), "(메일 보내지 못함)");
  assert.equal(RECREATE_TEXT.newAccountLabel, "새 계정");
  assert.equal(RECREATE_TEXT.leftOldLabel, "취소하지 못한 옛 발급");
});
