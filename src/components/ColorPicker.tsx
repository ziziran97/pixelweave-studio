import { Pipette } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { colorFields, colorTone, fieldsColor, toneHex } from "./colorValues";
import type { ColorFormat, ColorTone } from "./colorValues";
export function ColorPicker({ label, original, value, anchor, sampling, sample, format, changeFormat, preview, close, pick }: {
  label: string; original: string; value: string; anchor: HTMLElement | null;
  sampling: boolean; sample?: { color: string };
  format: ColorFormat; changeFormat: (format: ColorFormat) => void;
  preview: (color: string) => void; close: (apply: boolean) => void; pick: () => void;
}) {
  const [tone, setTone] = useState(() => colorTone(value)), [fields, setFields] = useState(() => colorFields(value, format));
  const [position, setPosition] = useState({ left: 8, top: 8, width: 272 });
  // Format changes only reformat the canonical color; rounded HSL display values never feed back into it.
  const current = useRef(value);
  const dialog = useRef<HTMLDivElement>(null);
  // A completed sample replaces the draft even when its color matches the last valid preview.
  // Canceling sampling leaves raw inputs and the achromatic hue position untouched.
  useLayoutEffect(() => {
    if (!sample) return;
    current.current = sample.color; setTone(colorTone(sample.color)); setFields(colorFields(sample.color, format));
  }, [sample]);
  useLayoutEffect(() => {
    if (sampling) {
      if (dialog.current?.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
      return;
    }
    dialog.current?.focus();
    const place = () => {
      const rect = anchor?.getBoundingClientRect(); if (!rect) return;
      const panel = anchor?.closest(".settings-panel")?.getBoundingClientRect();
      const width = Math.min(window.innerWidth - 16, 272);
      const height = dialog.current?.offsetHeight ?? 380;
      // Prefer the properties column so color preview stays visible on the canvas.
      const left = panel ? panel.right - width - 8 : rect.left - width - 8;
      setPosition({ width, left: Math.max(8, Math.min(window.innerWidth - width - 8, left)), top: Math.max(8, Math.min(window.innerHeight - height - 8, rect.top - 30)) });
    };
    place(); const observer = new ResizeObserver(place); if (dialog.current) observer.observe(dialog.current);
    window.addEventListener("resize", place); return () => { observer.disconnect(); window.removeEventListener("resize", place); };
  }, [anchor, sampling]);
  const update = (next: ColorTone) => { setTone(next); const color = toneHex(next); current.current = color; setFields(colorFields(color, format)); preview(color); };
  const plane = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    update({ ...tone, s: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), v: Math.max(0, Math.min(1, 1 - (event.clientY - rect.top) / rect.height)) });
  };
  const valid = fieldsColor(fields, format) !== undefined;
  const channels = format === "RGB" ? ["R", "G", "B"] : ["H", "S", "L"];
  const error = format === "HEX" ? "请输入 6 位颜色值，例如 #2574D8" : format === "RGB" ? "RGB 每项请输入 0–255 的整数" : "H 为 0–360，S 和 L 为 0–100";
  return <div className="color-popover-backdrop" hidden={sampling} onPointerDown={event => {
    if (event.target === event.currentTarget) { event.preventDefault(); event.stopPropagation(); close(false); }
  }} onClick={event => event.stopPropagation()}>
    <div className="color-popover" role="dialog" aria-modal="true" aria-label={`自定义${label}`} tabIndex={-1} ref={dialog} style={position}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === "Escape") { event.preventDefault(); close(false); }
        if (event.key === "Tab") {
          const items = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,[tabindex="0"]')];
          if (event.shiftKey && (document.activeElement === items[0] || document.activeElement === dialog.current)) { event.preventDefault(); items.at(-1)?.focus(); }
          else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
        }
      }}>
      <strong>自定义{label}</strong>
      <div className="color-sv" role="slider" tabIndex={0} aria-label="饱和度和明度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(tone.s * 100)} aria-valuetext={`饱和度 ${Math.round(tone.s * 100)}%，明度 ${Math.round(tone.v * 100)}%`} style={{ backgroundColor: `hsl(${tone.h} 100% 50%)` }}
        onPointerDown={event => { event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); plane(event); }}
        onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) plane(event); }}
        onKeyDown={event => { if (!event.key.startsWith("Arrow")) return; event.preventDefault(); update({ ...tone, s: Math.max(0, Math.min(1, tone.s + (event.key === "ArrowRight" ? .01 : event.key === "ArrowLeft" ? -.01 : 0))), v: Math.max(0, Math.min(1, tone.v + (event.key === "ArrowUp" ? .01 : event.key === "ArrowDown" ? -.01 : 0))) }); }}>
        <i style={{ left: `${tone.s * 100}%`, top: `${(1 - tone.v) * 100}%` }} />
      </div>
      <input className="color-hue" type="range" aria-label="色相" min={0} max={359} value={tone.h} onChange={event => update({ ...tone, h: Number(event.target.value) })} />
      <div className="color-values">
        <select aria-label="颜色格式" value={format} onChange={event => { const next = event.target.value as ColorFormat; changeFormat(next); setFields(colorFields(current.current, next)); }}>
          <option>HEX</option><option>RGB</option><option>HSL</option>
        </select>
        <div className={`color-inputs ${format === "HEX" ? "color-hex" : "color-channels"}`}>
          {fields.map((field, index) => <label key={`${format}-${index}`}>
            <input aria-label={format === "HEX" ? "HEX 颜色" : `${format} ${channels[index]}`} type={format === "HEX" ? "text" : "number"}
              min={format === "HEX" ? undefined : 0} max={format === "HEX" ? undefined : format === "RGB" ? 255 : index === 0 ? 360 : 100} step={format === "RGB" ? 1 : .01}
              value={format === "HEX" ? field.toUpperCase() : field} aria-invalid={!valid} spellCheck={false}
              onChange={event => {
                const next = fields.map((value, i) => i === index ? event.target.value : value); setFields(next);
                const color = fieldsColor(next, format); if (!color) return;
                current.current = color; preview(color);
                const nextTone = colorTone(color);
                setTone({ ...nextTone, h: format === "HSL" ? Number(next[0]) % 360 : nextTone.s ? nextTone.h : tone.h });
              }} />
            <span>{format === "HEX" ? "颜色值" : `${channels[index]}${format === "HSL" ? index === 0 ? " °" : " %" : ""}`}</span>
          </label>)}
        </div>
      </div>
      {!valid && <span className="color-error" role="status">{error}</span>}
      <div className="color-comparison"><button type="button" className="original-color" aria-label="恢复原颜色" title="恢复打开面板时的颜色，可继续试色" onClick={() => {
        current.current = original; setTone(colorTone(original)); setFields(colorFields(original, format)); preview(original);
      }}><i style={{ background: original }} />原颜色</button><span><i style={{ background: current.current }} />新颜色</span><button type="button" className="color-pick-action" onClick={pick}><Pipette size={16} />取色</button></div>
      <div className="color-actions"><button type="button" className="secondary-button" onClick={() => close(false)}>取消</button><button type="button" className="primary-button" disabled={!valid} onClick={() => close(true)}>应用</button></div>
    </div>
  </div>;
}
