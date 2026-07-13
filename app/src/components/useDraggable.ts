import { useCallback, useEffect, useRef, useState } from "react";

export interface DragPos {
  /** Distance from viewport left, in pixels. */
  left: number;
  /** Distance from viewport top, in pixels. */
  top: number;
}

/**
 * Tiny pointer-drag hook for repositionable floating panels.
 *
 * Returns:
 *   - `pos`: current `{ left, top }` after any drag, or `null` if the
 *     user hasn't moved the panel yet (caller can fall back to its
 *     built-in anchor styles like `bottom`/`right` in that case).
 *   - `handleProps`: spread onto the drag handle element (title bar).
 *
 * The hook records the pointer offset from the top-left of the tracked
 * element on pointerdown and then just translates the element as the
 * pointer moves. Position updates go through React state so panels
 * survive re-renders. Pointer capture ensures drags don't get stolen
 * by other elements.
 */
export function useDraggable(elRef: React.RefObject<HTMLElement | null>) {
  const [pos, setPos] = useState<DragPos | null>(null);
  const dragRef = useRef<{ offX: number; offY: number } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const el = elRef.current;
      if (!el) return;
      // Don't hijack interactions with form controls inside the handle.
      const t = e.target as HTMLElement;
      const tag = t.tagName;
      if (
        tag === "INPUT" ||
        tag === "SELECT" ||
        tag === "BUTTON" ||
        tag === "TEXTAREA" ||
        tag === "LABEL"
      )
        return;
      const rect = el.getBoundingClientRect();
      dragRef.current = {
        offX: e.clientX - rect.left,
        offY: e.clientY - rect.top,
      };
      e.preventDefault();
    },
    [elRef],
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const left = Math.max(0, Math.min(window.innerWidth - 40, e.clientX - d.offX));
      const top = Math.max(0, Math.min(window.innerHeight - 24, e.clientY - d.offY));
      setPos({ left, top });
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  return { pos, handleProps: { onPointerDown, style: { cursor: "move" as const } } };
}
