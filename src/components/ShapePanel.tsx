import type { EditorView } from "../types";
import type { EditorController } from "../editor/EditorController";
import { NumberField } from "./TextPanel";
import { ColorField } from "./ColorField";

export function ShapePanel({ view, engine, disabled }: { view: EditorView; engine: EditorController; disabled: boolean }) {
  return <fieldset disabled={disabled}>
    <label className="check-field"><input type="checkbox" checked={view.shape.filled} onChange={event => engine.updateShape({ filled: event.target.checked })} />填充</label>
    {!view.shape.filled && <div className="property-grid">
      <label className="property-field"><span>线条类型</span><select aria-label="线条类型" value={view.shape.lineStyle} onChange={event => engine.updateShape({ lineStyle: event.target.value as "solid" | "dashed" })}><option value="solid">实线</option><option value="dashed">虚线</option></select></label>
      <NumberField label="线条粗细" value={view.shape.lineWidth} min={1} max={100} onChange={lineWidth => engine.updateShape({ lineWidth })} />
    </div>}
    {view.shapeKind === "rect" && <NumberField label="矩形圆角" value={view.shape.radius} min={0} max={500} onChange={radius => engine.updateShape({ radius })} />}
    <ColorField label="形状颜色" value={view.shape.color} onChange={color => engine.updateShape({ color })} engine={engine} />
    <p className="field-help">{view.shape.filled ? "实色填充可遮盖原内容。" : "空心边框用于圈出重点。"}按住 Shift 绘制{view.shapeKind === "rect" ? "正方形" : "正圆"}。</p>
    <p className="field-help">画完后可选中修改样式，拖动控制点调整尺寸或旋转。</p>
  </fieldset>;
}
