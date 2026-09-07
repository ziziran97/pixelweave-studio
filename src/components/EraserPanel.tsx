import { BoxSelect, Brush, CircleDashed, Eraser, Eye, EyeOff, Undo2 } from "lucide-react";
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
  brush: "按住拖动涂抹，松手完成",
  rect: "拖动框选；松手前按住空格可移动选框",
  freehand: "按住拖动圈选，松手自动闭合",
  lasso: "逐点点击，点击起点闭合",
};
export function EraserPanel({ view, engine, locked, execute }: {
  view: EditorView; engine: EditorController | null; locked: boolean; execute: () => void;
}) {
  const hint = view.eraseMode === "lasso" && view.lassoPoints
    ? view.lassoPoints < 3 ? "继续点击，至少添加三个点" : "点击起点或按 Enter 闭合"
    : MODE_HELP[view.eraseMode];
  const submitHint = view.unfinishedSelection ? "请先完成当前选区" : !view.hasMask ? "先选择需要消除的区域" : "";
  const showSubmitHint = !!submitHint && !view.task && !view.lassoPoints;
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
    {view.maskOperation === "subtract" && <p className="erase-subtract-hint">从已有选区中减去无需消除的区域</p>}
    {view.eraseMode === "brush" && <BrushSizeControl value={view.brushSize} disabled={locked || view.unfinishedSelection} change={value => engine?.setBrushSize(value)} />}
    <button type="button" className="mask-peek" disabled={locked || !view.hasMask || view.unfinishedSelection}
      aria-label="按住隐藏选区" title="临时隐藏选区遮罩，不会清空选区" aria-pressed={view.maskHidden}
      onPointerDown={event => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); engine?.setMaskHidden(true); }}
      onPointerUp={() => engine?.setMaskHidden(false)} onPointerCancel={() => engine?.setMaskHidden(false)}
      onLostPointerCapture={() => engine?.setMaskHidden(false)} onBlur={() => engine?.setMaskHidden(false)}
      onKeyDown={event => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); event.stopPropagation(); engine?.setMaskHidden(true); } }}
      onKeyUp={event => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); event.stopPropagation(); engine?.setMaskHidden(false); } }}>
      {view.maskHidden ? <EyeOff size={16} /> : <Eye size={16} />}{view.maskHidden ? "松开显示选区" : "按住隐藏选区"}
    </button>
    <div className="erase-actions">
      <button className="clear-selection" disabled={!view.masks && !view.unfinishedSelection} onClick={() => engine?.resetEraseSelection()}>清空选区</button>
      <button className="primary-button erase-submit" title={submitHint || "消除所选区域，处理后可对比并选择是否使用"} aria-describedby={showSubmitHint ? "erase-submit-hint" : undefined} disabled={!view.hasMask || view.unfinishedSelection} onClick={execute}><Eraser size={16} />{view.task ? "正在消除…" : "开始消除"}</button>
    </div>
    {showSubmitHint && <p id="erase-submit-hint" className="erase-submit-hint">{submitHint}</p>}
    {!view.compareOriginal && view.layers.some(layer => layer.purpose === "content") && <p className="erase-base-hint">当前仅显示底图，新增文字和绘制内容已保留。</p>}
  </fieldset>;
}
