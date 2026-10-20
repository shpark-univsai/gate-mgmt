"use client";

import { useEffect, useRef } from "react";

export function Brand() {
  return (
    <div className="brand">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.svg" alt="UNIVS GATE" width={134} height={20} />
      <span className="badge t-button-200">BACKOFFICE</span>
    </div>
  );
}

export function PersonIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M8.23116 8.75647C7.74394 8.26924 7.50033 7.67945 7.50033 6.98709C7.50033 6.29487 7.74394 5.70515 8.23116 5.21792C8.71824 4.7307 9.30796 4.48709 10.0003 4.48709C10.6927 4.48709 11.2824 4.7307 11.7695 5.21792C12.2567 5.70515 12.5003 6.29487 12.5003 6.98709C12.5003 7.67945 12.2567 8.26924 11.7695 8.75647C11.2824 9.24355 10.6927 9.48709 10.0003 9.48709C9.30796 9.48709 8.71824 9.24355 8.23116 8.75647ZM4.16699 15.5129V14.141C4.16699 13.797 4.26713 13.4751 4.46741 13.1754C4.66783 12.8758 4.93734 12.6432 5.27595 12.4775C6.06234 12.1004 6.84921 11.8176 7.63658 11.629C8.42394 11.4405 9.21185 11.3463 10.0003 11.3463C10.7888 11.3463 11.5767 11.4405 12.3641 11.629C13.1514 11.8176 13.9383 12.1004 14.7247 12.4775C15.0633 12.6432 15.3328 12.8758 15.5332 13.1754C15.7335 13.4751 15.8337 13.797 15.8337 14.141V15.5129H4.16699ZM5.00033 14.6796H15.0003V14.141C15.0003 13.9562 14.9407 13.7826 14.8216 13.6202C14.7025 13.4579 14.5378 13.3206 14.3272 13.2083C13.6414 12.8761 12.9342 12.6216 12.2057 12.4448C11.4773 12.268 10.7421 12.1796 10.0003 12.1796C9.25852 12.1796 8.52338 12.268 7.79491 12.4448C7.06644 12.6216 6.35928 12.8761 5.67345 13.2083C5.46289 13.3206 5.2981 13.4579 5.17908 13.6202C5.05991 13.7826 5.00033 13.9562 5.00033 14.141V14.6796ZM11.1774 8.16417C11.5038 7.83779 11.667 7.44542 11.667 6.98709C11.667 6.52876 11.5038 6.1364 11.1774 5.81001C10.851 5.48362 10.4587 5.32042 10.0003 5.32042C9.54199 5.32042 9.14963 5.48362 8.82324 5.81001C8.49685 6.1364 8.33366 6.52876 8.33366 6.98709C8.33366 7.44542 8.49685 7.83779 8.82324 8.16417C9.14963 8.49056 9.54199 8.65376 10.0003 8.65376C10.4587 8.65376 10.851 8.49056 11.1774 8.16417Z"
        fill="var(--gray-800)"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 21 22" fill="none" aria-hidden="true">
      <path d="M0.53 0.53L20.53 20.53M20.53 0.53L0.53 20.53" stroke="var(--gray-500)" strokeWidth="1.5" />
    </svg>
  );
}

/** 확인 · 완료 창. Esc와 바깥 클릭으로 닫히고, 열리면 첫 버튼에 초점이 가요. */
export function Dialog({
  title,
  onClose,
  closable = true,
  children,
}: {
  title: string;
  onClose: () => void;
  closable?: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    el?.querySelector<HTMLElement>(".dialog-actions button:last-child")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && closable) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, closable]);

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && closable && onClose()}>
      <div ref={ref} className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <h2 className="dialog-head t-heading-300">
          <span id="dialog-title">{title}</span>
          <button type="button" className="dialog-close" onClick={onClose} disabled={!closable} aria-label="닫기">
            <CloseIcon />
          </button>
        </h2>
        {children}
      </div>
    </div>
  );
}
