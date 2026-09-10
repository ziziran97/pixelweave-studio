import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ComponentType, SVGProps } from "react";
import { Brush, CircleHelp, Eraser, PanelLeftClose, RotateCcwSquare, Hand, ImagePlus, Layers3, ZoomOut, MousePointer2, ZoomIn, Redo2, Save, ScanSquare, SlidersHorizontal, Type, X, Undo2 } from "lucide-react";
import { EditorController } from "./editor/EditorController";
import { validatePreviewTexts } from "./editor/previewTextValidation";
import { previewReplacement } from "./editor/previewReplacement";
import { DEFAULT_ADJUSTMENTS } from "./types";
import type { EditorView, ToolId } from "./types";
import { DEFAULT_SHAPE } from "./editor/shape";
import type { EditorIntegration } from "./integration";
import { DrawingToolsPanel } from "./components/DrawingToolsPanel";
import { SubmissionDialog } from "./components/SubmissionDialog";
import { TextPanel } from "./components/TextPanel";
import { LayersPanel } from "./components/LayersPanel";
import { ResultPreview } from "./components/ResultPreview";
import { EraserPanel } from "./components/EraserPanel";
import { EraseExampleEntry } from "./components/EraseExampleEntry";
import { EraserNotice } from "./components/EraserNotice";
import { ActionButton } from "./components/ActionButton";
import { OriginalPreviewButton } from "./components/OriginalPreviewButton";
import { ConfirmationDialog } from "./components/ConfirmationDialog";
import { ShortcutHelp } from "./components/ShortcutHelp";
import { AdjustmentsPanel } from "./components/AdjustmentsPanel";

type EditorIconProps = SVGProps<SVGSVGElement> & { size?: string | number };
type EditorIcon = ComponentType<EditorIconProps>;

const TOOLS: Array<{ id: ToolId; label: string; icon: EditorIcon }> = [
  { id: "erase", label: "消除笔", icon: Eraser },
  { id: "draw", label: "绘制", icon: Brush },
  { id: "text", label: "文字", icon: Type },
  { id: "adjust", label: "调色", icon: SlidersHorizontal },
];
const EMPTY: EditorView = {
  ready: false, busy: false, task: false, notice: "正在载入图片…", tool: "erase", eraseMode: "brush", maskOperation: "add",
  noticeId: 0, noticePresentation: "transient",
  workspace: "erase", drawingTool: "draw", propertiesRequest: 0,
  brushSize: 50, drawSize: 6, color: "#2574d8", zoom: 1, size: { width: 1280, height: 800 },
  layers: [], selectionCount: 0, masks: 0, lassoPoints: 0,
  hasMask: false, maskHidden: false,
  unfinishedSelection: false, canUndo: false, canRedo: false, dirty: false,
  adjustments: DEFAULT_ADJUSTMENTS, compareOriginal: false, shape: DEFAULT_SHAPE,
  picking: false, colorEditing: false, submitting: false, submissionStage: "", needsConfirmation: false, saved: false, closed: false, canSubmit: false, canUpload: false,
};

