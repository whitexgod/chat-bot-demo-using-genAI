"use client";

import { useEffect } from "react";

type ErrorToastProps = {
  message: string;
  onClose: () => void;
  durationMs?: number;
};

export function ErrorToast({ message, onClose, durationMs = 5000 }: ErrorToastProps) {
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => onClose(), durationMs);
    return () => window.clearTimeout(timer);
  }, [message, onClose, durationMs]);

  if (!message) return null;

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-50 w-[min(92vw,420px)]" aria-live="assertive">
      <div className="pointer-events-auto rounded-xl border border-rose-300/50 bg-rose-950/90 px-4 py-3 text-sm text-rose-100 shadow-2xl backdrop-blur-md">
        <div className="flex items-start gap-3">
          <p className="flex-1 leading-snug">{message}</p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-rose-300/40 px-2 py-0.5 text-xs text-rose-100 transition hover:bg-rose-300/15"
            aria-label="Dismiss error notification"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
