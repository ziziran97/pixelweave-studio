import { BoxSelect, Brush, CircleDashed, Eraser, Undo2 } from "lucide-react";
import type { EditorView, EraseMode } from "../types";
import type { EditorController } from "../editor/EditorController";
import { BrushSizeControl } from "./BrushSizeControl";

function PolygonLassoIcon() {
  return <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 4 18 3l-1 11-6 6-4-6Z" />
    <path d="m7 14-3.5 4" />
    <circle cx="5" cy="4" r="2" fill="currentColor" stroke="none" />
  </svg>;
}

const MODES = [
  { id: "brush", label: "涂抹", icon: Brush },
  { id: "rect", label: "框选", icon: BoxSelect },
  { id: "freehand", label: "圈选", icon: CircleDashed },
  { id: "lasso", label: "套索", icon: PolygonLassoIcon },
] as const;
const MODE_HELP: Record<EraseMode, string> = {
  brush: "按住拖动涂抹，松手完成。",
  rect: "拖动框选区域，松手完成。",
  freehand: "按住圈出区域，松手自动闭合。",
  lasso: "逐点点击，最后点击起点闭合。",
};
export function EraserPanel({ view, engine, locked, execute }: {
  view: EditorView; engine: EditorController | null; locked: boolean; execute: () => void;
}) {
  const hint = view.eraseMode === "lasso" && view.lassoPoints
    ? view.lassoPoints < 3 ? "继续点击，至少三个点。" : "继续加点，点击起点闭合。"
    : MODE_HELP[view.eraseMode];
  return <fieldset disabled={locked}>
    <div className="erase-mode-grid">{MODES.map(({ id, label, icon: Icon }) => {
      const selected = view.eraseMode === id;
      return <button key={id} aria-label={id === "lasso" ? "多边形套索" : label} title={MODE_HELP[id]} aria-pressed={selected} className={selected ? "selected" : ""}
        onClick={() => engine?.setEraseMode(id)}><Icon /><span>{label}</span></button>;
    })}</div>
    <div className="erase-mode-guidance">
      <p className="erase-mode-hint" role="status">{hint}</p>
      {!!view.lassoPoints && <button title="退格或 Ctrl+Z 撤销上一点" onClick={() => engine?.undoLassoPoint()}><Undo2 size={13} />撤销上一点</button>}
    </div>
    <div className="toggle-grid"><button className={`mask-add ${view.maskOperation === "add" ? "selected" : ""}`} aria-pressed={view.maskOperation === "add"} onClick={() => engine?.setMaskOperation("add")}>＋ 添加选区</button><button disabled={!view.hasMask} className={`mask-subtract ${view.maskOperation === "subtract" ? "selected" : ""}`} aria-pressed={view.maskOperation === "subtract"} onClick={() => engine?.setMaskOperation("subtract")}>－ 减去选区</button></div>
    {view.eraseMode === "brush" && <BrushSizeControl value={view.brushSize} disabled={locked || view.unfinishedSelection} change={value => engine?.setBrushSize(value)} />}
    <div className="erase-actions">
      <button className="clear-selection" disabled={!view.masks && !view.unfinishedSelection} onClick={() => engine?.resetEraseSelection()}>清空选区</button>
      <button className="primary-button erase-submit" disabled={!view.hasMask || view.unfinishedSelection} onClick={execute}><Eraser size={16} />{view.task ? "消除中…" : "开始消除"}</button>
    </div>
  </fieldset>;
}
