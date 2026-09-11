import type { EditorView } from "../types";
import type { EditorController } from "../editor/EditorController";
import { NumberField } from "./NumberField";
import { ColorField } from "./ColorField";
import { PropertySlider } from "./PropertySlider";
import { Circle, Square } from "lucide-react";
import { ShapeLineSelect } from "./ShapeLineSelect";

export function ShapePanel({ view, engine, disabled }: { view: EditorView; engine: EditorController; disabled: boolean }) {
  const label = view.shapeKind === "rect" ? "矩形" : "椭圆";
  const Icon = view.shapeKind === "rect" ? Square : Circle;
  return <fieldset disabled={disabled}>
    <div className="toggle-grid shape-options" role="group" aria-label="图形样式">
      {[{ filled: true, text: "实心" }, { filled: false, text: "边框" }].map(({ filled, text }) =>
        <button key={text} type="button" aria-label={text} aria-pressed={view.shape.filled === filled}
          className={view.shape.filled === filled ? "selected" : ""} title={filled ? "填充图形内部" : "空心边框，圈出重点"}
          onClick={() => engine.updateShape({ filled })}><Icon size={16} fill={filled ? "currentColor" : "none"} /><span>{text}</span></button>)}
    </div>
    <ColorField label={view.shape.filled ? "填充颜色" : "边框颜色"} value={view.shape.color} channel="shape" engine={engine} />
    {!view.shape.filled && <>
      <ShapeLineSelect value={view.shape.lineStyle} change={lineStyle => engine.updateShape({ lineStyle })} disabled={disabled || view.unfinishedSelection} />
      <div className="shape-number-control">
        <NumberField engine={engine} label="边框粗细" value={view.shape.lineWidth} min={1} max={100} unit="px" onChange={lineWidth => engine.updateShape({ lineWidth }, false)} />
        <PropertySlider label="边框粗细滑块" min={1} max={100} value={view.shape.lineWidth}
          change={lineWidth => engine.updateShape({ lineWidth }, false)} commit={() => engine.finishPropertyEdit()} />
      </div>
    </>}
    <div className="shape-number-control">
      <NumberField engine={engine} label="不透明度（%）" value={view.shape.opacity} min={0} max={100} onChange={opacity => engine.updateShape({ opacity }, false)} />
      <PropertySlider label="不透明度滑块" min={0} max={100} value={view.shape.opacity}
        change={opacity => engine.updateShape({ opacity }, false)} commit={() => engine.finishPropertyEdit()} />
    </div>
    {view.shape.opacity < 100 && <p className="field-help opacity-help">{view.shape.opacity === 0
      ? view.selectedId ? "图形完全透明，可调整不透明度恢复。" : "当前为 0%，新绘制的图形将不可见。"
      : "当前会透出下方内容，不能完全遮盖。"}</p>}
    {view.shapeKind === "rect" && <div className="shape-number-control shape-radius-control">
      <NumberField engine={engine} label="矩形圆角" value={view.shape.radius} min={0} max={view.shapeRadiusMax ?? 500} unit="px" onChange={radius => engine.updateShape({ radius }, false)} />
      <PropertySlider label="矩形圆角滑块" min={0} max={view.shapeRadiusMax ?? 500} value={view.shape.radius}
        change={radius => engine.updateShape({ radius }, false)} commit={() => engine.finishPropertyEdit()} />
    </div>}
    <p className="field-help">{view.selectedId ? `拖动调整位置，控制点调整尺寸或旋转。旋转接近 90° 倍数时自动吸附。再次点击${label}可继续绘制。` : view.tool === view.shapeKind ? `拖动绘制${label}，松手后可继续画。按住 Shift 画${view.shapeKind === "rect" ? "正方形" : "正圆"}。` : `点击已有${label}可调整属性。`}</p>
    {view.tool === view.shapeKind && <p className="field-help">按 V 或点击右下角「选择」后点选内容，也可直接从图层面板选择。</p>}
  </fieldset>;
}
