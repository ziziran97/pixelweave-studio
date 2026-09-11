import type { TextProperties } from "../types";
import type { EditorController } from "../editor/EditorController";
import { ColorField } from "./ColorField";
import { Plus, Bold, Italic, Underline, Strikethrough, createLucideIcon, Pencil } from "lucide-react";
import { FONT_FAMILIES, JP_FONT_FAMILY, fontDefinition, fontWeight, supportsItalic } from "../editor/fonts";
import { toggleTextBold } from "../editor/text";
import { ActionButton } from "./ActionButton";
import { PropertySlider } from "./PropertySlider";
import { NumberField } from "./NumberField";

const TextOrientation = createLucideIcon("TextOrientation", [
  ["path", { d: "M5 5v14m-3-3 3 3 3-3", key: "vertical" }],
  ["path", { d: "M9 5h11M14.5 5v14", key: "letter" }],
]);

export function TextPanel({ text, engine, disabled, selected, editing, vertical, error, fontError }: {
  text: TextProperties; engine: EditorController; disabled: boolean; selected: boolean;
  editing?: boolean; vertical?: boolean; error?: string; fontError?: string;
}) {
  const update = (patch: Partial<TextProperties>) => void engine.updateText({ ...text, ...patch }, "fontSize" in patch);
  const weight = fontWeight(text.fontWeight, text.fontFamily);
  const family = fontDefinition(text.fontFamily) ?? FONT_FAMILIES[0];
  const italic = supportsItalic(text.fontFamily, weight);
  const spacingPx = Math.round(text.charSpacing * text.fontSize / 1000 * 100) / 100;
  const opacity = text.opacity ?? 100;
  const backgroundOpacity = text.backgroundOpacity ?? 100;
  const activeEffects = [opacity < 100 && (opacity === 0 ? "完全透明" : `${opacity}% 不透明`), text.strokeEnabled && "描边", text.shadowEnabled && "阴影"].filter(Boolean).join("、");
  return <fieldset disabled={disabled} className="text-properties">
    <div className="text-add-sticky"><button className="primary-button full" aria-label="添加文字" onClick={() => void engine.addText()}><Plus size={17} />添加文字</button></div>
    <div className="text-scope-row"><p className="text-style-scope">{selected ? "当前文字属性" : "新文字样式"}</p>
      {selected && !editing && <button className="text-edit-link" aria-label="修改文字" onClick={() => engine.editSelectedText()}><Pencil size={13} />修改文字</button>}
    </div>
    {error && <p className="text-validation-error" role="status">{error}</p>}
    {fontError && <div className="text-validation-error" role="status"><span>{fontError}</span><button className="secondary-button" onClick={() => void engine.retryTextFont()}>重试字体加载</button></div>}
    <div className="text-font-row">
      <label className="property-field"><span>字体</span><select aria-label="字体" data-font-family={family.family} title={`${family.label} ${family.weights.find(item => item.value === weight)?.label}`} value={`${family.family}:${weight}`}
        onChange={event => {
          const [fontFamily, fontWeight] = event.target.value.split(":");
          update({ fontFamily, fontWeight, boldRestoreWeight: undefined, fontStyle: supportsItalic(fontFamily, fontWeight) ? text.fontStyle : "normal" });
        }}>
        {FONT_FAMILIES.map(font => <optgroup key={font.family} label={font.label}>{font.weights.map(item => <option key={item.value} value={`${font.family}:${item.value}`} style={{ fontFamily: font.family, fontWeight: Number(item.value) }}>{font.label} {item.label}</option>)}</optgroup>)}
      </select></label>
    </div>
    <div className="text-format-row">
      <div role="group" aria-label="文字样式">
        <ActionButton floating hint="加粗；再次点击恢复此前字重" aria-label="加粗" aria-pressed={weight === "700"} className={weight === "700" ? "selected" : ""} onClick={() => void engine.updateText(toggleTextBold(text))}><Bold size={18} /></ActionButton>
        <ActionButton floating hint={italic ? "斜体" : text.fontFamily === JP_FONT_FAMILY ? "日文字体暂无斜体" : "Black 暂无斜体，请选择其他字重"} aria-label="斜体" disabled={!italic} aria-pressed={text.fontStyle === "italic"} className={text.fontStyle === "italic" ? "selected" : ""} onClick={() => update({ fontStyle: text.fontStyle === "italic" ? "normal" : "italic" })}><Italic size={18} /></ActionButton>
        <ActionButton floating hint="下划线" aria-label="下划线" aria-pressed={!!text.underline} className={text.underline ? "selected" : ""} onClick={() => update({ underline: !text.underline })}><Underline size={18} /></ActionButton>
        <ActionButton floating hint="删除线" aria-label="删除线" aria-pressed={!!text.linethrough} className={text.linethrough ? "selected" : ""} onClick={() => update({ linethrough: !text.linethrough })}><Strikethrough size={18} /></ActionButton>
        <ActionButton floating hint={!selected ? "选中文字后可切换横版／竖版" : vertical ? "切换横版（0°）" : "切换竖版（顺时针 90°）"} aria-label="竖版" aria-pressed={!!vertical} disabled={!selected} className={vertical ? "selected" : ""} onClick={() => engine.toggleTextOrientation()}><TextOrientation size={18} /></ActionButton>
      </div>
    </div>
    <div className="property-grid" role="group" aria-label="字号与对齐">
      <NumberField engine={engine} label="字号" value={text.fontSize} min={8} max={500} unit="px" relativeStep onChange={value => engine.updateTextNumber("fontSize", value)} />
      <label className="property-field"><span>对齐</span><select aria-label="对齐" value={text.textAlign}
        title={text.textAlign === "justify-left" ? "文本框内两端对齐；段落末行保持起始对齐" : "文本框内对齐"}
        onChange={event => update({ textAlign: event.target.value })}>
        <option value="left">{vertical ? "上对齐" : "左对齐"}</option>
        <option value="center">{vertical ? "垂直居中" : "居中"}</option>
        <option value="right">{vertical ? "下对齐" : "右对齐"}</option>
        <option value="justify-left">两端对齐</option>
      </select></label>
    </div>
    <div className="property-grid" role="group" aria-label="字距与行距">
      <NumberField engine={engine} label="字距" value={spacingPx} min={-20} max={100} step={.1} unit="px" onChange={value => engine.updateTextNumber("charSpacing", value)} />
      <NumberField engine={engine} label="行距" value={text.lineHeight} min={.6} max={3} step={.05} unit="倍" onChange={value => engine.updateTextNumber("lineHeight", value)} />
    </div>
    <ColorField label="文字颜色" value={text.fill} channel="fill" engine={engine} />
    <label className="check-field"><input type="checkbox" checked={text.background} onChange={event => update({ background: event.target.checked })} />背景填充</label>
    {text.background && <div className="background-settings">
      <ColorField label="背景颜色" value={text.backgroundColor} channel="backgroundColor" engine={engine} />
      <div className="shape-number-control">
        <NumberField engine={engine} label="背景不透明度" value={backgroundOpacity} min={0} max={100} unit="%" onChange={value => engine.updateTextBackgroundOpacity(value, false)} />
        <PropertySlider label="文字背景不透明度滑块" min={0} max={100} value={backgroundOpacity}
          change={value => engine.updateTextBackgroundOpacity(value, false)} commit={() => engine.finishPropertyEdit()} />
      </div>
      <p className="field-help">{backgroundOpacity === 0 ? "背景完全透明，可调高不透明度恢复。" : "仅调整背景，文字、描边和阴影不变。"}</p>
      <div className="property-grid">
        <NumberField engine={engine} label="背景留白" value={text.backgroundPadding} min={0} max={200} unit="px" onChange={value => engine.updateTextNumber("backgroundPadding", value)} />
        <NumberField engine={engine} label="背景圆角" value={text.backgroundRadius} min={0} max={200} unit="px" onChange={value => engine.updateTextNumber("backgroundRadius", value)} />
      </div>
    </div>}
    <details className="text-effects"><summary>更多效果{activeEffects && <span className="text-effects-summary">{activeEffects}</span>}</summary>
      <div className="shape-number-control">
        <NumberField engine={engine} label="不透明度" value={opacity} min={0} max={100} unit="%" onChange={value => engine.updateTextOpacity(value, false)} />
        <PropertySlider label="文字不透明度滑块" min={0} max={100} value={opacity}
          change={value => engine.updateTextOpacity(value, false)} commit={() => engine.finishPropertyEdit()} />
      </div>
      <p className="field-help">{opacity === 0 ? selected ? "文字完全透明，可调整不透明度恢复。" : "当前为 0%，新添加的文字将不可见。" : "文字、背景、描边和阴影一起调整。"}</p>
      <label className="check-field"><input type="checkbox" checked={text.strokeEnabled ?? text.strokeWidth > 0} onChange={event => update({ strokeEnabled: event.target.checked })} />文字描边</label>
      {text.strokeEnabled && <>
        <NumberField engine={engine} label="描边粗细" value={text.strokeWidth} min={1} max={30} unit="px" onChange={value => engine.updateTextNumber("strokeWidth", value)} />
        <ColorField label="描边颜色" value={text.stroke} channel="stroke" engine={engine} />
      </>}
      <label className="check-field"><input type="checkbox" checked={!!text.shadowEnabled} onChange={event => update({ shadowEnabled: event.target.checked })} />文字阴影</label>
      {text.shadowEnabled && <>
        <ColorField label="阴影颜色" value={text.shadowColor.startsWith("#") ? text.shadowColor : "#000000"} channel="shadowColor" engine={engine} />
        <NumberField engine={engine} label="阴影模糊" value={text.shadowBlur} min={0} max={100} unit="px" onChange={value => engine.updateTextNumber("shadowBlur", value)} />
        <div className="property-grid">
          <NumberField engine={engine} label="水平偏移" value={text.shadowOffsetX} min={-100} max={100} unit="px" onChange={value => engine.updateTextNumber("shadowOffsetX", value)} />
          <NumberField engine={engine} label="垂直偏移" value={text.shadowOffsetY} min={-100} max={100} unit="px" onChange={value => engine.updateTextNumber("shadowOffsetY", value)} />
        </div>
      </>}
    </details>
    <p className="field-help text-operation-help">{editing ? "Enter 换行，点击空白处结束输入。" : selected ? `${vertical ? "双击修改文字；拖动移动，上下中点调整长度。" : "双击修改文字；拖动移动，左右中点调整宽度。"}四角等比调整字号和框宽；旋转接近 90° 倍数时自动吸附。` : "添加后可直接输入。"}</p>
  </fieldset>;
}
