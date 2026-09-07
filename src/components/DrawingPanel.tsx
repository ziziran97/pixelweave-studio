import type { EditorView } from "../types";
import type { EditorController } from "../editor/EditorController";
import { NumberField } from "./TextPanel";
import { ColorField } from "./ColorField";
import { PropertySlider } from "./PropertySlider";

export function DrawingPanel({ view, engine, disabled }: { view: EditorView; engine: EditorController; disabled: boolean }) {
  const width = view.drawing?.width ?? view.drawSize;
  const setWidth = (value: number) => view.drawing ? engine.updateDrawing({ width: value }) : engine.setDrawSize(value);
  return <fieldset disabled={disabled}>
    <div className="shape-number-control drawing-width-control">
      <NumberField label="画笔粗细" value={width} min={1} max={300} unit="px" cancelOnEscape onChange={setWidth} />
      <PropertySlider className="drawing-size" label="画笔粗细滑块" min={1} max={300} value={width}
        change={value => view.drawing ? engine.updateDrawing({ width: value }, false) : engine.setDrawSize(value)} commit={() => engine.finishPropertyEdit()} />
    </div>
    <ColorField label="画笔颜色" value={view.drawing?.color ?? view.color} channel="drawing" engine={engine} />
    <p className="field-help">{view.drawing ? "拖动调整位置，控制点调整尺寸或旋转。再次点击画笔可继续绘制。" : view.tool === "draw" ? "按住拖动绘制，按住 Shift 画直线。每笔独立，可选中修改或删除。" : "点击已有笔画可修改颜色和粗细。"}</p>
  </fieldset>;
}
