// 말줄임(…) 여부 재기(UG-450 기획 17003). 말줄임된 글자에만 「눌러서 전체 보기」 같은 장치를 붙일 때 써요.
//
// scrollWidth · clientWidth 는 정수로 반올림돼요 — 글자가 1px 보다 덜 넘치면(예: 글자 358.25px · 상자 358px)
// 브라우저는 「…」를 그리는데 scrollWidth(358) > clientWidth(358) 는 거짓이라 말줄임을 놓쳐요.
// 그래서 소수점까지 재는 getBoundingClientRect 로 글자 본래 폭(Range)과 상자 안쪽 폭을 견줘요. 정수 비교는 보조로 함께 봐요.

/** 이보다 덜 넘치면 반올림 오차로 봐요(px) — 브라우저가 소수 폭을 1/64px 단위로 다뤄 그보다 작게 잡아요. */
const OVERFLOW_EPSILON = 0.01;

/** 글자 폭이 상자 안쪽 폭을 넘는지(소수점 폭 그대로). */
export const exceedsBox = (textWidth: number, boxWidth: number) => textWidth - boxWidth > OVERFLOW_EPSILON;

/**
 * 한 줄 말줄임(white-space: nowrap · overflow: hidden · text-overflow: ellipsis) 요소의 글자가 잘렸는지.
 * 글자 본래 폭 = 요소 안 글자 전체를 감싼 Range 의 폭(말줄임 · overflow 로 가려도 줄 배치 폭은 그대로예요),
 * 상자 안쪽 폭 = 요소 폭 - 좌우 안쪽 여백 · 테두리.
 */
export function isTextTruncated(el: HTMLElement): boolean {
  if (el.scrollWidth > el.clientWidth) return true;
  const range = document.createRange();
  range.selectNodeContents(el);
  const textWidth = range.getBoundingClientRect().width;
  range.detach();
  const style = getComputedStyle(el);
  const px = (v: string) => parseFloat(v) || 0;
  const inner =
    el.getBoundingClientRect().width -
    px(style.paddingLeft) -
    px(style.paddingRight) -
    px(style.borderLeftWidth) -
    px(style.borderRightWidth);
  return exceedsBox(textWidth, inner);
}
