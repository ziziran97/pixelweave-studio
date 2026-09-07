import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ButtonHTMLAttributes } from "react";

export function ActionButton({ hint, below = false, floating = false, hintPlacement = "vertical", hintDelay = 0, hintSuspended = false, dismissHintOnClick = false, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  hint: string; below?: boolean; floating?: boolean; hintPlacement?: "vertical" | "right";
  hintDelay?: number; hintSuspended?: boolean; dismissHintOnClick?: boolean;
}) {
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hoverNeedsExit = useRef(false);
  const [position, setPosition] = useState<{ top: number; left: number; side: "above" | "below" | "right" }>();
  const clearTimer = () => { clearTimeout(timer.current); timer.current = undefined; };
  const hide = () => { clearTimer(); setPosition(undefined); };
  useEffect(() => {
    if (hintSuspended) hide();
  }, [hintSuspended]);
  useEffect(() => {
    if (!floating) return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") hide(); };
    const pointerMoved = (event: PointerEvent) => {
      if (!hoverNeedsExit.current || !anchor.current) return;
      const rect = anchor.current.getBoundingClientRect();
      // Modal focus/hover restoration is not a fresh visit to the help button.
      if (event.clientX < rect.left || event.clientX >= rect.right || event.clientY < rect.top || event.clientY >= rect.bottom) hoverNeedsExit.current = false;
    };
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    window.addEventListener("blur", hide);
    window.addEventListener("keydown", escape);
    if (dismissHintOnClick) window.addEventListener("pointermove", pointerMoved);
    return () => {
      clearTimer(); window.removeEventListener("scroll", hide, true); window.removeEventListener("resize", hide); window.removeEventListener("blur", hide);
      window.removeEventListener("keydown", escape); window.removeEventListener("pointermove", pointerMoved);
    };
  }, [floating, dismissHintOnClick]);
  const show = (keyboard = false) => {
    clearTimer();
    if (!floating || !anchor.current || hintSuspended || (!keyboard && hoverNeedsExit.current)) return;
    const place = () => {
      if (!anchor.current) return;
      const rect = (hintPlacement === "right" ? anchor.current.querySelector("button")! : anchor.current).getBoundingClientRect();
      setPosition(hintPlacement === "right"
        ? { top: rect.top + rect.height / 2, left: rect.right + 8, side: "right" }
        : { top: rect.top < 60 ? rect.bottom + 8 : rect.top - 8, left: Math.max(148, Math.min(window.innerWidth - 148, rect.left + rect.width / 2)), side: rect.top < 60 ? "below" : "above" });
    };
    if (!keyboard && hintDelay) timer.current = setTimeout(place, hintDelay); else place();
  };
  return <span ref={anchor} className={`action-hint${below ? " below" : ""}`} onMouseEnter={() => show()} onMouseLeave={hide} onFocus={() => show(true)} onBlur={hide}>
    <button {...props} onClick={event => { if (dismissHintOnClick) { hoverNeedsExit.current = true; hide(); } props.onClick?.(event); }} aria-describedby={!floating || (position && !hintSuspended) ? id : undefined}>{children}</button>
    {floating ? position && !hintSuspended && createPortal(<span id={id} role="tooltip" className="action-hint-text floating" style={{ top: position.top, left: position.left, transform: position.side === "right" ? "translateY(-50%)" : `translate(-50%, ${position.side === "below" ? "0" : "-100%"})` }}>{hint}</span>, document.body)
      : <span id={id} role="tooltip" className="action-hint-text">{hint}</span>}
  </span>;
}
