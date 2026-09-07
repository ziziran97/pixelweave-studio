import { useEffect, useRef, useState } from "react";
import type { ComponentType, SVGProps } from "react";
import { Brush, Eraser, RotateCcwSquare, Hand, ImagePlus, Layers3, MousePointer2, Redo2, Save, Scan, SlidersHorizontal, Type, X, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import { EditorController } from "./editor/EditorController";
import { DEFAULT_ADJUSTMENTS } from "./types";
import type { EditorView, ImageAdjustments, ToolId } from "./types";
import { DEFAULT_SHAPE } from "./editor/shape";
import type { EditorIntegration } from "./integration";
import { DrawingToolsPanel } from "./components/DrawingToolsPanel";
import { SubmissionDialog } from "./components/SubmissionDialog";
import { TextPanel } from "./components/TextPanel";
import { LayersPanel } from "./components/LayersPanel";
import { ResultPreview } from "./components/ResultPreview";
import { EraserPanel } from "./components/EraserPanel";
import { EraserNotice } from "./components/EraserNotice";
import { ActionButton } from "./components/ActionButton";
import { OriginalPreviewButton } from "./components/OriginalPreviewButton";
import { ConfirmationDialog } from "./components/ConfirmationDialog";

type EditorIconProps = SVGProps<SVGSVGElement> & { size?: string | number };
type EditorIcon = ComponentType<EditorIconProps>;

const TOOLS: Array<{ id: ToolId; label: string; icon: EditorIcon }> = [
  { id: "erase", label: "消除笔", icon: Eraser }, { id: "text", label: "文字", icon: Type },
  { id: "draw", label: "绘制", icon: Brush },
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
  const [layersOpen, setLayersOpen] = useState(true);
  const [layerLocation, setLayerLocation] = useState<{ id: string; request: number }>();
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
  const locked = !view.ready || !!view.confirmation || view.busy || view.task || !!view.pending || view.compareOriginal || view.picking || view.submitting || view.saved || view.closed;
  const compareDisabled = !view.ready || !!view.confirmation || view.busy || view.task || !!view.pending || view.unfinishedSelection || view.submitting || view.saved || view.picking;
  const execute = () => { void engine?.executeErase(); };
  const adjust = (key: keyof ImageAdjustments, value: number | boolean, commit = false) => engine?.setAdjustments({ ...view.adjustments, [key]: value }, commit);
  const drawingActive = view.tool === "draw" || view.tool === "rect" || view.tool === "circle";
  const showDrawingPanel = !!view.drawing || !!view.shapeKind || drawingActive;
  const locateProblem = view.problemObjectId && view.layers.some(layer => layer.id === view.problemObjectId) ? () => {
    engine?.zoomTo(view.zoom);
    setLayersOpen(true);
    setLayerLocation(previous => ({ id: view.problemObjectId!, request: (previous?.request ?? 0) + 1 }));
  } : undefined;

  if (view.closed) return <div className="editor-closed"><h1>{view.saved ? "图片已替换" : "编辑已关闭"}</h1><p>请返回审核页面继续操作。</p></div>;
  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark"><svg width="28" height="28" viewBox="0 0 32 32" fill="currentColor" aria-hidden="true"><path d="M4 5h7l5 7 5-7h7L20 16l8 11h-7l-5-7-5 7H4l8-11Z" /></svg></span><span><strong>自研图像编辑能力</strong></span></div>
      <div className="top-actions" role="group" aria-label="编辑与对比">
        <ActionButton below className="icon-button" aria-label="撤销" hint="撤销 Ctrl+Z" disabled={!view.canUndo} onClick={() => void engine?.undo()}><Undo2 /></ActionButton>
        <ActionButton below className="icon-button" aria-label="重做" hint="重做 Ctrl+Shift+Z" disabled={!view.canRedo} onClick={() => void engine?.undo(true)}><Redo2 /></ActionButton>
        <ActionButton below className="icon-button" aria-label="还原初始" hint="还原初始：恢复进入编辑时的图片，可撤销" disabled={locked || !view.dirty} onClick={() => void engine?.resetOriginal()}><RotateCcwSquare /></ActionButton>
        <OriginalPreviewButton below className="icon-button" engine={engine} active={view.compareOriginal} disabled={compareDisabled} />
      </div>
      <div className="top-right"><span className="document-size">{view.size.width} × {view.size.height}</span>
        <ActionButton below className="text-button upload-button" hint="载入编辑，暂不替换任务图片" disabled={!view.canUpload} onClick={() => fileRef.current?.click()}><ImagePlus size={17} />上传本地图片</ActionButton>
        <span className="action-divider" aria-hidden="true" />
        <ActionButton below className="primary-button" hint="将当前图片保存到任务" disabled={!view.canSubmit} onClick={() => void engine?.submitReplacement()}><Save size={17} />替换图片</ActionButton>
        <ActionButton below className="icon-button" aria-label="关闭编辑" hint="关闭编辑" disabled={view.busy || view.submitting || view.saved} onClick={() => void engine?.requestClose()}><X size={19} /></ActionButton>
      </div>
    </header>
    <main className={`workspace${layersOpen ? "" : " layers-collapsed"}`}>
      <nav className="tool-rail" aria-label="编辑工具">{TOOLS.map(({ id, label, icon: Icon }) => <button key={id} className={`tool-button ${(id === "draw" ? drawingActive : view.tool === id) ? "active" : ""}`} disabled={locked} aria-label={label} aria-pressed={id === "draw" ? drawingActive : view.tool === id} onClick={() => id === "draw" ? engine?.activateDrawing() : engine?.setTool(id)}><Icon size={21} /><span>{label}</span></button>)}</nav>
      <aside className="settings-panel">
        <div className="panel-heading">{view.text ? "文字编辑" : view.tool === "erase" ? "消除笔" : view.tool === "adjust" ? "图片调整" : showDrawingPanel ? "绘制" : "编辑设置"}</div>
        <div className="panel-content">
          {view.tool === "erase" ? <EraserPanel view={view} engine={engine} locked={locked} execute={execute} /> : view.tool === "adjust" ? <fieldset disabled={locked}>
            {([{ key: "brightness", label: "亮度", min: -100, max: 100 }, { key: "contrast", label: "对比度", min: -100, max: 100 }, { key: "saturation", label: "饱和度", min: -100, max: 100 }, { key: "blur", label: "模糊", min: 0, max: 30 }] as const).map(item => <Range key={item.key} label={item.label} value={view.adjustments[item.key]} min={item.min} max={item.max} change={value => adjust(item.key, value)} commit={value => adjust(item.key, value, true)} />)}
            <div className="toggle-grid"><button className={view.adjustments.grayscale ? "selected" : ""} onClick={() => adjust("grayscale", !view.adjustments.grayscale, true)}>黑白</button><button className={view.adjustments.sepia ? "selected" : ""} onClick={() => adjust("sepia", !view.adjustments.sepia, true)}>复古</button></div>
            <button className="secondary-button full" onClick={() => engine?.setAdjustments(DEFAULT_ADJUSTMENTS, true)}>重置调色</button>
          </fieldset> : <>
            {view.text && engine ? <TextPanel key={view.selectedId ?? "new-text"} text={view.text} engine={engine} disabled={locked} />
              : showDrawingPanel && engine ? <DrawingToolsPanel view={view} engine={engine} disabled={locked} />
              : <div className="tip-card"><strong>编辑当前图片</strong><span>选择左侧工具开始编辑，或选中图层调整属性。</span><span>新增文字、画笔和形状将保存到图片中，隐藏图层不参与成图。</span></div>}
            <div className="tip-card neutral"><strong>编辑快捷键</strong><span>Delete 删除 · Ctrl+D 复制</span><span>Ctrl+Z 撤销 · Ctrl+Shift+Z 重做</span><span>滚轮缩放 · 按住空格平移</span></div>
          </>}
        </div>
      </aside>
      <section className="canvas-stage">
        {view.tool !== "erase" && <div className="notice-bar" role="status"><span>{view.notice}</span>{locateProblem && <button disabled={locked} onClick={locateProblem}>查看问题图层</button>}{view.task && <button onClick={() => engine?.cancelTask()}>取消任务</button>}</div>}
        <div ref={viewportRef} className="canvas-viewport" aria-label="图片编辑画布">
          <canvas ref={canvasRef} /><canvas ref={overlayRef} className="mask-overlay" aria-hidden="true" />
          {view.picking && <div className="picking-hint" role="status">点击图片取色<button onClick={() => engine?.cancelColorPick()}>取消</button></div>}
          {view.tool === "erase" && <EraserNotice view={view} cancelTask={() => engine?.cancelTask()} locateProblem={locked ? undefined : locateProblem} />}
          {view.compareOriginal && <span className="original-badge">正在查看原图 · 松开返回编辑</span>}
          <div className="canvas-controls">
          <div className="zoom-control" role="group" aria-label="画布操作">
            <div className="canvas-mode-controls" role="group" aria-label="画布模式">
              <ActionButton hint="选择：选中和调整对象" aria-label="选择" aria-pressed={view.tool === "select"} disabled={locked} onClick={() => engine?.setTool("select")}><MousePointer2 /></ActionButton>
              <ActionButton hint="平移：也可按住空格拖动画布" aria-label="平移" aria-pressed={view.tool === "pan"} disabled={locked} onClick={() => engine?.setTool("pan")}><Hand /></ActionButton>
            </div>
            <div className="canvas-zoom-controls" role="group" aria-label="缩放查看">
              <ActionButton hint="缩小" aria-label="缩小" onClick={() => engine?.zoomTo(view.zoom / 1.2)}><ZoomOut /></ActionButton><output aria-label="当前缩放比例">{Math.round(view.zoom * 100)}%</output>
              <ActionButton hint="放大" aria-label="放大" onClick={() => engine?.zoomTo(view.zoom * 1.2)}><ZoomIn /></ActionButton>
              <ActionButton className="actual-size" hint="按实际尺寸查看" aria-label="100% 查看" onClick={() => engine?.zoomTo(1)}>100%</ActionButton>
              <ActionButton hint="适配画布" aria-label="适配画布" onClick={() => engine?.fit()}><Scan /></ActionButton>
            </div>
            <div className="canvas-view-controls" role="group" aria-label="初始对比">
              <OriginalPreviewButton engine={engine} active={view.compareOriginal} disabled={compareDisabled} />
            </div>
            <div className="canvas-view-controls" role="group" aria-label="面板显示">
              <ActionButton hint={layersOpen ? "收起图层" : "展开图层"} aria-label={layersOpen ? "收起图层" : "展开图层"} aria-expanded={layersOpen} aria-controls="layers-panel" disabled={!view.ready || view.busy || view.unfinishedSelection || view.picking || !!view.pending || view.submitting || view.saved}
                onClick={() => { engine?.zoomTo(view.zoom); setLayersOpen(open => !open); }}><Layers3 /></ActionButton>
            </div>
          </div>
          </div>
        </div>
      </section>
      <LayersPanel view={view} engine={engine} disabled={locked} hidden={!layersOpen} locate={layerLocation} />
    </main>
    <input ref={fileRef} type="file" accept=".jpg,.jpeg" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void engine?.uploadReplacement(file); }} />
    {(view.submitting || view.saved) && engine && <SubmissionDialog view={view} engine={engine} />}
    {view.pending && <ResultPreview key={view.pending.assetId} result={view.pending} size={view.size} busy={view.busy} suspended={!!view.confirmation} accept={() => void engine?.acceptResult()} discard={() => engine?.discardResult()} />}
    {view.confirmation && engine && <ConfirmationDialog key={view.confirmation.id} confirmation={view.confirmation} answer={(id, accepted) => engine.answerConfirmation(id, accepted)} />}
  </div>;
}
