import { useEffect, useRef, useState } from "react";
import type { TextProperties } from "../types";
import type { EditorController } from "../editor/EditorController";
import { ColorField } from "./ColorField";
import { FONT_OPTIONS } from "../editor/fonts";

export function NumberField({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const parsed = Number(draft);
    const next = Number.isFinite(parsed) && draft.trim() ? Math.min(max, Math.max(min, parsed)) : value;
    setDraft(String(next)); if (next !== value) onChange(next);
  };
  return <label className="property-field"><span>{label}</span><input aria-label={label} type="number" value={draft} min={min} max={max} step={step}
    onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing) event.currentTarget.blur(); }} /></label>;
}

export function TextPanel({ text, engine, disabled }: { text: TextProperties; engine: EditorController; disabled: boolean }) {
  const [fonts, setFonts] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const update = (patch: Partial<TextProperties>) => void engine.updateText({ ...text, ...patch });
  const allFonts = [...new Set([...FONT_OPTIONS, ...fonts, ...engine.getFontFamilies(), text.fontFamily])];
  return <fieldset disabled={disabled} className="text-properties">
    <label className="property-field"><span>字体</span><select aria-label="字体" value={text.fontFamily} onChange={event => update({ fontFamily: event.target.value })}>{allFonts.map(font => <option key={font}>{font}</option>)}</select></label>
    <div className="property-grid">
      <NumberField label="字号" value={text.fontSize} min={8} max={500} onChange={fontSize => update({ fontSize })} />
      <label className="property-field"><span>对齐</span><select aria-label="对齐" value={text.textAlign} onChange={event => update({ textAlign: event.target.value })}><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option></select></label>
    </div>
    <div className="toggle-grid text-style-toggles">
      <button aria-label="加粗" aria-pressed={text.fontWeight === "bold" || text.fontWeight === "700"} className={text.fontWeight === "bold" || text.fontWeight === "700" ? "selected" : ""} onClick={() => update({ fontWeight: text.fontWeight === "bold" || text.fontWeight === "700" ? "normal" : "bold" })}><b>B</b> 加粗</button>
      <button aria-label="斜体" aria-pressed={text.fontStyle === "italic"} className={text.fontStyle === "italic" ? "selected" : ""} onClick={() => update({ fontStyle: text.fontStyle === "italic" ? "normal" : "italic" })}><i>I</i> 斜体</button>
    </div>
    <ColorField label="文字颜色" value={text.fill} onChange={fill => update({ fill })} engine={engine} />
    <label className="check-field"><input type="checkbox" checked={text.background} onChange={event => update({ background: event.target.checked })} />背景填充</label>
    {text.background && <div className="background-settings">
      <ColorField label="背景颜色" value={text.backgroundColor} onChange={backgroundColor => update({ backgroundColor })} engine={engine} />
      <div className="property-grid">
        <NumberField label="背景留白" value={text.backgroundPadding} min={0} max={200} onChange={backgroundPadding => update({ backgroundPadding })} />
        <NumberField label="背景圆角" value={text.backgroundRadius} min={0} max={200} onChange={backgroundRadius => update({ backgroundRadius })} />
      </div>
    </div>}
    <details><summary>更多设置</summary>
      <div className="property-grid">
        <NumberField label="行距倍数" value={text.lineHeight} min={.6} max={3} step={.1} onChange={lineHeight => update({ lineHeight })} />
        <NumberField label="字距" value={text.charSpacing} min={-200} max={1000} step={10} onChange={charSpacing => update({ charSpacing })} />
      </div>
      <label className="check-field"><input type="checkbox" checked={text.strokeWidth > 0} onChange={event => update({ strokeWidth: event.target.checked ? 2 : 0 })} />文字描边</label>
      {text.strokeWidth > 0 && <>
        <NumberField label="描边粗细" value={text.strokeWidth} min={1} max={30} onChange={strokeWidth => update({ strokeWidth })} />
        <ColorField label="描边颜色" value={text.stroke} onChange={stroke => update({ stroke })} engine={engine} />
      </>}
      <div className="property-grid">
        <NumberField label="阴影模糊" value={text.shadowBlur} min={0} max={100} onChange={shadowBlur => update({ shadowBlur })} />
        <NumberField label="阴影水平偏移" value={text.shadowOffsetX} min={-100} max={100} onChange={shadowOffsetX => update({ shadowOffsetX })} />
        <NumberField label="阴影垂直偏移" value={text.shadowOffsetY} min={-100} max={100} onChange={shadowOffsetY => update({ shadowOffsetY })} />
      </div>
      <ColorField label="阴影颜色" value={text.shadowColor.startsWith("#") ? text.shadowColor : "#000000"} onChange={shadowColor => update({ shadowColor })} engine={engine} />
      <button className="secondary-button full" onClick={() => fileRef.current?.click()}>加载本地字体</button>
      <p className="field-help">字体仅在当前编辑中使用。字距单位为千分之一字号。</p>
    </details>
    <input ref={fileRef} hidden type="file" accept=".woff,.woff2,.ttf,.otf" onChange={async event => {
      const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
      const family = await engine.addFont(file); if (family) { setFonts(previous => [...previous, family]); await engine.updateText({ ...text, fontFamily: family }); }
    }} />
    <p className="field-help">双击修改文字，Enter 换行；拖动左右控制点调整文本框宽度。</p>
  </fieldset>;
}
