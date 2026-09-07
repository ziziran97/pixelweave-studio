import type { EditorView } from "../types";
import type { EditorController } from "../editor/EditorController";
import { NumberField } from "./TextPanel";
import { ColorField } from "./ColorField";

export function DrawingPanel({ view, engine, disabled }: { view: EditorView; engine: EditorController; disabled: boolean }) {
  const width = view.drawing?.width ?? view.drawSize;
  const setWidth = (value: number) => view.drawing ? engine.updateDrawing({ width: value }) : engine.setDrawSize(value);
  return <fieldset disabled={disabled}>
    <NumberField label="画笔粗细" value={width} min={1} max={300} onChange={setWidth} />
    <input className="drawing-size" type="range" aria-label="画笔粗细滑块" min={1} max={300} value={width} onChange={event => setWidth(Number(event.target.value))} />
    <ColorField label="画笔颜色" value={view.drawing?.color ?? view.color} onChange={color => view.drawing ? engine.updateDrawing({ color }) : engine.setColor(color)} engine={engine} />
    <p className="field-help">按住拖动绘制，按住 Shift 画直线。滚轮缩放图片。</p>
    <p className="field-help">每笔独立，可选中修改颜色和粗细，或直接删除。</p>
  </fieldset>;
}
