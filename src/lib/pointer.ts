/**
 * 손가락으로 쓰는 기기(휴대폰 · 아이패드)인지 — 주 입력이 굵은 포인터(pointer: coarse).
 * 이런 기기에서는 칸에 초점을 주면 화상 키보드가 올라와 화면을 가려요(UG-453) — 저절로 초점을 주지 않을 때 써요.
 */
export function isTouchPrimary(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
}
