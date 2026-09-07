import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import type { ShapeLineStyle } from "../types";
import { SHAPE_LINE_STYLES, shapeLinePattern } from "../editor/shapeStyles";

function LineSample({ style }: { style: ShapeLineStyle }) {
  const pattern = shapeLinePattern(style, 2);
  return <svg className="shape-line-preview" viewBox="0 0 76 16" aria-hidden="true">
    <line x1="3" y1="8" x2="73" y2="8" stroke="currentColor" strokeWidth="2"
      strokeDasharray={pattern.dash?.join(" ")} strokeLinecap={pattern.cap} />
  </svg>;
}

export function ShapeLineSelect({ value, change, disabled }: { value: ShapeLineStyle; change: (value: ShapeLineStyle) => void; disabled: boolean }) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false), [active, setActive] = useState(0);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0, maxHeight: 210 });
  const selected = SHAPE_LINE_STYLES.findIndex(style => style.id === value);
  const close = (focus = false) => { setOpen(false); if (focus) trigger.current?.focus({ preventScroll: true }); };
  const choose = (index: number) => { if (!disabled) { change(SHAPE_LINE_STYLES[index].id); close(true); } };
  const show = () => { if (!disabled) { setActive(Math.max(0, selected)); setOpen(true); } };

  useLayoutEffect(() => {
    if (!open) return;
    const bounds = trigger.current!.getBoundingClientRect(), height = 206;
    const below = window.innerHeight - bounds.bottom - 12, above = bounds.top - 12;
    const upwards = below < height && above > below;
    const maxHeight = Math.max(40, Math.min(height, upwards ? above : below));
    setPosition({ left: Math.max(8, Math.min(bounds.left, window.innerWidth - bounds.width - 8)),
      top: upwards ? bounds.top - maxHeight - 4 : bounds.bottom + 4, width: bounds.width, maxHeight });
    menu.current?.focus({ preventScroll: true });
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false);
    };
    const moved = (event: Event) => { if (!menu.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", moved); window.addEventListener("scroll", moved, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("resize", moved); window.removeEventListener("scroll", moved, true);
    };
  }, [open]);
  useEffect(() => { if (open) menu.current?.querySelector(`#${CSS.escape(`${id}-${active}`)}`)?.scrollIntoView({ block: "nearest" }); }, [active, open, id]);

  return <div className="shape-line-field">
    <span id={`${id}-label`}>线条类型</span>
    <button ref={trigger} className="shape-line-trigger" type="button" aria-label="线条类型" aria-haspopup="listbox"
      aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled}
      onClick={() => open ? close(true) : show()} onKeyDown={event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); event.stopPropagation(); show(); }
      }}>
      <LineSample style={value} /><span>{SHAPE_LINE_STYLES[Math.max(0, selected)].label}</span><ChevronDown size={14} />
    </button>
    {open && createPortal(<div ref={menu} id={id} className="shape-line-menu" role="listbox" aria-labelledby={`${id}-label`}
      tabIndex={-1} aria-activedescendant={`${id}-${active}`} style={position}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Escape") { event.preventDefault(); close(true); }
        else if (event.key === "Tab") close(true);
        else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault(); setActive(index => (index + (event.key === "ArrowDown" ? 1 : -1) + SHAPE_LINE_STYLES.length) % SHAPE_LINE_STYLES.length);
        } else if (event.key === "Home" || event.key === "End") { event.preventDefault(); setActive(event.key === "Home" ? 0 : SHAPE_LINE_STYLES.length - 1); }
        else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(active); }
      }} onKeyUp={event => event.stopPropagation()}>
      {SHAPE_LINE_STYLES.map((style, index) => <button key={style.id} id={`${id}-${index}`} type="button" role="option"
        aria-label={style.label} aria-selected={value === style.id} tabIndex={-1} className={active === index ? "active" : ""}
        onMouseEnter={() => setActive(index)} onClick={() => choose(index)}>
        <LineSample style={style.id} /><span>{style.label}</span><Check size={14} visibility={value === style.id ? "visible" : "hidden"} />
      </button>)}
    </div>, document.body)}
  </div>;
}
