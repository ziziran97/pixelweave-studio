import { useEffect, useRef, useState } from "react";

export function BrushSizeControl({ value, disabled, change }: { value: number; disabled: boolean; change: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  const cancelled = useRef(false);
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    if (cancelled.current) { cancelled.current = false; return; }
    const parsed = Number(draft);
    const next = draft.trim() && Number.isFinite(parsed) ? Math.max(4, Math.min(300, Math.round(parsed))) : value;
    setDraft(String(next)); change(next);
  };
  return <div className="brush-size-control">
    <div className="slider-title">
      <label htmlFor="brush-size-number">笔刷大小</label>
      <span className="brush-size-value"><input id="brush-size-number" type="number" aria-label="笔刷大小数值"
        min={4} max={300} step={1} value={draft} title="原图 4–300px；回车或失焦生效，Esc 取消" disabled={disabled} onChange={event => setDraft(event.target.value)}
        onBlur={commit} onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); event.currentTarget.blur(); }
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancelled.current = true; setDraft(String(value)); event.currentTarget.blur(); }
        }} /><span>px</span></span>
    </div>
    <input type="range" aria-label="笔刷大小"
      min={4} max={300} step={1} value={value} disabled={disabled} onChange={event => change(Number(event.target.value))} />
  </div>;
}
