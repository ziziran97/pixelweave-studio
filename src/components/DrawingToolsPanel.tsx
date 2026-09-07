import { Brush, Circle, Square } from "lucide-react";
import type { EditorView } from "../types";
import type { EditorController } from "../editor/EditorController";
import { DrawingPanel } from "./DrawingPanel";
import { ShapePanel } from "./ShapePanel";

const MODES = [
  { id: "draw", label: "画笔", icon: Brush },
  { id: "rect", label: "矩形", icon: Square },
  { id: "circle", label: "椭圆", icon: Circle },
] as const;

export function DrawingToolsPanel({ view, engine, disabled }: { view: EditorView; engine: EditorController; disabled: boolean }) {
  const mode = view.drawing ? "draw" : view.shapeKind ?? "draw";
  return <>
    <div className="drawing-mode-grid" role="group" aria-label="绘制类型">
      {MODES.map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-label={label}
        aria-pressed={mode === id} className={mode === id ? "selected" : ""}
        disabled={disabled || view.unfinishedSelection} onClick={() => engine.activateDrawing(id)}>
        <Icon size={20} /><span>{label}</span>
      </button>)}
    </div>
    {mode === "draw"
      ? <DrawingPanel key={view.selectedId ?? "new-drawing"} view={view} engine={engine} disabled={disabled || view.unfinishedSelection} />
      : <ShapePanel key={view.selectedId ?? mode} view={view} engine={engine} disabled={disabled} />}
  </>;
}
