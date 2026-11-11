"use client";

// 목록 거르기 조건을 주소(?…)와 맞춰요(UG-458 기획 6 · 9). 조건은 주소에 둬요 — 새로 고침 · 뒤로 가기에도 남아요.
// 같은 화면 안의 바꿈은 history 칸을 늘리지 않게 replaceState 로(뒤로 가기 한 번이면 앞 화면으로).
// Next 는 history.replaceState 를 자기 라우터와 맞춰 useSearchParams 가 따라와요 — router.replace 와 달리 서버(정적 파일)를 다시 받지 않아요.
// 정적 내보내기라 이 훅을 쓰는 화면은 Suspense 안에서 그려요(빌드 때는 주소를 모름).
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * value = 지금 조건(같은 조건이면 같은 객체), replace = 조건을 바꿔요(바뀌지 않았으면 false — 화면이 목록만 다시 받아요).
 * replace 는 조건을 곧바로 바꾸고 주소는 뒤따라 맞춰요 — Next 가 주소를 늦게(전환으로) 반영해도 조건 · 쪽 번호(setPage)가 한 번에 바뀌어
 * 옛 조건으로 한 번 더 받는 일이 없어요(UG-458 반박 리뷰 L1). 주소가 그 조건으로 따라오면 아무것도 다시 하지 않아요.
 * onOutside = 이 화면이 쓰지 않은 주소 바뀜(처음 열 때 · 뒤로 가기 · 위쪽 메뉴로 같은 화면)에 불러요 — 검색 칸 · 선택 상자를 맞추라고.
 * 그리는 중에 불러요(React 의 「그리는 중 상태 맞추기」) — 그 안에서는 같은 화면의 상태만 바꿔요.
 * 주소가 정리된 모양과 다르면(옛 해지 거르기 · 모르는 값 · 앞뒤 빈칸) 바로 정리된 주소로 바꿔 둬요(반박 리뷰 I3).
 */
export function useUrlQuery<T>(
  parse: (params: URLSearchParams) => T,
  serialize: (value: T) => string,
  onOutside: (value: T) => void,
): { value: T; replace: (next: T) => boolean } {
  const raw = useSearchParams().toString();
  const urlValue = useMemo(() => parse(new URLSearchParams(raw)), [parse, raw]);
  const urlKey = useMemo(() => serialize(urlValue), [serialize, urlValue]);
  // 지금 조건(정리된 주소 글자 + 값). null = 아직 주소를 읽지 않음
  const [current, setCurrent] = useState<{ key: string; value: T } | null>(null);
  // 마지막으로 본 주소 — 주소가 바뀐 때만 견줘요
  const [seenUrl, setSeenUrl] = useState<string | null>(null);
  if (urlKey !== seenUrl) {
    setSeenUrl(urlKey);
    // 우리가 바꾼 조건으로 주소가 따라온 것이면 그대로(같은 객체 — 목록을 다시 받지 않아요), 아니면 밖에서 바뀐 것
    if (current === null || urlKey !== current.key) {
      setCurrent({ key: urlKey, value: urlValue });
      onOutside(urlValue);
    }
  }
  const now = current ?? { key: urlKey, value: urlValue };

  // 주소 정리(반박 리뷰 I3) — 예: ?status=closed_all → 주소에서 빼요. 우리 바꿈이 아직 주소에 닿지 않은 동안은 건드리지 않아요
  useEffect(() => {
    if (raw !== urlKey && (current === null || current.key === urlKey)) {
      window.history.replaceState(null, "", urlKey ? `${window.location.pathname}?${urlKey}` : window.location.pathname);
    }
  }, [raw, urlKey, current]);

  const nowKey = now.key;
  const replace = useCallback(
    (next: T): boolean => {
      const nextKey = serialize(next);
      if (nextKey === nowKey) return false;
      setCurrent({ key: nextKey, value: parse(new URLSearchParams(nextKey)) });
      window.history.replaceState(null, "", nextKey ? `${window.location.pathname}?${nextKey}` : window.location.pathname);
      return true;
    },
    [nowKey, parse, serialize],
  );
  return { value: now.value, replace };
}
