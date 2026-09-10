import { useEffect, useState } from "react";
import { ChevronRight, RotateCcw, Columns2 } from "lucide-react";
import type { EditorController } from "../editor/EditorController";
import { adjustmentFilters, filterThumbnails, IMAGE_FILTERS } from "../editor/adjustments";
import { DEFAULT_ADJUSTMENTS } from "../types";
import type { EditorView, ImageAdjustments, ImageFilter } from "../types";
import { NumberField } from "./TextPanel";
import { PropertySlider } from "./PropertySlider";
import { ColorField } from "./ColorField";
import { ActionButton } from "./ActionButton";
import { HoldPreviewButton } from "./OriginalPreviewButton";

const BASICS = [
  { key: "brightness", label: "亮度", min: -100 }, { key: "contrast", label: "对比度", min: -100 },
  { key: "saturation", label: "饱和度", min: -100 }, { key: "temperature", label: "色温", min: -100 },
  { key: "sharpen", label: "锐化", min: 0 },
] as const;
export function AdjustmentsPanel({ view, engine, disabled }: { view: EditorView; engine: EditorController; disabled: boolean }) {
  const values = view.adjustments;
  const source = view.layers.find(layer => layer.purpose === "base")?.thumbnailUrl;
  const [preview, setPreview] = useState<{ source: string; images: Partial<Record<ImageFilter, string>> }>();
  const [previewError, setPreviewError] = useState(false);
  // Preset previews use full strength and exclude the selected filter. Changes to other adjustments are debounced.
  const previewKey = JSON.stringify({ ...values, filter: "none", filterStrength: 100 });
  useEffect(() => {
    setPreviewError(false);
    if (!source) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void filterThumbnails(source, JSON.parse(previewKey), controller.signal).then(images => {
        if (!controller.signal.aborted && images) setPreview({ source, images });
      }).catch(() => { if (!controller.signal.aborted) setPreviewError(true); });
    }, 150);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [source, previewKey]);
  const update = (patch: Partial<ImageAdjustments>, commit = true) => engine.setAdjustments({ ...values, ...patch }, commit);
  const control = (key: "brightness" | "contrast" | "saturation" | "temperature" | "sharpen" | "overlayStrength" | "filterStrength", label: string, min = 0, unit?: string) =>
    <div className="shape-number-control adjustment-control" key={key}>
      <div className="adjustment-number-row">
      <NumberField label={label} value={values[key]} min={min} max={100} unit={unit} cancelOnEscape onChange={value => update({ [key]: value })} />
      <ActionButton floating className="adjustment-single-reset" hint={`恢复${label}为 ${DEFAULT_ADJUSTMENTS[key]}${unit ?? ""}`} aria-label={`重置${label}`} disabled={values[key] === DEFAULT_ADJUSTMENTS[key]} onClick={() => update({ [key]: DEFAULT_ADJUSTMENTS[key] })}><RotateCcw size={14} /></ActionButton>
      </div>
      <PropertySlider label={`${label}滑块`} min={min} max={100} value={values[key]} change={value => update({ [key]: value }, false)} commit={() => engine.finishPropertyEdit()} />
      {key === "temperature" && <div className="temperature-guide" aria-hidden="true"><span>冷</span><span>暖</span></div>}
    </div>;
  return <div className="adjustment-panel">
    <HoldPreviewButton floating className="secondary-button full adjustment-compare" label="按住查看调色前" active={!!view.compareAdjustments}
      disabled={(!view.compareAdjustments && disabled) || view.unfinishedSelection || !adjustmentFilters(values).length}
      change={value => engine.setCompareAdjustments(value)}><Columns2 size={16} />按住查看调色前</HoldPreviewButton>
    <fieldset disabled={disabled}>
    <p className="field-help adjustment-scope">仅调整底图，新增文字和绘制内容保持不变。</p>
    <section aria-label="基础调节"><h3>基础调节</h3>
      {BASICS.map(item => control(item.key, item.label, item.min))}
    </section>
    <section className="adjustment-presets" aria-label="滤镜"><h3>滤镜</h3>
      <div className="filter-grid" role="group" aria-label="选择滤镜">
        {IMAGE_FILTERS.map(preset => <button key={preset.id} type="button" aria-label={`滤镜：${preset.label}`} aria-pressed={values.filter === preset.id}
          title={preset.id === "none" ? "取消滤镜，保留其他调节" : `${preset.label} · 100% 强度预览，选中后可调整`}
          className={`filter-option${values.filter === preset.id ? " selected" : ""}`} onClick={() => update({ filter: preset.id })}>
          <span className="filter-thumbnail">{preview?.source === source && preview?.images[preset.id] ? <img src={preview.images[preset.id]} alt="" /> : <span>预览</span>}</span>
          <span>{preset.label}</span>
        </button>)}
      </div>
      {previewError && <p className="field-help">缩略图暂不可用，可选择滤镜在画布查看效果。</p>}
      {values.filter !== "none" && control("filterStrength", "滤镜强度", 0, "%")}
    </section>
    <details className="adjustment-overlay"><summary><ChevronRight size={14} aria-hidden="true" />颜色叠加<span>{values.overlayStrength ? `${values.overlayStrength}%` : "无叠加"}</span></summary>
      <ColorField label="叠加颜色" value={values.overlayColor} channel="overlay" engine={engine} />
      {control("overlayStrength", "叠加强度", 0, "%")}
      {values.overlayStrength === 0 && <p className="field-help">选择颜色后调高强度，即可预览叠加效果。</p>}
      <button type="button" className="secondary-button full" disabled={values.overlayStrength === 0} onClick={() => update({ overlayStrength: 0 })}>取消叠加</button>
    </details>
    <button type="button" className="secondary-button full adjustment-reset" disabled={JSON.stringify(values) === JSON.stringify(DEFAULT_ADJUSTMENTS)} onClick={() => engine.setAdjustments(DEFAULT_ADJUSTMENTS, true)}><RotateCcw size={15} />重置调色</button>
    </fieldset>
  </div>;
}
