"use client";

// 목록 거르기 조건을 주소(?…)와 맞춰요(UG-458 기획 6 · 9). 조건은 주소가 단일 진실이에요 — 화면은 주소를 읽어 목록을 받고,
// 조건을 바꾸면 주소만 바꿔요. 같은 화면 안의 바꿈은 history 칸을 늘리지 않게 replaceState 로(뒤로 가기 한 번이면 앞 화면으로).
// Next 는 history.replaceState 를 자기 라우터와 맞춰 useSearchParams 가 바로 따라와요 — router.replace 와 달리 서버(정적 파일)를 다시 받지 않아요.
// 정적 내보내기라 이 훅을 쓰는 화면은 Suspense 안에서 그려요(빌드 때는 주소를 모름).
import { useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

/**
 * value = 지금 주소의 조건(같은 주소면 같은 객체), replace = 조건을 주소에 써요(바뀌지 않았으면 false — 화면이 목록만 다시 받아요).
 * onOutside = 이 화면이 쓰지 않은 주소 바뀜(처음 열 때 · 뒤로 가기 · 위쪽 메뉴로 같은 화면)에 불러요 — 검색 칸 · 선택 상자를 주소에 맞추라고.
 * 그리는 중에 불러요(React 의 「그리는 중 상태 맞추기」) — 그 안에서는 같은 화면의 상태만 바꿔요.
 */
export function useUrlQuery<T>(
  parse: (params: URLSearchParams) => T,
  serialize: (value: T) => string,
  onOutside: (value: T) => void,
): { value: T; replace: (next: T) => boolean } {
  const raw = useSearchParams().toString();
  const value = useMemo(() => parse(new URLSearchParams(raw)), [parse, raw]);
  const key = useMemo(() => serialize(value), [serialize, value]);
  // 마지막으로 본 조건 — 처음(null)에도 맞추게 해요. own = 이 화면이 방금 쓴 조건(그 바뀜은 칸을 다시 맞추지 않아요)
  const [seen, setSeen] = useState<string | null>(null);
  const [own, setOwn] = useState<string | null>(null);
  if (key !== seen) {
    setSeen(key);
    setOwn(null);
    if (key !== own) onOutside(value);
  }
  const replace = useCallback(
    (next: T): boolean => {
      const nextKey = serialize(next);
      if (nextKey === key) return false;
      setOwn(nextKey);
      window.history.replaceState(null, "", nextKey ? `${window.location.pathname}?${nextKey}` : window.location.pathname);
      return true;
    },
    [key, serialize],
  );
  return { value, replace };
}
