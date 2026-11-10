// 옆으로 미는 줄(휴대폰 상태 칩)의 오른쪽에 아직 가려진 내용이 남았는지(UG-453 기획 17110-3).
// 남아 있는 동안만 줄 끝을 흐리게 해서 「옆으로 밀 수 있다」를 알려요 — 끝까지 밀면 사라져요.

/** 이만큼 덜 밀린 것은 끝까지 민 것으로 봐요(px) — scrollLeft 는 소수, scrollWidth · clientWidth 는 정수로 반올림돼 끝에서 1px 까지 어긋나요. */
const END_SLACK = 1;

/**
 * scrollLeft = 지금 밀린 거리, clientWidth = 줄의 보이는 폭, scrollWidth = 내용 전체 폭.
 * 내용이 줄보다 넓지 않으면(넘치지 않으면) 처음부터 거짓이에요.
 */
export const hasMoreToRight = (scrollLeft: number, clientWidth: number, scrollWidth: number) =>
  scrollLeft + clientWidth < scrollWidth - END_SLACK;
