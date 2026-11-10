// 말줄임(…) 여부 재기(UG-450 기획 17003). 말줄임된 글자에만 「눌러서 전체 보기」 같은 장치를 붙일 때 써요.
//
// scrollWidth · clientWidth 는 정수로 반올림돼요 — 글자가 1px 보다 덜 넘치면(예: 글자 358.25px · 상자 358px)
// 브라우저는 「…」를 그리는데 scrollWidth(358) > clientWidth(358) 는 거짓이라 말줄임을 놓쳐요.
// 그래서 소수점까지 재는 getBoundingClientRect 로 글자 본래 폭과 상자 안쪽 폭을 견줘요. 정수 비교는 보조로 함께 봐요.
// 글자 본래 폭은 보이지 않는 복제본(말줄임 · 폭 제한 없음)으로 재요 — 말줄임된 글자를 Range 로 재면
// 엔진에 따라(WebKit · 아이폰 Safari) 잘린 자리까지만 잡힐 수 있어 엔진과 상관없는 방법을 써요(반박 리뷰).

/** 이보다 덜 넘치면 반올림 오차로 봐요(px) — 브라우저가 소수 폭을 1/64px 단위로 다뤄 그보다 작게 잡아요. */
const OVERFLOW_EPSILON = 0.01;

/** 글자 폭이 상자 안쪽 폭을 넘는지(소수점 폭 그대로). */
export const exceedsBox = (textWidth: number, boxWidth: number) => textWidth - boxWidth > OVERFLOW_EPSILON;

/** 말풍선 한두 줄(30~48)에 여유를 둔 높이 — 글자 아래 자리가 이보다 모자라면 위로 띄워요. */
const TIP_SHORT_ROOM = 72;

/**
 * 전체 글자 말풍선을 글자 위로 띄울지(UG-453 기획 17101). below · above = 글자 아래 · 위에 남은 화면 높이,
 * need = 말풍선 높이 + 글자와의 간격 + 화면 끝 여백.
 * 아래가 한두 줄 자리도 안 되면 전처럼 위로. 긴 글자(서너 줄)라 아래에 다 들어가지 않으면 위에 다 들어갈 때만 위로 —
 * 위에도 모자라면 아래 그대로예요(위로 뒤집으면 첫 줄이 화면 밖으로 잘려요).
 */
export const tipOpensUp = (below: number, above: number, need: number) => below < TIP_SHORT_ROOM || (below < need && above >= need);

/** 복제본을 글자 본래 폭으로 펴는 스타일 — 같은 클래스(글꼴 · 자간)는 그대로 두고, 폭 제한 · 말줄임 · 여백 · 테두리만 풀어요. */
const NATURAL_STYLE: Partial<CSSStyleDeclaration> = {
  position: "absolute",
  top: "0",
  left: "0",
  visibility: "hidden",
  pointerEvents: "none",
  whiteSpace: "nowrap",
  width: "max-content",
  minWidth: "0",
  maxWidth: "none",
  overflow: "visible",
  textOverflow: "clip",
  padding: "0",
  border: "0",
  margin: "0",
};

/**
 * 한 줄 말줄임(white-space: nowrap · overflow: hidden · text-overflow: ellipsis) 요소의 글자가 잘렸는지.
 * 글자 본래 폭 = 요소 바로 옆(같은 부모 — 물려받는 글꼴이 같아요)에 잠깐 붙인 보이지 않는 복제본의 폭(재고 바로 떼요),
 * 상자 안쪽 폭 = 요소 폭 - 좌우 안쪽 여백 · 테두리.
 */
export function isTextTruncated(el: HTMLElement): boolean {
  if (el.scrollWidth > el.clientWidth) return true;
  if (!el.parentNode) return false;
  const clone = el.cloneNode(true) as HTMLElement;
  clone.removeAttribute("id");
  clone.setAttribute("aria-hidden", "true");
  Object.assign(clone.style, NATURAL_STYLE);
  el.after(clone);
  try {
    const textWidth = clone.getBoundingClientRect().width;
    const style = getComputedStyle(el);
    const px = (v: string) => parseFloat(v) || 0;
    const inner =
      el.getBoundingClientRect().width -
      px(style.paddingLeft) -
      px(style.paddingRight) -
      px(style.borderLeftWidth) -
      px(style.borderRightWidth);
    return exceedsBox(textWidth, inner);
  } finally {
    clone.remove();
  }
}
