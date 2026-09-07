import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ButtonHTMLAttributes } from "react";

export function ActionButton({ hint, below = false, floating = false, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { hint: string; below?: boolean; floating?: boolean }) {
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number; below: boolean }>();
  useEffect(() => {
    if (!position) return;
    const hide = () => setPosition(undefined);
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") hide(); };
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("scroll", hide, true); window.removeEventListener("resize", hide); window.removeEventListener("keydown", escape); };
  }, [position]);
  const show = () => {
    if (!floating || !anchor.current) return;
    const rect = anchor.current.getBoundingClientRect();
    setPosition({ top: rect.top < 60 ? rect.bottom + 8 : rect.top - 8, left: Math.max(148, Math.min(window.innerWidth - 148, rect.left + rect.width / 2)), below: rect.top < 60 });
  };
  return <span ref={anchor} className={`action-hint${below ? " below" : ""}`} onMouseEnter={show} onMouseLeave={() => setPosition(undefined)} onFocus={show} onBlur={() => setPosition(undefined)}>
    <button {...props} aria-describedby={!floating || position ? id : undefined}>{children}</button>
    {floating ? position && createPortal(<span id={id} role="tooltip" className="action-hint-text floating" style={{ top: position.top, left: position.left, transform: `translate(-50%, ${position.below ? "0" : "-100%"})` }}>{hint}</span>, document.body)
      : <span id={id} role="tooltip" className="action-hint-text">{hint}</span>}
  </span>;
}
