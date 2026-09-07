import { useLayoutEffect, useRef } from "react";
import { ArrowDown, ArrowUp, ArrowUpToLine, ArrowDownToLine, Eye, EyeOff, Image, Layers3, Lock, Unlock, Trash2, Type, RectangleHorizontal, Circle, Brush, Copy } from "lucide-react";
import type { EditorView } from "../types";
import type { EditorController } from "../editor/EditorController";
import { ActionButton } from "./ActionButton";

export function LayersPanel({ view, engine, disabled, hidden = false, locate }: {
  view: EditorView; engine: EditorController | null; disabled: boolean; hidden?: boolean;
  locate?: { id: string; request: number };
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const previousIds = useRef<string[]>([]);
  const lastLocate = useRef(0);
  const ids = view.layers.map(layer => layer.id);
  const orderKey = JSON.stringify(ids);
  const selectionKey = JSON.stringify(view.layers.filter(layer => layer.selected).map(layer => layer.id));
  useLayoutEffect(() => {
    const added = ids.find(id => !previousIds.current.includes(id));
    previousIds.current = ids;
    if (hidden || !listRef.current) return;
    const explicit = !!locate && locate.request !== lastLocate.current;
    const targetId = explicit ? locate.id : added ?? view.selectedId ?? view.layers.find(layer => layer.selected)?.id;
    const row = [...listRef.current.children].find(item => (item as HTMLElement).dataset.layerId === targetId) as HTMLElement | undefined;
    if (!row) return;
    if (explicit) { lastLocate.current = locate.request; row.focus({ preventScroll: true }); }
    // Scroll only this list; scrollIntoView can also move the canvas or the page.
    const bounds = listRef.current.getBoundingClientRect(), target = row.getBoundingClientRect();
    if (target.top < bounds.top) listRef.current.scrollTop += target.top - bounds.top;
    else if (target.bottom > bounds.bottom) listRef.current.scrollTop += target.bottom - bounds.bottom;
  }, [orderKey, selectionKey, hidden, locate]);

  const content = view.layers.filter(layer => layer.purpose !== "base");
  const index = content.findIndex(layer => layer.id === view.selectedId);
  const movable = view.selectionCount === 1 && index >= 0 && content[index].visible && !content[index].locked;
  const canUp = movable && index > 0, canDown = movable && index < content.length - 1;
  const deleteLabel = view.selectionCount > 1 ? `删除所选 ${view.selectionCount} 个图层` : "删除图层";
  const baseOnly = view.tool === "erase" && !view.compareOriginal && content.length > 0;
  return <aside id="layers-panel" className="layers-panel" hidden={hidden} aria-label="图层">
    <div className="layers-heading"><span><Layers3 size={18} />图层</span><strong aria-label={`共 ${view.layers.length} 个图层`}>{view.layers.length}</strong></div>
    <p className="layer-legend">{baseOnly ? "当前仅预览底图，新增内容已保留。" : "底图固定在下方，隐藏图层不参与成图。"}</p>
    <div ref={listRef} className="layer-list">
      {view.layers.map(layer => {
        const base = layer.purpose === "base", problem = view.problemObjectId === layer.id;
        const Icon = layer.role === "image" ? Image : layer.role === "text" ? Type : layer.kind === "rect" ? RectangleHorizontal : layer.kind === "ellipse" ? Circle : Brush;
        const status = [problem && "文案需修改", base && "底图 · 固定", !layer.visible && "已隐藏", layer.locked && !base && "已锁定", layer.transparent && "完全透明"].filter(Boolean).join(" · ");
        const reason = base ? "底图固定，不可选择" : !layer.visible && layer.locked ? "显示并解锁后可编辑" : !layer.visible ? "显示后可编辑" : layer.locked ? "解锁后可编辑" : undefined;
        return <div key={layer.id} tabIndex={-1} aria-label={`图层 ${layer.name}${status ? `，${status}` : ""}`} className={`layer-card${layer.selected ? " selected" : ""}${problem ? " has-problem" : ""}${!layer.visible ? " is-hidden" : ""}`} data-purpose={layer.purpose} data-layer-id={layer.id}>
          <button className="layer-select" disabled={disabled || base || layer.locked || !layer.visible} title={reason ?? layer.name} onClick={() => engine?.selectLayer(layer.id)} aria-label={`选择图层 ${layer.name}`} aria-pressed={layer.selected}>
            <span className={`layer-thumb role-${layer.role}`}>
              {layer.thumbnailUrl ? <img src={layer.thumbnailUrl} alt="" /> : <Icon aria-hidden="true" />}
              {!base && layer.color && <span className="layer-color" style={{ backgroundColor: layer.color }} aria-label={`颜色 ${layer.color}`} />}
            </span>
            <span className="layer-info"><strong title={layer.name}>{layer.name}</strong>{status && <small>{status}</small>}</span>
          </button>
          {!base && <div className="layer-controls">
            <ActionButton floating hint={layer.visible ? "隐藏图层，不参与成图" : "显示图层"} aria-label={`${layer.visible ? "隐藏" : "显示"}${layer.name}`} disabled={disabled} onClick={() => engine?.updateLayer(layer.id, { visible: !layer.visible })}>{layer.visible ? <Eye /> : <EyeOff />}</ActionButton>
            <ActionButton floating hint={layer.locked ? "解锁图层，继续编辑" : "锁定图层，防止误编辑"} className={layer.locked ? "is-locked" : undefined} aria-label={`${layer.locked ? "解锁" : "锁定"}${layer.name}`} disabled={disabled} onClick={() => engine?.updateLayer(layer.id, { locked: !layer.locked })}>{layer.locked ? <Lock /> : <Unlock />}</ActionButton>
          </div>}
        </div>;
      })}
    </div>
    <div className="layer-footer">
      {view.selectionCount > 1 && <span className="layer-selection-count" role="status">已选 {view.selectionCount} 个图层</span>}
      <div className="layer-order" role="group" aria-label="图层操作">
        <ActionButton floating hint={movable && !canUp ? "已在最上层" : "置顶"} aria-label="置顶" disabled={disabled || !canUp} onClick={() => view.selectedId && engine?.moveLayer(view.selectedId, "top")}><ArrowUpToLine /></ActionButton>
        <ActionButton floating hint={movable && !canUp ? "已在最上层" : "上移一层"} aria-label="上移一层" disabled={disabled || !canUp} onClick={() => view.selectedId && engine?.moveLayer(view.selectedId, "up")}><ArrowUp /></ActionButton>
        <ActionButton floating hint={movable && !canDown ? "已在最下层" : "下移一层"} aria-label="下移一层" disabled={disabled || !canDown} onClick={() => view.selectedId && engine?.moveLayer(view.selectedId, "down")}><ArrowDown /></ActionButton>
        <ActionButton floating hint={movable && !canDown ? "已在最下层" : "置底，仍在底图上方"} aria-label="置底" disabled={disabled || !canDown} onClick={() => view.selectedId && engine?.moveLayer(view.selectedId, "bottom")}><ArrowDownToLine /></ActionButton>
        <ActionButton floating className="layer-copy" hint="复制图层 Ctrl+D" aria-label="复制图层" disabled={disabled || view.selectionCount !== 1} onClick={() => void engine?.duplicateSelected()}><Copy /></ActionButton>
        <ActionButton floating hint={`${deleteLabel}，可撤销`} aria-label={deleteLabel} disabled={disabled || !view.selectionCount} onClick={() => engine?.deleteSelected()}><Trash2 /></ActionButton>
      </div>
    </div>
  </aside>;
}
