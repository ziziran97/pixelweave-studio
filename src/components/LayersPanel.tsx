import { ArrowDown, ArrowUp, Eye, EyeOff, ImagePlus, Layers3, Lock, Unlock, Trash2, Type, Shapes, Copy } from "lucide-react";
import type { EditorView } from "../types";
import type { EditorController } from "../editor/EditorController";

export function LayersPanel({ view, engine, disabled }: { view: EditorView; engine: EditorController | null; disabled: boolean }) {
  return <aside className="layers-panel">
    <div className="layers-heading"><span><Layers3 size={18} />图层</span><strong>{view.layers.length}</strong></div>
    <p className="layer-legend">底图固定在下方，隐藏图层不参与成图。</p>
    <div className="layer-list">
      {view.layers.map(layer => <div key={layer.id} className={`layer-card ${layer.selected ? "selected" : ""} ${view.problemObjectId === layer.id ? "has-problem" : ""}`} data-purpose={layer.purpose}>
        <button className="layer-select" disabled={disabled || layer.purpose === "base" || layer.locked || !layer.visible} onClick={() => engine?.selectLayer(layer.id)} aria-label={`选择图层 ${layer.name}`}>
          <span className={`layer-thumb role-${layer.role}`}>{layer.role === "image" ? <ImagePlus /> : layer.role === "text" ? <Type /> : <Shapes />}</span>
          <span className="layer-info"><strong title={layer.name}>{layer.name}</strong><small>{view.problemObjectId === layer.id ? "文案需修改 · " : ""}{layer.purpose === "base" ? "当前底图 · 固定" : layer.visible ? "图片内容" : "已隐藏 · 不参与成图"}</small></span>
        </button>
        {layer.purpose !== "base" && <div className="layer-controls">
          <button aria-label={`${layer.visible ? "隐藏" : "显示"}${layer.name}`} disabled={disabled} onClick={() => engine?.updateLayer(layer.id, { visible: !layer.visible })}>{layer.visible ? <Eye /> : <EyeOff />}</button>
          <button aria-label={`${layer.locked ? "解锁" : "锁定"}${layer.name}`} disabled={disabled} onClick={() => engine?.updateLayer(layer.id, { locked: !layer.locked })}>{layer.locked ? <Lock /> : <Unlock />}</button>
        </div>}
      </div>)}
    </div>
    <div className="layer-order">
      <button title="上移一层" aria-label="上移一层" disabled={disabled || !view.selectedId} onClick={() => view.selectedId && engine?.moveLayer(view.selectedId, "up")}><ArrowUp /></button>
      <button title="下移一层" aria-label="下移一层" disabled={disabled || !view.selectedId} onClick={() => view.selectedId && engine?.moveLayer(view.selectedId, "down")}><ArrowDown /></button>
      <button title="复制对象" aria-label="复制对象" disabled={disabled || view.selectionCount !== 1} onClick={() => void engine?.duplicateSelected()}><Copy /></button>
      <button title="删除对象" aria-label="删除对象" disabled={disabled || !view.selectionCount} onClick={() => engine?.deleteSelected()}><Trash2 /></button>
    </div>
  </aside>;
}
