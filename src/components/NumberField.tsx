import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { ActionButton } from "./ActionButton";
import type { EditorController, NumberEdit } from "../editor/EditorController";

type NumberInputProps = {
  label: string; value: number; min: number; max: number; step?: number; unit?: string;
  disabled?: boolean; id?: string;
  relativeStep?: boolean;
  engine?: EditorController; onChange: (value: number) => void;
};

/** Keep partial input intact while previewing valid values against one editing target. */
export function NumberInput(props: NumberInputProps) {
  const { label, value, min, max, step = 1, unit, disabled, id, relativeStep } = props;
  const [draft, setDraft] = useState(String(value));
  const [finished, setFinished] = useState(0);
  const input = useRef<HTMLInputElement>(null), focused = useRef(false);
  const cancelled = useRef(false);
  const dirty = useRef(false);
  const repeatTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stopRepeat = () => { clearTimeout(repeatTimer.current); repeatTimer.current = undefined; };
  const latest = useRef(props); latest.current = props;
  const draftRef = useRef(draft); draftRef.current = draft;
  const session = useRef<{ edit?: NumberEdit; before: number; change: (value: number) => void } | undefined>(undefined);
  const setInput = (text: string) => { draftRef.current = text; setDraft(text); };
  useEffect(() => { if (!focused.current) setInput(String(value)); }, [value, finished]);

  const preview = (next: number) => {
    cancelled.current = false;
    dirty.current = true;
    const current = latest.current;
    if (!session.current) {
      const edit = current.engine?.beginNumberEdit();
      if (current.engine && !edit) return;
      session.current = { edit, before: current.value, change: current.onChange };
    }
    if (!session.current.edit || session.current.edit.active()) current.onChange(next);
  };
  const finish = (apply = true) => {
    stopRepeat();
    if (apply && (cancelled.current || !dirty.current)) return;
    const current = latest.current, pending = session.current;
    if (apply) {
      const parsed = Number(draftRef.current);
      const next = draftRef.current.trim() && Number.isFinite(parsed) ? Math.min(current.max, Math.max(current.min, parsed)) : current.value;
      if ((!pending?.edit || pending.edit.active()) && next !== current.value) preview(next);
      session.current?.edit?.finish();
      setInput(String(next));
    } else {
      if (pending?.edit) pending.edit.cancel();
      else if (pending) pending.change(pending.before);
      setInput(String(pending?.before ?? current.value));
      cancelled.current = true;
    }
    session.current = undefined;
    dirty.current = false;
    setFinished(count => count + 1);
  };
  const stepBy = (direction: number) => {
    const element = input.current;
    if (!element || element.matches(":disabled") || (session.current?.edit && !session.current.edit.active())) return false;
    const current = latest.current, parsed = Number(draftRef.current);
    const start = draftRef.current.trim() && Number.isFinite(parsed) ? parsed : current.value;
    const next = Math.min(current.max, Math.max(current.min, Number((start + direction * (current.step ?? 1)).toFixed(6))));
    if (next === start) return false;
    setInput(String(next)); preview(next);
    return true;
  };
  const stepRef = useRef(stepBy); stepRef.current = stepBy;
  const finishRef = useRef(finish); finishRef.current = finish;
  useEffect(() => {
    const element = input.current!;
    const wheel = (event: WheelEvent) => {
      if (document.activeElement !== element || element.matches(":disabled") || !event.deltaY) return;
      event.preventDefault(); event.stopPropagation();
      stepRef.current(event.deltaY < 0 ? 1 : -1);
    };
    const blur = () => { if (focused.current) finishRef.current(); };
    const visibility = () => { if (document.hidden) blur(); };
    element.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("blur", blur);
    window.addEventListener("pointerup", stopRepeat);
    window.addEventListener("pointercancel", stopRepeat);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      stopRepeat();
      element.removeEventListener("wheel", wheel); window.removeEventListener("blur", blur);
      window.removeEventListener("pointerup", stopRepeat); window.removeEventListener("pointercancel", stopRepeat);
      document.removeEventListener("visibilitychange", visibility);
      // Valid input has already reached its original target. Never apply a draft on unmount.
      session.current?.edit?.finish(); session.current = undefined;
    };
  }, []);
  const field = <input ref={input} id={id} aria-label={label} type="number" value={draft} min={min} max={max} step={relativeStep ? "any" : step} disabled={disabled}
    title={`${min}–${max}${unit ? ` ${unit}` : ""}；输入实时预览，回车或失焦保留，Esc 还原；${relativeStep ? `滚轮、步进按钮及上下键每次调整 ${step}${unit ? ` ${unit}` : ""}，保留小数；` : ""}聚焦后滚轮微调`}
    onFocus={() => { focused.current = true; cancelled.current = false; }} onBlur={() => { focused.current = false; finish(); }}
    onChange={event => {
      cancelled.current = false;
      dirty.current = true;
      const text = event.target.value; setInput(text);
      const next = Number(text);
      if (text.trim() && Number.isFinite(next) && next >= min && next <= max) preview(next);
    }} onKeyDown={event => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); finish(false); }
      else if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); focused.current = false; finish(); event.currentTarget.blur(); }
      else if (relativeStep && (event.key === "ArrowUp" || event.key === "ArrowDown") && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault(); event.stopPropagation(); stepBy(event.key === "ArrowUp" ? 1 : -1);
      }
    }} />;
  if (!relativeStep) return field;
  // Native number spinners snap to their step grid. These buttons share the wheel/key delta instead.
  return <span className="relative-number-input">{field}<span className="number-step-buttons">
    {([1, -1] as const).map(direction => {
      const Icon = direction > 0 ? ChevronUp : ChevronDown;
      const name = `${direction > 0 ? "增大" : "减小"}${label}`;
      return <ActionButton key={direction} type="button" floating aria-label={name} tabIndex={-1} disabled={disabled}
        hint={`${name} ${step}${unit ? ` ${unit}` : ""}，保留小数；长按连续调整`}
        onPointerDown={event => {
          if (event.button !== 0 || !event.isPrimary) return;
          event.preventDefault(); event.stopPropagation(); stopRepeat();
          input.current?.focus({ preventScroll: true }); event.currentTarget.setPointerCapture(event.pointerId);
          if (!stepBy(direction)) return;
          const repeat = () => { if (stepRef.current(direction)) repeatTimer.current = setTimeout(repeat, 80); };
          repeatTimer.current = setTimeout(repeat, 400);
        }} onPointerUp={stopRepeat} onPointerCancel={stopRepeat} onLostPointerCapture={stopRepeat}
        onPointerMove={event => {
          const bounds = event.currentTarget.getBoundingClientRect();
          if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) stopRepeat();
        }} onClick={event => {
          event.preventDefault();
          if (!event.detail) { input.current?.focus({ preventScroll: true }); stepBy(direction); }
        }}><Icon size={12} /></ActionButton>;
    })}
  </span></span>;
}

export function NumberField(props: NumberInputProps) {
  return <label className="property-field"><span>{props.label}</span>{props.unit
    ? <span className="property-number-value"><NumberInput {...props} /><span>{props.unit}</span></span>
    : <NumberInput {...props} />}</label>;
}