export default function App({ integration, preview = false }: { integration?: EditorIntegration; preview?: boolean }) {
  const previewOnly = !!validatePreviewTexts && preview && !integration;
  const canvasRef = useRef<HTMLCanvasElement>(null), overlayRef = useRef<HTMLCanvasElement>(null), viewportRef = useRef<HTMLDivElement>(null), fileRef = useRef<HTMLInputElement>(null);
  const [engine, setEngine] = useState<EditorController | null>(null);
  const [view, setView] = useState<EditorView>(EMPTY);
  const [layersOpen, setLayersOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);
  const [canvasInteracting, setCanvasInteracting] = useState(false);
  const canvasPointer = useRef<number | undefined>(undefined);
  const settingsRequest = useRef(0);
  const [layerLocation, setLayerLocation] = useState<{ id: string; request: number }>();
  useEffect(() => {
    let cancelled = false;
    let controller: EditorController | undefined;
    // StrictMode cleanup can run before asynchronous canvas disposal. Defer the first mount.
    queueMicrotask(() => {
      if (cancelled || !canvasRef.current || !overlayRef.current || !viewportRef.current) return;
      controller = new EditorController(canvasRef.current, overlayRef.current, viewportRef.current, setView, integration, previewOnly);
      setEngine(controller);
      void controller.initialize().then(() => {
        if (cancelled) return;
        controller?.setTool("erase");
        if (previewOnly && previewReplacement) controller?.setPreviewScenario(previewReplacement.normalize(new URLSearchParams(window.location.search).get("replacement-demo")));
      });
    });
    return () => { cancelled = true; controller?.dispose(); };
  }, [integration, previewOnly]);
  const locked = !view.ready || !!view.confirmation || view.busy || view.task || !!view.pending || view.compareOriginal || !!view.compareAdjustments || view.colorEditing || view.picking || view.submitting || view.saved || view.closed;
  const compareDisabled = !view.ready || !!view.confirmation || view.busy || view.task || !!view.pending || view.unfinishedSelection || view.submitting || view.saved || view.colorEditing || view.picking || !!view.compareAdjustments;
  const execute = () => { void engine?.executeErase(); };
  const panelKind = view.workspace;
  const changeSettings = (open: boolean) => {
    if (settingsOpen === open) return;
    engine?.zoomTo(view.zoom);
    setSettingsOpen(open);
  };
  const uploadImage = async (file: File) => {
    if (!engine || !await engine.uploadReplacement(file)) return;
    // Upload starts editing a new image without reopening a manually collapsed panel.
    engine.setTool("erase");
  };
  useEffect(() => {
    const release = () => { canvasPointer.current = undefined; setCanvasInteracting(false); };
    const releasePointer = (event: PointerEvent) => {
      if (event.pointerId === canvasPointer.current && (event.type === "pointercancel" || (event.button === 0 && !(event.buttons & 1)))) release();
    };
    window.addEventListener("pointerup", releasePointer);
    window.addEventListener("pointercancel", releasePointer);
    window.addEventListener("blur", release);
    return () => { window.removeEventListener("pointerup", releasePointer); window.removeEventListener("pointercancel", releasePointer); window.removeEventListener("blur", release); };
  }, []);
  useLayoutEffect(() => {
    // Wait for canvas gestures to finish before changing the available canvas space.
    if (canvasInteracting || locked || view.unfinishedSelection) return;
    if (settingsRequest.current === view.propertiesRequest) return;
    settingsRequest.current = view.propertiesRequest;
    if (view.selectionCount && !settingsOpen) {
      engine?.zoomTo(view.zoom);
      setSettingsOpen(true);
    }
  }, [view.propertiesRequest, view.selectionCount, canvasInteracting, locked, view.unfinishedSelection, settingsOpen, engine, view.zoom]);
  const settingsTitle = view.selectionCount > 1 ? `已选 ${view.selectionCount} 个图层` : panelKind === "erase" ? "消除笔" : panelKind === "adjust" ? "调色" : panelKind === "text" ? "文字" : "绘制";
  const locateProblem = view.problemObjectId && view.layers.some(layer => layer.id === view.problemObjectId) ? () => {
    const ids = (view.problemObjectIds ?? [view.problemObjectId!]).filter(id => view.layers.some(layer => layer.id === id));
    const id = ids[(ids.indexOf(layerLocation?.id ?? "") + 1) % ids.length];
    engine?.zoomTo(view.zoom);
    engine?.selectLayer(id);
    setLayersOpen(true);
    setLayerLocation(previous => ({ id, request: (previous?.request ?? 0) + 1 }));
  } : undefined;

  if (view.closed) return <div className="editor-closed"><h1>{view.saved ? "图片已替换" : "编辑已关闭"}</h1><p>请返回审核页面继续操作。</p></div>;
  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark"><svg width="28" height="28" viewBox="0 0 32 32" fill="currentColor" aria-hidden="true"><path d="M4 5h7l5 7 5-7h7L20 16l8 11h-7l-5-7-5 7H4l8-11Z" /></svg></span><span><strong>自研图像编辑能力</strong>{previewOnly && <small className="preview-label" title="独立预览：模拟违禁词 durable、supreme（完整单词，不区分大小写），不会保存到任务">演示 · 模拟违禁词 durable、supreme</small>}</span>
        {previewOnly && previewReplacement && <label className="preview-scenario"><span>演示场景</span><select aria-label="替换流程演示场景" disabled={locked} value={view.previewScenario ?? "success"}
          onChange={event => engine?.setPreviewScenario(event.target.value)}>{previewReplacement.scenarios.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}
      </div>
      <div className="top-actions" role="group" aria-label="编辑与对比">
        <ActionButton below className="icon-button" aria-label="撤销" hint="撤销 Ctrl+Z" disabled={!view.canUndo} onClick={() => void engine?.undo()}><Undo2 /></ActionButton>
        <ActionButton below className="icon-button" aria-label="重做" hint="重做 Ctrl+Shift+Z" disabled={!view.canRedo} onClick={() => void engine?.undo(true)}><Redo2 /></ActionButton>
        <ActionButton below className="icon-button" aria-label="还原初始" hint="还原初始：恢复进入编辑时的图片，可撤销" disabled={locked || !view.dirty} onClick={() => void engine?.resetOriginal()}><RotateCcwSquare /></ActionButton>
        <OriginalPreviewButton below className="icon-button" engine={engine} active={view.compareOriginal} disabled={compareDisabled} />
      </div>
      <div className="top-right"><span className="document-size" title="当前图片尺寸（宽 × 高），缩放不改变实际尺寸">{view.size.width} × {view.size.height} px</span>
        <ActionButton below className="text-button upload-button" hint="载入编辑，暂不替换任务图片" disabled={!view.canUpload} onClick={() => fileRef.current?.click()}><ImagePlus size={17} />上传本地图片</ActionButton>
        <span className="action-divider" aria-hidden="true" />
        <ActionButton below className="primary-button" hint="将当前图片保存到任务" disabled={!view.canSubmit} onClick={() => void engine?.submitReplacement()}><Save size={17} />替换图片</ActionButton>
        <ActionButton below className="icon-button" aria-label="关闭编辑" hint="关闭编辑" disabled={view.busy || view.colorEditing || view.picking || view.submitting || view.saved} onClick={() => void engine?.requestClose()}><X size={19} /></ActionButton>
      </div>
    </header>
    <main className={`workspace${layersOpen ? "" : " layers-collapsed"}${settingsOpen ? "" : " settings-collapsed"}`}>
      <nav className="tool-rail" aria-label="编辑工具">
        {TOOLS.map(({ id, label, icon: Icon }) => <button key={id} className={`tool-button ${view.workspace === id ? "active" : ""}`} disabled={locked} aria-label={label} aria-controls="tool-settings" aria-pressed={view.workspace === id} onClick={() => { changeSettings(true); id === "draw" ? engine?.activateDrawing() : engine?.setTool(id); }}><Icon size={21} /><span>{label}</span></button>)}
        <div className="tool-help"><ActionButton floating hintPlacement="right" hintDelay={300} hintSuspended={helpOpen} dismissHintOnClick className="tool-button" aria-label="操作帮助" hint="操作说明与快捷键" disabled={locked || view.unfinishedSelection || canvasInteracting} onClick={() => setHelpOpen(true)}><CircleHelp size={21} /><span>帮助</span></ActionButton></div>
      </nav>
      <aside id="tool-settings" className="settings-panel" hidden={!settingsOpen} aria-label="工具属性">
        <div className="panel-heading"><span>{settingsTitle}</span><ActionButton floating className="icon-button" aria-label="收起工具属性" hint="收起工具属性，再次点击工具可展开" disabled={locked || view.unfinishedSelection || canvasInteracting} onClick={() => { changeSettings(false); viewportRef.current?.focus({ preventScroll: true }); }}><PanelLeftClose /></ActionButton></div>
        <div className={`panel-content${panelKind === "draw" && view.selectionCount <= 1 ? " drawing-properties" : ""}`}>
          {view.tool === "pan" && view.selectionCount <= 1 && panelKind !== "erase" && <p className="field-help canvas-mode-hint">拖动画布平移；点击底部选择可继续编辑对象。</p>}
          {view.selectionCount > 1 ? <div className="multi-selection-properties">
            <p className="multi-selection-guide">{view.tool === "pan" ? "当前为平移模式。点击底部「选择」可继续编辑所选图层。" : "拖动选中内容可一起移动，拖动控制点可缩放或旋转。"}</p>
            <p className="field-help">选择单个图层可编辑其属性。</p>
          </div>
            : panelKind === "erase" ? <>
              <EraserPanel view={view} engine={engine} locked={locked} execute={execute} />
              {previewOnly && <EraseExampleEntry disabled={locked || view.unfinishedSelection || canvasInteracting || helpOpen}
                selectRegion={view.canSelectEraseExample && engine ? () => engine.selectEraseExampleRegion() : undefined} />}
            </> : panelKind === "adjust" ? engine && <AdjustmentsPanel view={view} engine={engine} disabled={locked} /> : <>
            {view.text && engine ? <TextPanel key={view.selectedId ?? "new-text"} text={view.text} engine={engine} disabled={locked} selected={!!view.selectedId} editing={view.textEditing} vertical={view.textVertical} error={view.textError} fontError={view.textFontError} />
              : panelKind === "draw" && engine ? <DrawingToolsPanel view={view} engine={engine} disabled={locked} /> : null}
          </>}
        </div>
      </aside>
      <section className="canvas-stage">
        <div ref={viewportRef} className="canvas-viewport" aria-label="图片编辑画布" tabIndex={-1} onPointerDownCapture={event => { if (event.button === 0 && event.target instanceof HTMLCanvasElement && canvasPointer.current === undefined) { canvasPointer.current = event.pointerId; setCanvasInteracting(true); } }}>
          <canvas ref={canvasRef} /><canvas ref={overlayRef} className="mask-overlay" aria-hidden="true" />
          {view.picking && <div className="picking-hint" role="status">点击图片取色<button onClick={() => engine?.cancelColorPick()}>取消</button></div>}
          {!view.picking && <EraserNotice view={view} cancelTask={() => engine?.cancelTask()} locateProblem={locked ? undefined : locateProblem} />}
          {view.compareOriginal && <span className="original-badge">正在查看原图 · 松开返回编辑</span>}
          {view.compareAdjustments && <span className="original-badge">正在查看调色前 · 松开返回编辑</span>}
          <div className="canvas-controls">
          <div className="zoom-control" role="group" aria-label="画布操作">
            <div className="canvas-mode-controls" role="group" aria-label="画布模式">
              <ActionButton hint="选择并编辑文字、图形" aria-label="选择" aria-pressed={view.tool === "select" || view.tool === "text"} disabled={locked} onClick={() => engine?.setTool("select")}><MousePointer2 /></ActionButton>
              <ActionButton hint="拖动画布；按住空格可临时平移" aria-label="平移" aria-pressed={view.tool === "pan"} disabled={locked} onClick={() => engine?.setTool("pan")}><Hand /></ActionButton>
            </div>
            <div className="canvas-zoom-controls" role="group" aria-label="缩放查看">
              <ActionButton hint={view.zoom <= 0.03 ? "已缩小至最小比例 3%" : "缩小"} aria-label="缩小" disabled={view.zoom <= 0.03} onClick={() => engine?.zoomTo(view.zoom / 1.2)}><ZoomOut /></ActionButton><output aria-label="当前缩放比例">{Math.round(view.zoom * 100)}%</output>
              <ActionButton hint={view.zoom >= 4 ? "已放大至最大比例 400%" : "放大"} aria-label="放大" disabled={view.zoom >= 4} onClick={() => engine?.zoomTo(view.zoom * 1.2)}><ZoomIn /></ActionButton>
              <ActionButton className="actual-size" hint="以 100% 比例查看图片细节" aria-label="100% 查看" onClick={() => engine?.zoomTo(1)}>100%</ActionButton>
              <ActionButton hint="完整显示图片并居中" aria-label="适配画布" onClick={() => engine?.fit()}><ScanSquare /></ActionButton>
            </div>
            <div className="canvas-view-controls" role="group" aria-label="初始对比">
              <OriginalPreviewButton engine={engine} active={view.compareOriginal} disabled={compareDisabled} />
            </div>
            <div className="canvas-view-controls" role="group" aria-label="面板显示">
              <ActionButton hint={layersOpen ? "收起图层" : "展开图层"} aria-label={layersOpen ? "收起图层" : "展开图层"} aria-expanded={layersOpen} aria-controls="layers-panel" disabled={!view.ready || view.busy || view.unfinishedSelection || view.colorEditing || view.picking || !!view.pending || view.submitting || view.saved}
                onClick={() => { engine?.zoomTo(view.zoom); setLayersOpen(open => !open); }}><Layers3 /></ActionButton>
            </div>
          </div>
          </div>
        </div>
      </section>
      <LayersPanel view={view} engine={engine} disabled={locked} hidden={!layersOpen} locate={layerLocation} />
    </main>
    <input ref={fileRef} type="file" accept=".jpg,.jpeg" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void uploadImage(file); }} />
    {(view.submitting || view.saved) && engine && <SubmissionDialog view={view} engine={engine} previewOnly={previewOnly} />}
    {view.pending && <ResultPreview key={view.pending.assetId} result={view.pending} size={view.size} busy={view.busy} suspended={!!view.confirmation} accept={() => void engine?.acceptResult()} discard={() => engine?.discardResult()} retryPreview={() => void engine?.retryResultPreview()}
      onPreviewState={(outcome, attempt) => engine?.reportErasePreview(view.pending!.assetId, view.pending!.beforeUrl, view.pending!.afterUrl, outcome, attempt)} />}
    {view.confirmation && engine && <ConfirmationDialog key={view.confirmation.id} confirmation={view.confirmation} previewOnly={previewOnly} retryPreview={id => void engine.retryReplacementPreview(id)} answer={(id, accepted) => engine.answerConfirmation(id, accepted)} />}
    {helpOpen && <ShortcutHelp close={() => setHelpOpen(false)} />}
  </div>;
}
