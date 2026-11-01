"use client";

import { useEffect, useRef } from "react";

const OVERLAY = ".palette, .drawer";

/**
 * When an overlay closes while focus is still inside it (now invisible), hand focus back to where it was
 * before it opened – otherwise keystrokes land in a hidden field and shortcuts stop working.
 */
export function useRestoreFocus(open: boolean) {
  const prev = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open) {
      prev.current = document.activeElement as HTMLElement | null;
      return;
    }
    const back = prev.current;
    prev.current = null;
    const a = document.activeElement as HTMLElement | null;
    if (!a || !a.closest(OVERLAY)) return;
    if (back?.isConnected && back !== document.body && !back.closest(OVERLAY)) back.focus();
    else a.blur();
  }, [open]);
}
