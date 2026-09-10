import type { EditorController } from "../editor/EditorController";
import { NumberInput } from "./NumberField";

export function BrushSizeControl({ value, disabled, change, engine }: { value: number; disabled: boolean; change: (value: number) => void; engine?: EditorController }) {
  return <div className="brush-size-control">
    <div className="slider-title">
      <label htmlFor="brush-size-number">笔刷大小</label>
      <span className="brush-size-value"><NumberInput id="brush-size-number" label="笔刷大小数值"
        value={value} min={4} max={300} unit="px" disabled={disabled} onChange={change} engine={engine} /><span>px</span></span>
    </div>
    <input type="range" aria-label="笔刷大小"
      min={4} max={300} step={1} value={value} disabled={disabled} onChange={event => change(Number(event.target.value))} />
  </div>;
}
