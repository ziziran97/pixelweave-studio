import { useEffect, useRef, useState } from "react";
import type { EditorController, NumberEdit } from "../editor/EditorController";

type NumberInputProps = {
  label: string; value: number; min: number; max: number; step?: number; unit?: string;
  showRangeHint?: boolean; cancelOnEscape?: boolean; disabled?: boolean; id?: string;
  engine?: EditorController; onChange: (value: number) => void;
};

/** Keep partial input intact while previewing valid values against one editing target. */
export function NumberInput(props: NumberInputProps) {
  const { label, value, min, max, step = 1, unit, disabled, id } = props;
  const [draft, setDraft] = useState(String(value));
  const [finished, setFinished] = useState(0);
  const input = useRef<HTMLInputElement>(null), focused = useRef(false);
  const cancelled = useRef(false);
  const dirty = useRef(false);
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
  const finishRef = useRef(finish); finishRef.current = finish;
  useEffect(() => {
    const element = input.current!;
    const wheel = (event: WheelEvent) => {
      if (document.activeElement !== element || element.matches(":disabled") || !event.deltaY) return;
      event.preventDefault(); event.stopPropagation();
      const current = latest.current, parsed = Number(draftRef.current);
      const start = draftRef.current.trim() && Number.isFinite(parsed) ? parsed : current.value;
      const next = Math.min(current.max, Math.max(current.min, Number((start + (event.deltaY < 0 ? 1 : -1) * (current.step ?? 1)).toFixed(6))));
      setInput(String(next)); preview(next);
    };
    const blur = () => { if (focused.current) finishRef.current(); };
    element.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("blur", blur);
    return () => {
      element.removeEventListener("wheel", wheel); window.removeEventListener("blur", blur);
      // Valid input has already reached its original target. Never apply a draft on unmount.
      session.current?.edit?.finish(); session.current = undefined;
    };
  }, []);
  return <input ref={input} id={id} aria-label={label} type="number" value={draft} min={min} max={max} step={step} disabled={disabled}
    title={`${min}–${max}${unit ? ` ${unit}` : ""}；输入实时预览，回车或失焦保留，Esc 还原；聚焦后滚轮微调`}
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
    }} />;
}

export function NumberField(props: NumberInputProps) {
  return <label className="property-field"><span>{props.label}</span>{props.unit
    ? <span className="property-number-value"><NumberInput {...props} /><span>{props.unit}</span></span>
    : <NumberInput {...props} />}</label>;
}
