import { useEffect, useRef, useState } from "react";
import type { ComponentType, SVGProps } from "react";
import { Brush, Circle, Eraser, Eye, EyeOff, Hand, ImagePlus, MousePointer2, Redo2, RotateCcw, Save, Scan, SlidersHorizontal, Sparkles, Square, Type, X, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import { EditorController } from "./editor/EditorController";
import { DEFAULT_ADJUSTMENTS } from "./types";
import type { EditorView, ImageAdjustments, ToolId } from "./types";
import { DEFAULT_SHAPE } from "./editor/shape";
import type { EditorIntegration } from "./integration";
import { ShapePanel } from "./components/ShapePanel";
import { DrawingPanel } from "./components/DrawingPanel";
import { SubmissionDialog } from "./components/SubmissionDialog";
import { TextPanel } from "./components/TextPanel";
import { LayersPanel } from "./components/LayersPanel";
import { ResultPreview } from "./components/ResultPreview";
import { EraserPanel } from "./components/EraserPanel";
import { EraserNotice } from "./components/EraserNotice";

type EditorIconProps = SVGProps<SVGSVGElement> & { size?: string | number };
type EditorIcon = ComponentType<EditorIconProps>;

const TOOLS: Array<{ id: ToolId; label: string; icon: EditorIcon }> = [
  { id: "select", label: "选择", icon: MousePointer2 }, { id: "pan", label: "平移", icon: Hand },
  { id: "erase", label: "消除笔", icon: Eraser }, { id: "text", label: "文字", icon: Type },
  { id: "rect", label: "矩形", icon: Square },
  { id: "circle", label: "椭圆", icon: Circle },
  { id: "draw", label: "画笔", icon: Brush },
  { id: "adjust", label: "调色", icon: SlidersHorizontal },
];
const EMPTY: EditorView = {
  ready: false, busy: false, task: false, notice: "正在载入图片…", tool: "select", eraseMode: "brush", maskOperation: "add",
  noticeId: 0, noticePresentation: "transient",
  brushSize: 50, drawSize: 6, color: "#2574d8", zoom: 1, size: { width: 1280, height: 800 },
  layers: [], selectionCount: 0, masks: 0, lassoPoints: 0,
  hasMask: false, maskHidden: false,
  unfinishedSelection: false, canUndo: false, canRedo: false, dirty: false,
  adjustments: DEFAULT_ADJUSTMENTS, compareOriginal: false, shape: DEFAULT_SHAPE,
  picking: false, submitting: false, submissionStage: "", needsConfirmation: false, saved: false, closed: false, canSubmit: false, canUpload: false,
};

function Range({ label, value, min, max, change, commit }: { label: string; value: number; min: number; max: number; change: (value: number) => void; commit?: (value: number) => void }) {
  return <label className="slider-row"><span className="slider-title"><span>{label}</span><strong>{value}</strong></span>
    <input type="range" aria-label={label} min={min} max={max} value={value} onChange={event => change(Number(event.target.value))}
      onPointerUp={event => commit?.(Number(event.currentTarget.value))} onKeyUp={event => commit?.(Number(event.currentTarget.value))} onBlur={event => commit?.(Number(event.currentTarget.value))} />
  </label>;
}

export default function App({ integration }: { integration?: EditorIntegration }) {
  const canvasRef = useRef<HTMLCanvasElement>(null), overlayRef = useRef<HTMLCanvasElement>(null), viewportRef = useRef<HTMLDivElement>(null), fileRef = useRef<HTMLInputElement>(null);
  const [engine, setEngine] = useState<EditorController | null>(null);
  const [view, setView] = useState<EditorView>(EMPTY);
  useEffect(() => {
    let cancelled = false;
    let controller: EditorController | undefined;
    // StrictMode cleanup can run before asynchronous canvas disposal. Defer the first mount.
    queueMicrotask(() => {
      if (cancelled || !canvasRef.current || !overlayRef.current || !viewportRef.current) return;
      controller = new EditorController(canvasRef.current, overlayRef.current, viewportRef.current, setView, integration);
      setEngine(controller); void controller.initialize();
    });
    return () => { cancelled = true; controller?.dispose(); };
  }, [integration]);
  const locked = !view.ready || view.busy || view.task || !!view.pending || view.compareOriginal || view.picking || view.submitting || view.saved || view.closed;
  const execute = () => { void engine?.executeErase(); };
  const adjust = (key: keyof ImageAdjustments, value: number | boolean, commit = false) => engine?.setAdjustments({ ...view.adjustments, [key]: value }, commit);

  if (view.closed) return <div className="editor-closed"><h1>{view.saved ? "图片已替换" : "编辑已关闭"}</h1><p>请返回审核页面继续操作。</p></div>;
  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark"><Sparkles size={26} /></span><span><strong>PixelWeave</strong><small>Studio · 可编辑的图片二改</small></span></div>
      <div className="top-actions">
        <button className="icon-button" aria-label="撤销" title="撤销 Ctrl+Z" disabled={!view.canUndo} onClick={() => void engine?.undo()}><Undo2 /></button>
        <button className="icon-button" aria-label="重做" title="重做 Ctrl+Shift+Z" disabled={!view.canRedo} onClick={() => void engine?.undo(true)}><Redo2 /></button>
        <button className="text-button" disabled={!view.canUpload} onClick={() => fileRef.current?.click()}><ImagePlus size={17} />上传图片替换</button>
        <button className="text-button" title="清除本次编辑，可撤销" disabled={locked || !view.dirty} onClick={() => void engine?.resetOriginal()}><RotateCcw size={15} />还原初始</button>
      </div>
      <div className="top-right"><span className="document-size">{view.size.width} × {view.size.height}</span><button className="primary-button" disabled={!view.canSubmit} onClick={() => void engine?.submitReplacement()}><Save size={17} />替换图片</button><button className="icon-button" aria-label="关闭编辑" disabled={view.busy || view.submitting || view.saved} onClick={() => void engine?.requestClose()}><X size={19} /></button></div>
    </header>
    <main className="workspace">
      <nav className="tool-rail" aria-label="编辑工具">{TOOLS.map(({ id, label, icon: Icon }) => <button key={id} className={`tool-button ${view.tool === id ? "active" : ""}`} disabled={locked} aria-label={label} aria-pressed={view.tool === id} onClick={() => engine?.setTool(id)}><Icon size={21} /><span>{label}</span></button>)}</nav>
      <aside className="settings-panel">
        <div className="panel-heading">{view.text ? "文字编辑" : view.tool === "erase" ? "消除笔" : view.tool === "adjust" ? "图片调整" : view.shapeKind === "rect" ? "矩形" : view.shapeKind === "circle" ? "椭圆" : view.tool === "draw" || view.drawing ? "画笔" : "编辑设置"}</div>
        <div className="panel-content">
          {view.tool === "erase" ? <EraserPanel view={view} engine={engine} locked={locked} execute={execute} /> : view.tool === "adjust" ? <fieldset disabled={locked}>
            {([{ key: "brightness", label: "亮度", min: -100, max: 100 }, { key: "contrast", label: "对比度", min: -100, max: 100 }, { key: "saturation", label: "饱和度", min: -100, max: 100 }, { key: "blur", label: "模糊", min: 0, max: 30 }] as const).map(item => <Range key={item.key} label={item.label} value={view.adjustments[item.key]} min={item.min} max={item.max} change={value => adjust(item.key, value)} commit={value => adjust(item.key, value, true)} />)}
            <div className="toggle-grid"><button className={view.adjustments.grayscale ? "selected" : ""} onClick={() => adjust("grayscale", !view.adjustments.grayscale, true)}>黑白</button><button className={view.adjustments.sepia ? "selected" : ""} onClick={() => adjust("sepia", !view.adjustments.sepia, true)}>复古</button></div>
            <button className="secondary-button full" onClick={() => engine?.setAdjustments(DEFAULT_ADJUSTMENTS, true)}>重置调色</button>
          </fieldset> : <>
            {view.text && engine ? <TextPanel key={view.selectedId ?? "new-text"} text={view.text} engine={engine} disabled={locked} />
              : view.shapeKind && engine ? <ShapePanel key={view.selectedId ?? view.tool} view={view} engine={engine} disabled={locked} />
              : (view.tool === "draw" || view.drawing) && engine ? <DrawingPanel key={view.selectedId ?? "new-drawing"} view={view} engine={engine} disabled={locked || view.unfinishedSelection} />
              : <div className="tip-card"><strong>编辑当前图片</strong><span>选择左侧工具开始编辑，或选中图层调整属性。</span><span>新增文字、画笔和形状将保存到图片中，隐藏图层不参与成图。</span></div>}
            <div className="tip-card neutral"><strong>编辑快捷键</strong><span>Delete 删除 · Ctrl+D 复制</span><span>Ctrl+Z 撤销 · Ctrl+Shift+Z 重做</span><span>滚轮缩放 · 按住空格平移</span></div>
          </>}
        </div>
      </aside>
      <section className="canvas-stage">
        {view.tool !== "erase" && <div className="notice-bar" role="status"><span>{view.notice}</span>{view.task && <button onClick={() => engine?.cancelTask()}>取消任务</button>}</div>}
        <div ref={viewportRef} className="canvas-viewport" aria-label="图片编辑画布">
          <canvas ref={canvasRef} /><canvas ref={overlayRef} className="mask-overlay" aria-hidden="true" />
          {view.picking && <div className="picking-hint" role="status">点击图片取色<button onClick={() => engine?.cancelColorPick()}>取消</button></div>}
          {view.tool === "erase" && <>
            <EraserNotice view={view} cancelTask={() => engine?.cancelTask()} />
            <button className="canvas-peek" disabled={locked || !view.hasMask || view.unfinishedSelection}
              aria-label="按住查看图片" title={view.maskHidden ? "松开恢复选区" : "按住查看图片（临时隐藏选区）"} aria-pressed={view.maskHidden}
              onPointerDown={event => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); engine?.setMaskHidden(true); }}
              onPointerUp={() => engine?.setMaskHidden(false)} onPointerCancel={() => engine?.setMaskHidden(false)}
              onLostPointerCapture={() => engine?.setMaskHidden(false)} onBlur={() => engine?.setMaskHidden(false)}
              onKeyDown={event => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); event.stopPropagation(); engine?.setMaskHidden(true); } }}
              onKeyUp={event => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); event.stopPropagation(); engine?.setMaskHidden(false); } }}
            >{view.maskHidden ? <EyeOff size={17} /> : <Eye size={17} />}</button>
          </>}
          {view.compareOriginal && <span className="original-badge">正在查看初始图片（未改变编辑状态）</span>}
          <div className="zoom-control">
            <button title="缩小" aria-label="缩小" onClick={() => engine?.zoomTo(view.zoom / 1.2)}><ZoomOut /></button><span>{Math.round(view.zoom * 100)}%</span>
            <button title="放大" aria-label="放大" onClick={() => engine?.zoomTo(view.zoom * 1.2)}><ZoomIn /></button>
            <button title="100% 查看" aria-label="100% 查看" onClick={() => engine?.zoomTo(1)}>1:1</button>
            <button title="适配画布" aria-label="适配画布" onClick={() => engine?.fit()}><Scan /></button>
            <button className="compare-button" disabled={!view.ready || view.busy || view.task || !!view.pending || view.unfinishedSelection || view.submitting || view.saved || view.picking} aria-pressed={view.compareOriginal} onClick={() => engine?.setCompare(!view.compareOriginal)}>{view.compareOriginal ? "返回编辑" : "对比初始"}</button>
          </div>
        </div>
      </section>
      <LayersPanel view={view} engine={engine} disabled={locked} />
    </main>
    <input ref={fileRef} type="file" accept=".jpg,.jpeg" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void engine?.uploadReplacement(file); }} />
    {(view.submitting || view.saved) && engine && <SubmissionDialog view={view} engine={engine} />}
    {view.pending && <ResultPreview result={view.pending} busy={view.busy} accept={() => void engine?.acceptResult()} discard={() => engine?.discardResult()} />}
  </div>;
}
