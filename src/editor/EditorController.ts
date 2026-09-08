import { ActiveSelection, Canvas, Ellipse, FabricImage, Path, Point, Rect, Textbox } from "fabric";
import type { FabricObject, TPointerEventInfo } from "fabric";
import { editorConfig } from "../config";
import { callEraseApi } from "../lib/eraseApi";
import { DEFAULT_ADJUSTMENTS } from "../types";
import { adjustmentFilters, normalizeAdjustments } from "./adjustments";
import type { DocumentSnapshot, EditorView, EraseMode, ImageAdjustments, MaskStroke, ObjectData, PendingResult, PointData, TextProperties, ToolId, ShapeProperties } from "../types";
import { Assets, defaultImage, validateJpeg } from "./assets";
import type { ImageAsset } from "./assets";
import { applyResult, assetIds, deepCopy, History, SERIALIZED_PROPS, sameDocumentContent, uid } from "./model";
import { exportMask, hasMaskCoverage, paintStroke, subtractionChangesMask } from "./mask";
import { makeSurface, renderDocument } from "./render";
import { ensureFont } from "./fonts";
import { applyTextProperties, applyTextBackgroundOpacity, textProperties, DEFAULT_TEXT, isVerticalText } from "./text";
import { textPlacement } from "./textPlacement";
import { SelectionGesture } from "./SelectionGesture";
import { ContentTextbox } from "./ContentTextbox";
import { ContentBrush } from "./ContentBrush";
import { DrawingCanvas } from "./DrawingCanvas";
import { applyShapeProperties, shapeProperties, rectRadiusLimit, syncRectRadius, DEFAULT_SHAPE } from "./shape";
import type { AddedText, EditorIntegration, ReplaceOutcome, ReplacementInput } from "../integration";
import { textCheckIssues } from "../integration";
import { validatePreviewTexts } from "./previewTextValidation";
import type { ConfirmationKind, EditorConfirmation, WorkspaceId } from "../types";

function strokeOutline(ctx: CanvasRenderingContext2D, halo = 1) {
  const color = ctx.strokeStyle, width = ctx.lineWidth;
  ctx.strokeStyle = "#fff"; ctx.lineWidth = width + halo * 2; ctx.stroke();
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
}
export type ColorChannel = "drawing" | "shape" | "fill" | "backgroundColor" | "stroke" | "shadowColor" | "overlay";
export interface ColorEdit { preview(color: string): void; finish(apply: boolean): void }
const POSITION_KEYS: Record<string, readonly [number, number]> = {
  ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
};

export class EditorController {
  readonly canvas: Canvas;
  private assets = new Assets();
  private history = new History();
  private original?: DocumentSnapshot;
  private masks: MaskStroke[] = [];
  private selection = new SelectionGesture();
  private adjustments = { ...DEFAULT_ADJUSTMENTS };
  private documentId = uid("document");
  private revision = 0;
  private generation = 0;
  private disposed = false;
  private ready = false;
  private busy = false;
  private job?: { id: string; controller: AbortController };
  private processingAssets = new Map<string, Set<string>>();
  private pending?: PendingResult;
  private confirmation?: EditorConfirmation;
  private confirmationResolve?: (accepted: boolean) => void;
  private compareOriginal = false;
  private editingViewport?: number[];
  private editingFitted?: boolean;
  private noticeValue = "正在载入图片…";
  private noticeId = 0;
  private noticePresentation: "quiet" | "transient" | "persistent" = "transient";
  private get notice() { return this.noticeValue; }
  private set notice(value: string) { this.noticeValue = value; this.noticeId++; this.noticePresentation = "transient"; }
  private tool: ToolId = "select";
  private workspace: WorkspaceId = "erase";
  private propertiesRequest = 0;
  private changingSelection = false;
  private propertyEdit = false;
  private nudgeKeys = new Set<string>();
  private lastDrawingTool: "draw" | "rect" | "circle" = "draw";
  private operation: "add" | "subtract" = "add";
  private hasMask = false;
  private coverageVersion = -1;
  private maskHidden = false;
  private brushSize = 50;
  private drawSize = 6;
  private color = "#2574d8";
  private size = { width: 1280, height: 800 };
  private shapeDraft?: { object: Rect | Ellipse; tool: "rect" | "circle"; start: PointData; screenStart: PointData };
  private shapeDefaults = { ...DEFAULT_SHAPE };
  private textDefaults = { ...DEFAULT_TEXT };
  private lastTextAdd?: { id: string; generation: number; at: number };
  private emptyTexts = new Set<Textbox>();
  private textComposition?: Textbox;
  private textInputEvents?: AbortController;
  private fontRetry?: { generation: number; selectedId?: string; message: string; run: () => Promise<void> };
  private source: "online" | "upload" = "online";
  private nameCounts: Record<string, number> = {};
  private colorPick?: { canvas: HTMLCanvasElement; apply: (color: string) => void; cancel?: () => void };
  private colorEdit?: ColorEdit;
  private colorLens?: HTMLDivElement;
  private pickRequest = 0;
  private preparingColorPick?: () => void;
  private submitting = false;
  private submissionStage = "";
  private submission?: ReplacementInput;
  private submissionRun = 0;
  private needsConfirmation = false;
  private savedRecord?: string;
  private closed = false;
  private problemObjectId?: string;
  private textIssues = new Map<string, { text: string; generation: number; words: string[] }>();
  private textIssueNotice?: string;
  private cursor?: PointData;
  private panning?: PointData;
  private space = false;
  private gestureActive = false;
  private pointerId?: number;
  private fitted = true;
  private previewCanvas = document.createElement("canvas");
  private committedMaskCanvas = document.createElement("canvas");
  private maskVersion = 0;
  private committedMaskKey = "";
  private originalElement?: HTMLImageElement;
  private observer: ResizeObserver;
  private previewFrame = 0;

  constructor(element: HTMLCanvasElement, private overlay: HTMLCanvasElement, private viewport: HTMLElement, private onChange: (view: EditorView) => void, private integration?: EditorIntegration, private preview = false) {
    this.canvas = new DrawingCanvas(element, { width: viewport.clientWidth, height: viewport.clientHeight, enableRetinaScaling: false, targetFindTolerance: 4,
      preserveObjectStacking: true, uniformScaling: false, backgroundColor: "#edf0f4", selectionColor: "rgba(37,116,216,.1)", selectionBorderColor: "#2574d8" });
    this.canvas.on("selection:created", () => this.selectionChanged());
    this.canvas.on("selection:updated", () => this.selectionChanged());
    this.canvas.on("selection:cleared", () => { this.finishNudge(); this.emit(); });
    this.canvas.on("object:modified", ({ target }) => {
      if (target instanceof Rect || target instanceof Ellipse) {
        const center = target.getCenterPoint(), width = target.width * Math.abs(target.scaleX), height = target.height * Math.abs(target.scaleY);
        target.set({ scaleX: 1, scaleY: 1 });
        if (target instanceof Rect) target.set({ width, height });
        else target.set({ rx: width / 2, ry: height / 2 });
        target.setPositionByOrigin(center, "center", "center"); target.setCoords();
      }
      for (const object of target instanceof ActiveSelection ? target.getObjects() : [target]) {
        if (object instanceof Rect) syncRectRadius(object, true);
      }
      this.commit();
    });
    this.canvas.on("object:moving", () => this.emit());
    this.canvas.on("object:scaling", ({ target }) => {
      for (const object of target instanceof ActiveSelection ? target.getObjects() : [target]) {
        if (object instanceof Rect) syncRectRadius(object);
      }
      this.emit();
    });
    this.canvas.on("object:rotating", () => this.emit());
    this.canvas.on("text:editing:entered", ({ target }) => {
      this.textInputEvents?.abort(); this.textInputEvents = new AbortController();
      const options = { signal: this.textInputEvents.signal };
      target.hiddenTextarea?.addEventListener("compositionstart", () => {
        if (target instanceof Textbox) this.textComposition = target;
        this.emit();
      }, options);
      target.hiddenTextarea?.addEventListener("compositionend", () => {
        this.textComposition = undefined; queueMicrotask(() => this.emit());
      }, options);
      this.emit();
    });
    this.canvas.on("text:editing:exited", ({ target }) => {
      this.textInputEvents?.abort(); this.textComposition = undefined;
      if (target instanceof Textbox && !target.text.trim()) {
        this.emptyTexts.add(target);
        // Fabric still dispatches object:modified after editing:exited. Remove
        // only once it has finished that dispatch and completed deselection.
        queueMicrotask(() => this.removeEmptyTexts());
      } else this.commit();
    });
    this.canvas.on("text:changed", () => this.emit());
    this.canvas.on("path:created", ({ path }) => {
      if (this.locked || this.tool !== "draw") { this.canvas.remove(path); return; }
      path.set({ editorId: uid("drawing"), editorName: this.nextName("画笔"), editorRole: "drawing", editorPurpose: "content", strokeUniform: true });
      this.commit();
    });
    this.canvas.on("mouse:down", event => this.pointerDown(event));
    this.canvas.upperCanvasEl.addEventListener("mousedown", this.captureColorDown, true);
    this.canvas.on("mouse:move", event => this.pointerMove(event));
    this.canvas.on("mouse:up", ({ e }) => this.pointerUp(e));
    this.canvas.on("mouse:out", () => { this.cursor = undefined; if (this.colorLens) this.colorLens.hidden = true; this.selection.closing = false; this.scheduleOverlay(); });
    this.canvas.on("mouse:wheel", ({ e }) => {
      e.preventDefault(); e.stopPropagation();
      if (this.colorPick || this.colorEdit || this.shapeDraft || (this.tool === "draw" && this.gestureActive) || this.space || (this.selection.draft && this.selection.mode !== "lasso")) return;
      this.zoomTo(this.canvas.getZoom() * Math.pow(0.999, e.deltaY), this.canvas.getViewportPoint(e));
    });
    this.canvas.on("after:render", () => this.scheduleOverlay());
    this.observer = new ResizeObserver(() => {
      const old = { width: this.canvas.width, height: this.canvas.height };
      this.canvas.setDimensions({ width: viewport.clientWidth, height: viewport.clientHeight });
      this.overlay.width = this.canvas.width; this.overlay.height = this.canvas.height;
      if (this.editingViewport) {
        this.editingViewport[4] += (this.canvas.width - old.width) / 2;
        this.editingViewport[5] += (this.canvas.height - old.height) / 2;
      }
      if (this.fitted) this.fit(); else this.canvas.relativePan(new Point((this.canvas.width - old.width) / 2, (this.canvas.height - old.height) / 2));
      this.emit();
    });
    this.observer.observe(viewport);
    window.addEventListener("keydown", this.keyDown);
    window.addEventListener("keyup", this.keyUp);
    window.addEventListener("blur", this.windowBlur);
    window.addEventListener("focusin", this.finishNudge);
    document.addEventListener("visibilitychange", this.finishNudge);
    window.addEventListener("pointerdown", this.windowPointerDown, true);
    window.addEventListener("pointerup", this.windowPointerUp, true);
    window.addEventListener("pointercancel", this.windowPointerCancel, true);
    window.addEventListener("beforeunload", this.beforeUnload);
    this.configure(); this.emit();
  }

  private get locked() { return !this.ready || !!this.confirmation || this.busy || !!this.job || !!this.pending || this.compareOriginal || !!this.colorPick || !!this.colorEdit || this.submitting || !!this.savedRecord || this.closed; }
  private get dirty() { return !!this.original && JSON.stringify(this.snapshot()) !== JSON.stringify(this.original); }
  private get contentDirty() {
    if (!this.original) return false;
    const visibleContent = (snapshot: DocumentSnapshot) => JSON.stringify({ size: snapshot.size,
      objects: snapshot.objects.filter(object => object.visible !== false).map(({ editorLocked: _lock, editorName: _name, selectable: _select, evented: _event, ...object }) => object),
      adjustments: snapshot.adjustments });
    return this.source === "upload" || visibleContent(this.snapshot()) !== visibleContent(this.original);
  }
  private nextName(label: string) { return `${label} ${this.nameCounts[label] = (this.nameCounts[label] ?? 0) + 1}`; }
  private get drawingInProgress() { return this.tool === "draw" && this.gestureActive; }
  private report(error: unknown) { if (!this.disposed && (error as Error)?.name !== "AbortError") { this.notice = (error as Error)?.message || "操作失败，请重试"; this.noticePresentation = "persistent"; this.emit(); } }

  private snapshot(): DocumentSnapshot {
    const serialized = this.canvas.toObject(SERIALIZED_PROPS) as { objects: ObjectData[] };
    const objects = serialized.objects.filter(object => object.editorId).map(object => {
      if (object.editorAssetId) delete object.src;
      // Selection and hit-test state are derived from role and lock, not document content.
      object.selectable = object.editorPurpose !== "base" && !object.editorLocked;
      object.evented = object.selectable;
      return object;
    });
    return { size: { ...this.size }, objects, masks: deepCopy(this.masks), source: this.source,
      adjustments: { ...this.adjustments } };
  }

  private emit() {
    if (this.disposed) return;
    if (this.coverageVersion !== this.maskVersion) {
      this.hasMask = hasMaskCoverage(this.masks, this.size);
      this.coverageVersion = this.maskVersion;
    }
    if (!this.hasMask && !this.selection.draft) this.operation = "add";
    const selected = this.canvas.getActiveObjects();
    const single = selected.length === 1 ? selected[0] : undefined;
    const problems = this.addedTexts().filter(item => {
      const issue = this.textIssues.get(item.id);
      return issue?.generation === this.generation && issue.text === item.text;
    });
    const issueSummary = problems.length ? this.textIssueSummary(problems.length) : "文案已修改，请再次点击「替换图片」检测";
    if (this.textIssueNotice && (this.notice === this.textIssueNotice ||
      (this.noticePresentation !== "persistent" && issueSummary !== this.textIssueNotice))) {
      // A changed issue count supersedes a transient action toast, but not another error.
      if (issueSummary !== this.notice) this.notice = issueSummary;
      this.noticePresentation = problems.length ? "persistent" : "transient";
      this.textIssueNotice = problems.length ? issueSummary : undefined;
    }
    const textIssue = single instanceof Textbox && problems.some(item => item.id === single.editorId) ? this.textIssues.get(single.editorId!) : undefined;
    if (this.fontRetry && (this.fontRetry.generation !== this.generation || this.fontRetry.selectedId !== single?.editorId)) this.fontRetry = undefined;
    const view: EditorView = {
      ready: this.ready, busy: this.busy, task: !!this.job, notice: this.notice, noticeId: this.noticeId, noticePresentation: this.noticePresentation, tool: this.tool, eraseMode: this.selection.mode,
      workspace: this.workspace, drawingTool: this.lastDrawingTool, propertiesRequest: this.propertiesRequest,
      maskOperation: this.operation, brushSize: this.brushSize, drawSize: this.drawSize, color: this.color,
      zoom: this.canvas.getZoom(), size: this.size,
      layers: this.canvas.getObjects().filter(object => object.editorId).map(object => ({ id: object.editorId!, name: object instanceof Textbox ? object.text.replace(/\s+/g, " ").trim().slice(0, 24) || "空白文字" : object.editorName ?? "图层",
        role: object.editorRole ?? "shape", purpose: object.editorPurpose ?? "content", visible: object.visible, locked: !!object.editorLocked,
        selected: selected.includes(object), transparent: (object instanceof Rect || object instanceof Ellipse || object instanceof Textbox) && object.opacity === 0,
        textIssueWords: problems.some(item => item.id === object.editorId) ? [...this.textIssues.get(object.editorId!)!.words] : undefined,
        kind: object instanceof Rect ? "rect" as const : object instanceof Ellipse ? "ellipse" as const : object instanceof Path ? "brush" as const : undefined,
        color: object.editorColor ?? (typeof (object instanceof Textbox ? object.fill : object.stroke) === "string" ? String(object instanceof Textbox ? object.fill : object.stroke) : undefined),
        thumbnailUrl: object.editorPurpose === "base" && object.editorAssetId ? this.assets.get(object.editorAssetId).url : undefined })).reverse(),
      selectionCount: selected.length, selectedId: single?.editorId, selectedPurpose: single?.editorPurpose,
      canCenterSelection: selected.length === 1 && !!this.positionTarget(),
      text: single instanceof Textbox ? textProperties(single) : this.workspace === "text" && !selected.length ? { ...this.textDefaults } : undefined,
      textEditing: single instanceof Textbox && single.isEditing,
      textVertical: single instanceof Textbox && isVerticalText(single),
      textError: single instanceof Textbox && single !== this.textComposition && textIssue ? `包含违禁词：${textIssue.words.join("、")}，请修改后再次替换。` : undefined,
      textFontError: this.workspace === "text" ? this.fontRetry?.message : undefined,
      shape: single instanceof Rect || single instanceof Ellipse ? shapeProperties(single) : { ...this.shapeDefaults },
      shapeRadiusMax: single instanceof Rect ? rectRadiusLimit(single) : undefined,
      shapeKind: single instanceof Rect ? "rect" : single instanceof Ellipse ? "circle" : this.workspace === "draw" && this.lastDrawingTool !== "draw" ? this.lastDrawingTool : undefined,
      drawing: single instanceof Path ? { color: String(single.stroke ?? this.color), width: single.strokeWidth } : undefined,
      picking: !!this.colorPick, colorEditing: !!this.colorEdit, submitting: this.submitting, submissionStage: this.submissionStage,
      needsConfirmation: this.needsConfirmation, saved: !!this.savedRecord, closed: this.closed,
      canSubmit: !this.locked && !this.gestureActive && !this.selection.draft && !this.shapeDraft && this.contentDirty,
      canUpload: this.ready && !this.confirmation && !this.busy && !this.submitting && !this.savedRecord && !this.closed && !this.colorPick && !this.colorEdit && !this.drawingInProgress,
      confirmation: this.confirmation,
      problemObjectId: problems[0]?.id ?? this.problemObjectId,
      problemObjectIds: problems.length ? problems.map(item => item.id) : this.problemObjectId ? [this.problemObjectId] : [],
      masks: this.masks.length,
      lassoPoints: this.selection.mode === "lasso" ? this.selection.draft?.points.length ?? 0 : 0,
      hasMask: this.hasMask, maskHidden: this.maskHidden,
      unfinishedSelection: !!this.selection.draft || !!this.shapeDraft || this.drawingInProgress,
      canUndo: !this.locked && (!!this.selection.draft || !!this.shapeDraft || this.propertyEdit || this.history.canUndo),
      canRedo: !this.locked && !this.selection.draft && !this.shapeDraft && !this.propertyEdit && this.history.canRedo, dirty: this.ready && this.dirty,
      adjustments: { ...this.adjustments }, pending: this.pending, compareOriginal: this.compareOriginal,
      originalUrl: this.original?.objects[0]?.editorAssetId ? this.assets.get(this.original.objects[0].editorAssetId).url : undefined,
    };
    this.onChange(view); this.scheduleOverlay();
  }

  private commit() {
    if (this.emptyTexts.size) return;
    if (this.disposed || !this.ready || this.busy || this.job || this.pending || this.submitting || this.savedRecord || this.closed) return;
    this.propertyEdit = false;
    this.nudgeKeys.clear();
    if (this.history.push(this.snapshot())) { this.revision++; this.problemObjectId = undefined; }
    this.collect(); this.emit();
  }

  private collect() {
    if (this.disposed) return;
    const pinned = this.original ? assetIds(this.original) : new Set<string>();
    this.processingAssets.forEach(ids => ids.forEach(id => pinned.add(id)));
    if (this.pending) pinned.add(this.pending.assetId);
    if (this.ready) assetIds(this.snapshot()).forEach(id => pinned.add(id));
    this.history.trim(editorConfig.historyBudgetBytes, pinned, id => this.assets.cost(id));
    this.history.entries.forEach(entry => assetIds(entry).forEach(id => pinned.add(id)));
    this.assets.collect(pinned);
  }

  async initialize() {
    const token = this.generation;
    try {
      const url = this.integration?.initialImage ?? (new URLSearchParams(location.search).get("image")?.trim() || editorConfig.defaultImageUrl);
      const blob = url instanceof Blob ? url : url ? await fetch(url).then(response => { if (!response.ok) throw new Error("默认图片无法加载"); return response.blob(); }) : await defaultImage();
      if (!this.disposed && token === this.generation) await this.openImage(blob, "当前图片", false);
    } catch (error) { this.report(error); }
  }

  private imageData(asset: ImageAsset, name: string): ObjectData {
    return { type: "Image", version: "7.4.0", left: 0, top: 0, width: asset.width, height: asset.height, originX: "left", originY: "top",
      scaleX: 1, scaleY: 1, angle: 0, flipX: false, flipY: false, skewX: 0, skewY: 0, opacity: 1, strokeWidth: 0,
      visible: true, backgroundColor: "#ffffff", selectable: false, evented: false, editorId: uid("image"), editorName: name,
      editorRole: "image", editorPurpose: "base", editorLocked: true, editorAssetId: asset.id } as ObjectData;
  }

  async openImage(blob: Blob, name: string, confirm = true) {
    if (this.disposed || this.confirmation || this.busy || this.colorEdit || this.colorPick || this.submitting || this.savedRecord) return;
    if (confirm && (this.dirty || this.job || this.pending || this.gestureActive || this.selection.draft || this.shapeDraft) && !await this.confirmAction("switch")) return;
    this.cancelTask(); this.discardResult(); this.compareOriginal = false; this.editingViewport = undefined; this.editingFitted = undefined;
    this.finishText(); this.cancelDraft();
    const token = ++this.generation;
    this.busy = true; this.configure(); this.notice = "正在打开图片…"; this.emit();
    try {
      const asset = await this.assets.add(blob);
      if (this.disposed || token !== this.generation) return;
      const snapshot: DocumentSnapshot = { size: { width: asset.width, height: asset.height }, objects: [this.imageData(asset, name)], masks: [], source: "online",
        adjustments: { ...DEFAULT_ADJUSTMENTS } };
      await this.loadSnapshot(snapshot, token);
      if (this.disposed || token !== this.generation) return;
      this.original = deepCopy(snapshot); this.history.reset(this.snapshot()); this.original = deepCopy(this.history.current);
      this.documentId = uid("document"); this.revision = 0; this.ready = true; this.closed = false; this.source = "online"; this.nameCounts = {};
      this.originalElement = new Image(); this.originalElement.src = asset.url;
      await this.originalElement.decode();
      this.notice = "图片已就绪，可以开始编辑";
      this.tool = "select"; this.fit();
    } catch (error) { this.report(error); }
    finally { if (!this.disposed && token === this.generation) { this.busy = false; this.collect(); this.configure(); this.emit(); } }
  }

  private async loadSnapshot(snapshot: DocumentSnapshot, token = this.generation) {
    // Decode into an offscreen canvas first; failures cannot partially clear the live document.
    const surface = await makeSurface(snapshot, this.assets);
    try {
      if (this.disposed || token !== this.generation) return;
      const objects = surface.getObjects(); surface.remove(...objects);
      this.canvas.discardActiveObject(); this.canvas.remove(...this.canvas.getObjects());
      this.size = { ...snapshot.size }; this.restoreMasks(snapshot); this.source = snapshot.source ?? "online";
      this.adjustments = { ...snapshot.adjustments };
      objects.forEach(object => object.set({ selectable: object.editorPurpose !== "base" && !object.editorLocked, evented: object.editorPurpose !== "base" && !object.editorLocked }));
      this.canvas.add(...objects);
      this.canvas.clipPath = new Rect({ left: 0, top: 0, originX: "left", originY: "top", width: this.size.width, height: this.size.height, strokeWidth: 0, absolutePositioned: true });
      this.canvas.requestRenderAll();
    } finally { await surface.dispose(); }
  }

  private restoreMasks(snapshot: DocumentSnapshot) {
    this.masks = deepCopy(snapshot.masks);
    this.invalidateMaskPreview();
  }

  async undo(redo = false) {
    if (this.locked) return;
    if (this.drawingInProgress) { this.cancelDraft(); this.configure(); this.emit(); return; }
    if (this.selection.draft || this.shapeDraft) {
      if (redo) return;
      if (this.selection.mode === "lasso" && this.selection.draft) this.undoLassoPoint();
      else { this.cancelDraft(); this.emit(); }
      return;
    }
    this.finishText(); this.commit();
    const selectedIds = this.canvas.getActiveObjects().map(object => object.editorId);
    const index = this.history.index + (redo ? 1 : -1);
    const snapshot = this.history.entries[index]; if (!snapshot) return;
    if (sameDocumentContent(this.history.current, snapshot)) {
      this.restoreMasks(snapshot); this.history.index = index; this.revision++;
      this.notice = redo ? "已重做" : "已撤销"; this.emit(); return;
    }
    this.busy = true; this.configure(); this.emit();
    try {
      await this.loadSnapshot(snapshot);
      if (!this.disposed) {
        const selected = this.canvas.getObjects().filter(object => selectedIds.includes(object.editorId) && object.editorPurpose !== "base" && object.visible && !object.editorLocked);
        if (selected.length) this.canvas.setActiveObject(selected.length === 1 ? selected[0] : new ActiveSelection(selected, { canvas: this.canvas }));
        this.syncSelectionWorkspace();
        this.history.index = index; this.revision++; this.notice = redo ? "已重做" : "已撤销";
      }
    }
    catch (error) { this.report(error); }
    finally { if (!this.disposed) { this.busy = false; this.configure(); this.emit(); } }
  }

  async resetOriginal() {
    if (this.locked || !this.original) return;
    if (!await this.confirmAction("reset")) return;
    this.finishText(); this.cancelDraft(); this.commit(); this.busy = true; this.configure(); this.emit();
    try { await this.loadSnapshot(this.original); this.notice = "已还原初始图片，可撤销恢复"; }
    catch (error) { this.report(error); }
    finally { if (!this.disposed) { this.busy = false; this.configure(); this.commit(); } }
  }

  setCompare(value: boolean) {
    if (this.disposed || value === this.compareOriginal) return;
    if (value) {
      if (this.confirmation || this.busy || this.job || this.pending || !this.ready || this.selection.draft || this.shapeDraft || this.drawingInProgress || this.submitting || this.savedRecord || this.closed || this.colorPick || this.colorEdit) return;
      this.finishText(); this.cancelDraft();
      this.editingViewport = [...this.canvas.viewportTransform]; this.editingFitted = this.fitted;
      this.compareOriginal = true;
      if (this.original && (this.original.size.width !== this.size.width || this.original.size.height !== this.size.height)) this.fit();
      else this.fitted = false;
    } else {
      this.compareOriginal = false;
      if (this.editingViewport) this.canvas.setViewportTransform(this.editingViewport as [number, number, number, number, number, number]);
      this.fitted = this.editingFitted ?? this.fitted;
      this.editingViewport = undefined; this.editingFitted = undefined;
    }
    this.configure(); this.emit();
  }

  private finishText() {
    const object = this.canvas.getActiveObject();
    if (object instanceof Textbox && object.isEditing) object.exitEditing();
    this.removeEmptyTexts();
  }
  private removeEmptyTexts() {
    if (!this.emptyTexts.size || this.disposed) return;
    const empty = [...this.emptyTexts].filter(text => !text.isEditing && !text.text.trim() && this.canvas.getObjects().includes(text));
    this.emptyTexts.clear();
    if (!empty.length) return;
    this.changingSelection = true;
    try { this.canvas.remove(...empty); }
    finally { this.changingSelection = false; }
    this.notice = "空文字已删除，可撤销恢复";
    this.configure(); this.commit();
  }
  editSelectedText() {
    if (this.locked || this.gestureActive) return;
    const text = this.canvas.getActiveObject();
    if (!(text instanceof Textbox) || text.editorLocked || !text.visible) return;
    this.tool = "text"; this.workspace = "text"; this.configure();
    text.enterEditing(); text.hiddenTextarea?.focus({ preventScroll: true }); this.emit();
  }
  async retryTextFont() {
    const retry = this.fontRetry;
    if (!retry || this.locked || retry.generation !== this.generation || retry.selectedId !== this.canvas.getActiveObject()?.editorId || this.workspace !== "text") return;
    this.notice = ""; this.fontRetry = undefined; await retry.run();
  }
  private invalidateMaskPreview() { this.maskVersion++; this.committedMaskKey = ""; }
  private cancelDraft() {
    this.gestureActive = false; this.pointerId = undefined;
    if (this.tool === "draw") {
      this.canvas.isDrawingMode = false; this.canvas.clearContext(this.canvas.contextTop);
    }
    this.panning = undefined; this.maskHidden = false; this.selection.cancel();
    if (this.shapeDraft) { this.canvas.remove(this.shapeDraft.object); this.shapeDraft = undefined; }
  }
  activateDrawing(tool = this.lastDrawingTool) {
    this.setTool(tool);
  }
  setTool(tool: ToolId) {
    if (this.locked || this.tool === tool) return;
    this.finishPropertyEdit();
    if (tool === "draw" || tool === "rect" || tool === "circle") this.lastDrawingTool = tool;
    if (tool !== "select" && tool !== "pan") this.workspace = tool === "rect" || tool === "circle" ? "draw" : tool;
    const cancelled = !!this.selection.draft;
    this.finishText(); this.cancelDraft(); this.tool = tool;
    if (tool !== "select" && tool !== "pan") this.canvas.discardActiveObject();
    this.configure();
    this.notice = tool === "text" ? "点击「添加文字」开始输入，也可选中已有文字继续编辑" : tool === "pan" ? "拖动画布平移；滚轮缩放" : tool === "erase" ? "选择需要消除的区域，选区不会自动提交" : "可选择、移动或编辑对象";
    if (cancelled) this.notice = "未完成选区已取消；已完成的选区保留";
    else if ((tool === "erase" || tool === "adjust") && this.canvas.getObjects().some(object => object.editorPurpose === "content")) {
      this.notice = tool === "erase"
        ? "仅消除底图内容；新增文字和绘制内容暂时隐藏，退出后恢复原有显示。"
        : "仅调整底图；新增文字和绘制内容保持不变。";
    }
    else this.noticePresentation = "quiet";
    this.emit();
  }
  setEraseMode(mode: EraseMode) {
    if (this.locked || (this.tool === "erase" && this.selection.mode === mode)) return;
    const cancelled = !!this.selection.draft;
    this.cancelDraft(); this.selection.mode = mode; this.tool = "erase"; this.workspace = "erase";
    this.notice = cancelled ? "未完成选区已取消；已完成的选区保留" : "选择需要消除的区域，选区不会自动提交";
    if (!cancelled) this.noticePresentation = "quiet";
    this.configure(); this.emit();
  }
  setMaskOperation(operation: "add" | "subtract") {
    if (this.locked || this.operation === operation) return;
    if (operation === "subtract" && !this.hasMask) { this.notice = "当前没有可减去的选区，请先添加区域"; this.emit(); return; }
    const cancelled = !!this.selection.draft;
    this.cancelDraft(); this.operation = operation;
    this.notice = cancelled ? "未完成选区已取消；已完成的选区保留" : operation === "add" ? "添加需要消除的区域" : "减去不需要消除的区域";
    if (!cancelled) this.noticePresentation = "quiet";
    this.emit();
  }
  setBrushSize(size: number) { if (this.locked || this.selection.draft) return; this.brushSize = Math.max(4, Math.min(300, Math.round(size))); this.emit(); }
  setMaskHidden(hidden: boolean) {
    if (hidden && (this.locked || this.selection.draft || this.tool !== "erase")) return;
    if (this.maskHidden === hidden) return;
    this.maskHidden = hidden; this.emit();
  }
  setDrawSize(size: number) { if (this.locked || this.drawingInProgress) return; this.drawSize = Math.max(1, Math.min(300, Math.round(size))); this.configure(); this.emit(); }
  setColor(color: string) { if (this.locked || this.drawingInProgress) return; this.color = color; this.shapeDefaults.color = color; this.configure(); this.emit(); }
  updateShape(patch: Partial<ShapeProperties>, commit = true) {
    if (this.locked || this.gestureActive) return;
    const object = this.canvas.getActiveObject();
    const selected = object instanceof Rect || object instanceof Ellipse ? object : undefined;
    if (selected?.editorLocked) return;
    if (selected && !commit && !this.propertyEdit) { this.commit(); this.propertyEdit = true; }
    const next = { ...(selected ? shapeProperties(selected) : this.shapeDefaults), ...patch };
    next.lineWidth = Math.max(1, Math.min(100, next.lineWidth));
    next.radius = Math.max(0, Math.min(selected instanceof Rect ? rectRadiusLimit(selected) : 500, next.radius));
    next.opacity = Number.isFinite(next.opacity) ? Math.max(0, Math.min(100, Math.round(next.opacity))) : 100;
    this.shapeDefaults = next;
    if (patch.color) this.color = patch.color;
    if (selected) {
      applyShapeProperties(selected, next); this.canvas.requestRenderAll();
      if (commit) this.commit(); else this.emit();
    }
    else this.emit();
  }
  updateDrawing(patch: { color?: string; width?: number }, commit = true) {
    if (this.locked || this.drawingInProgress) return;
    const object = this.canvas.getActiveObject();
    if (!(object instanceof Path) || object.editorLocked) return;
    if (!commit && !this.propertyEdit) { this.commit(); this.propertyEdit = true; }
    if (patch.color) { object.set("stroke", patch.color); this.color = patch.color; this.shapeDefaults.color = patch.color; }
    if (patch.width !== undefined) { this.drawSize = Math.max(1, Math.min(300, patch.width)); object.set("strokeWidth", this.drawSize); }
    object.setCoords(); this.canvas.requestRenderAll();
    if (commit) this.commit(); else this.emit();
  }
  finishPropertyEdit() { if (this.propertyEdit) this.commit(); }
  beginColorEdit(channel: ColorChannel): ColorEdit | undefined {
    if (this.locked || this.gestureActive || this.selection.draft || this.shapeDraft || this.canvas.getActiveObjects().length > 1) return;
    this.finishText(); this.finishPropertyEdit();
    if (channel === "overlay") {
      const before = { ...this.adjustments }, generation = this.generation;
      const valid = () => !this.disposed && generation === this.generation && this.colorEdit === edit;
      const edit: ColorEdit = {
        preview: color => {
          if (valid() && /^#[\da-f]{6}$/i.test(color)) {
            this.applyAdjustments({ ...before, overlayColor: color }); this.emit();
          }
        },
        finish: apply => {
          if (!valid()) return;
          this.colorEdit = undefined;
          if (!apply) this.applyAdjustments(before);
          this.configure(); if (apply) this.commit(); else this.emit();
        },
      };
      this.colorEdit = edit; this.configure(); this.emit(); return edit;
    }
    const object = this.canvas.getActiveObject(), generation = this.generation;
    const defaults = { color: this.color, shape: { ...this.shapeDefaults }, text: { ...this.textDefaults } };
    const shape = object instanceof Rect || object instanceof Ellipse ? shapeProperties(object) : undefined;
    const text = object instanceof Textbox ? textProperties(object) : undefined;
    const shadowColorMetadata = object?.editorTextShadowColor;
    const stroke = object instanceof Path ? object.stroke : undefined;
    const valid = () => !this.disposed && generation === this.generation && this.colorEdit === edit;
    const edit: ColorEdit = {
      preview: color => {
        if (!valid() || !/^#[\da-f]{6}$/i.test(color)) return;
        if (channel === "shape" || channel === "drawing") {
          this.color = color; this.shapeDefaults = { ...this.shapeDefaults, color };
          if (shape && (object instanceof Rect || object instanceof Ellipse)) applyShapeProperties(object, { ...shape, color });
          else if (object instanceof Path) object.set("stroke", color);
        } else {
          this.textDefaults = { ...this.textDefaults, [channel]: color };
          if (text && object instanceof Textbox) applyTextProperties(object, { ...text, [channel]: color });
        }
        this.canvas.requestRenderAll(); this.emit();
      },
      finish: apply => {
        if (!valid()) return;
        this.colorEdit = undefined;
        if (!apply) {
          this.color = defaults.color; this.shapeDefaults = defaults.shape; this.textDefaults = defaults.text;
          if (shape && (object instanceof Rect || object instanceof Ellipse)) applyShapeProperties(object, shape);
          if (text && object instanceof Textbox) applyTextProperties(object, text);
          if (object instanceof Path && stroke !== undefined) object.set("stroke", stroke);
        }
        // Cancel/no-op edits must not add metadata to legacy text objects.
        if (text && object instanceof Textbox && shadowColorMetadata === undefined && textProperties(object).shadowColor === text.shadowColor) delete object.editorTextShadowColor;
        this.configure(); if (apply && object) this.commit(); else this.emit();
      },
    };
    this.colorEdit = edit; this.configure(); this.emit(); return edit;
  }
  setFieldColor(channel: ColorChannel, color: string) {
    const edit = this.beginColorEdit(channel); edit?.preview(color); edit?.finish(true);
  }
  async startColorPick(apply: (color: string) => void, cancel?: () => void) {
    if ((this.locked && !this.colorEdit) || this.busy || this.colorPick || this.gestureActive || this.selection.draft || this.shapeDraft) { cancel?.(); return; }
    this.finishText(); this.busy = true; this.preparingColorPick = cancel ?? (() => {}); this.configure(); this.emit();
    const generation = this.generation, request = ++this.pickRequest;
    try {
      const blob = await renderDocument(this.snapshot(), this.assets, "final", "png");
      const bitmap = await createImageBitmap(blob);
      if (this.disposed || generation !== this.generation || request !== this.pickRequest) { bitmap.close(); return; }
      const canvas = document.createElement("canvas"); canvas.width = bitmap.width; canvas.height = bitmap.height;
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0); bitmap.close();
      this.preparingColorPick = undefined; this.colorPick = { canvas, apply, cancel }; this.notice = "点击图片取色，按 Esc 取消";
    } catch (error) { if (!this.disposed && request === this.pickRequest) { this.report(error); cancel?.(); } }
    finally { if (!this.disposed && request === this.pickRequest) { this.preparingColorPick = undefined; this.busy = false; this.configure(); this.emit(); } }
  }
  cancelColorPick(apply = false) {
    if (this.preparingColorPick) {
      const cancel = this.preparingColorPick; this.preparingColorPick = undefined; this.pickRequest++; this.busy = false;
      cancel(); this.configure(); this.emit(); return;
    }
    if (!this.colorPick) return;
    const cancel = this.colorPick.cancel;
    this.colorPick.canvas.width = this.colorPick.canvas.height = 0; this.colorPick = undefined;
    this.colorLens?.remove(); this.colorLens = undefined;
    this.notice = "已返回编辑"; this.configure(); this.emit();
    if (!apply) cancel?.();
  }
  private captureColorDown = (event: MouseEvent) => {
    if (!this.colorPick && !this.colorEdit && !this.busy) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (!this.colorPick || event.button !== 0) return;
    const point = this.canvas.getScenePoint(event);
    if (point.x < 0 || point.y < 0 || point.x >= this.size.width || point.y >= this.size.height) return;
    const data = this.colorPick.canvas.getContext("2d")!.getImageData(Math.floor(point.x), Math.floor(point.y), 1, 1).data;
    const color = "#" + [...data.slice(0, 3)].map(value => value.toString(16).padStart(2, "0")).join("");
    const apply = this.colorPick.apply; this.cancelColorPick(true); apply(color);
  };
  private moveColorLens(event: MouseEvent) {
    if (!this.colorPick) return;
    const point = this.canvas.getScenePoint(event), x = Math.floor(point.x), y = Math.floor(point.y);
    if (x < 0 || y < 0 || x >= this.size.width || y >= this.size.height) { if (this.colorLens) this.colorLens.hidden = true; return; }
    if (!this.colorLens) {
      this.colorLens = document.createElement("div"); this.colorLens.className = "color-lens";
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 99;
      this.colorLens.append(canvas, document.createElement("span")); document.body.append(this.colorLens);
    }
    const lens = this.colorLens; lens.hidden = false;
    lens.style.left = `${Math.max(8, Math.min(window.innerWidth - 124, event.clientX + (event.clientX > window.innerWidth - 150 ? -132 : 24)))}px`;
    lens.style.top = `${Math.max(8, Math.min(window.innerHeight - 146, event.clientY + 24))}px`;
    const ctx = lens.querySelector("canvas")!.getContext("2d")!; ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#edf0f4"; ctx.fillRect(0, 0, 99, 99); ctx.drawImage(this.colorPick.canvas, x - 5, y - 5, 11, 11, 0, 0, 99, 99);
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 3; ctx.strokeRect(45, 45, 9, 9); ctx.strokeStyle = "#111"; ctx.lineWidth = 1; ctx.strokeRect(45, 45, 9, 9);
    const data = this.colorPick.canvas.getContext("2d")!.getImageData(x, y, 1, 1).data;
    lens.querySelector("span")!.textContent = "#" + [...data.slice(0, 3)].map(value => value.toString(16).padStart(2, "0")).join("").toUpperCase();
  }
  async uploadReplacement(file: File) {
    if (!this.ready || this.confirmation || this.busy || this.submitting || this.savedRecord || this.closed || this.colorPick || this.colorEdit || this.drawingInProgress) return;
    if ((this.dirty || this.job || this.pending || this.selection.draft || this.shapeDraft) && !await this.confirmAction("upload")) return;
    this.busy = true; this.configure(); this.notice = "正在校验并载入图片…"; this.emit();
    const token = this.generation;
    try {
      const { jpeg } = await validateJpeg(file, file.name);
      const asset = await this.assets.add(jpeg);
      if (this.disposed || token !== this.generation) return;
      const next: DocumentSnapshot = { size: { width: asset.width, height: asset.height }, objects: [this.imageData(asset, "上传图片")],
        masks: [], source: "upload", adjustments: { ...DEFAULT_ADJUSTMENTS } };
      // loadSnapshot prepares all objects offscreen; a failed upload leaves the draft intact.
      await this.loadSnapshot(next, token);
      if (this.disposed || token !== this.generation) return;
      this.cancelTask(); this.discardResult(); this.cancelDraft(); this.compareOriginal = false; this.editingViewport = undefined; this.editingFitted = undefined;
      this.generation++; this.revision++; this.history.reset(this.snapshot());
      this.tool = "select"; this.notice = "图片已载入，可继续编辑；点击「替换图片」后保存到任务。"; this.fit();
      return true;
    } catch (error) { this.report(error); }
    finally { if (!this.disposed) { this.busy = false; this.configure(); this.collect(); this.emit(); } }
  }
  private addedTexts(): AddedText[] {
    return this.canvas.getObjects().flatMap(object => object instanceof Textbox && object.text.trim()
      ? [{ id: object.editorId!, text: object.text }] : []);
  }
  private textIssueSummary(count: number) {
    return `${count} 个文字图层的文案需修改。`;
  }
  async submitReplacement() {
    if (this.locked || this.gestureActive || this.selection.draft || this.shapeDraft || !this.contentDirty) return;
    if (!await this.confirmAction("replace")) return;
    this.finishText(); this.commit();
    if (!this.contentDirty) { this.notice = "空文字已删除，当前图片无需替换"; this.emit(); return; }
    if (!this.integration && !(this.preview && validatePreviewTexts)) { this.notice = "替换服务尚未接入，当前草稿已保留"; this.noticePresentation = "persistent"; this.emit(); return; }
    const generation = this.generation, revision = this.revision, texts = this.addedTexts(), run = ++this.submissionRun;
    this.submitting = true; this.submissionStage = "正在检查新增文案…"; this.configure(); this.emit();
    const current = () => !this.disposed && generation === this.generation && revision === this.revision && run === this.submissionRun;
    try {
      if (texts.length) {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const checked = await Promise.race([
          Promise.resolve().then(() => this.integration
            ? this.integration.validateTexts(texts.map(item => ({ ...item })), { ...this.integration.context })
            : validatePreviewTexts!(texts))
            .catch(() => { throw new Error("文案检测失败，请再次点击「替换图片」重试"); }),
          new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("文案检测超时，请再次点击「替换图片」重试")), 15000); }),
        ]).finally(() => clearTimeout(timeout));
        if (!current()) return;
        const issues = textCheckIssues(checked, texts);
        this.textIssues = new Map(issues.map(issue => [issue.objectId, { text: texts.find(item => item.id === issue.objectId)!.text, generation, words: issue.words }]));
        this.textIssueNotice = undefined; this.problemObjectId = undefined;
        if (checked.passed !== true) {
          if (issues.length) {
            const message = this.textIssueSummary(issues.length);
            this.finishSubmissionFailure(message, issues[0].objectId);
            this.problemObjectId = undefined;
            this.notice = message; this.textIssueNotice = message; this.noticePresentation = "persistent"; this.emit();
          } else this.finishSubmissionFailure(checked.message || "新增文案检查未通过", checked.objectId);
          return;
        }
      }
      if (!this.integration) {
        this.submissionRun++; this.submitting = false; this.submissionStage = "";
        this.notice = texts.length ? "文案检测通过。当前为演示，未保存到任务。" : "当前为演示，未保存到任务。";
        this.noticePresentation = "persistent"; this.configure(); this.emit(); return;
      }
      this.submissionStage = "正在合成并校验图片…"; this.emit();
      const image = await renderDocument(this.snapshot(), this.assets, "final");
      const checked = await validateJpeg(image);
      if (!current()) return;
      if (checked.width !== this.size.width || checked.height !== this.size.height) throw new Error("合成图片尺寸异常，请重试");
      this.submission = { submissionId: uid("replacement"), context: { ...this.integration.context,
        baseRecordId: this.source === "online" ? this.integration.context.baseRecordId : undefined },
        image: checked.jpeg, ...this.size, source: this.source, texts };
      this.submissionStage = "正在检测并替换图片…"; this.emit();
    } catch (error) { if (current()) this.finishSubmissionFailure((error as Error).message || "提交前检查失败，请重试"); return; }
    // After dispatch, transport errors are unknown outcomes, never definitive failures.
    try {
      const result = await this.integration.replace(this.submission!, message => {
        if (current() && this.submitting && !this.needsConfirmation) { this.submissionStage = message; this.emit(); }
      });
      if (current()) await this.handleReplacementResult(result);
    } catch { if (current() && !this.savedRecord) this.awaitReplacementConfirmation(); }
  }
  private finishSubmissionFailure(message: string, objectId?: string) {
    this.submissionRun++;
    this.submitting = false; this.needsConfirmation = false; this.submission = undefined; this.submissionStage = "";
    this.configure();
    if (objectId) {
      const object = this.canvas.getObjects().find(item => item.editorId === objectId);
      if (object?.visible && !object.editorLocked) this.selectLayer(objectId);
      const layerName = object instanceof Textbox ? object.text.slice(0, 24) : object?.editorName;
      if (layerName) message += `（对应文字：${layerName}${!object?.visible ? "，该图层已隐藏" : object.editorLocked ? "，该图层已锁定" : ""}）`;
    }
    this.problemObjectId = objectId;
    this.notice = message; this.noticePresentation = "persistent"; this.emit();
  }
  private awaitReplacementConfirmation() {
    this.needsConfirmation = true; this.submissionStage = "正在确认替换结果，请勿重复提交"; this.emit();
  }
  private async handleReplacementResult(result: ReplaceOutcome) {
    if (result?.status === "succeeded" && result.recordId) {
      this.savedRecord = result.recordId; this.submitting = false; this.needsConfirmation = false; this.submission = undefined;
      await this.returnToReview();
    } else if (result?.status === "failed") this.finishSubmissionFailure(result.message, result.objectId);
    else this.awaitReplacementConfirmation();
  }
  async confirmReplacement() {
    if (!this.needsConfirmation || !this.submission || !this.integration) return;
    const submission = this.submission, generation = this.generation;
    this.needsConfirmation = false; this.submissionStage = "正在确认替换结果…"; this.emit();
    try {
      const result = await this.integration.confirmResult(submission.submissionId, submission.context);
      if (!this.disposed && generation === this.generation) await this.handleReplacementResult(result);
    } catch { if (!this.disposed && generation === this.generation) this.awaitReplacementConfirmation(); }
  }
  async returnToReview() {
    if (!this.savedRecord || !this.integration || this.busy || this.closed) return;
    this.busy = true; this.submissionStage = "替换已成功，正在返回审核…"; this.emit();
    try { await this.integration.onClose({ reason: "saved", recordId: this.savedRecord }); if (!this.disposed) this.closed = true; }
    catch { if (!this.disposed) this.submissionStage = "图片已保存，审核页面刷新失败，请重新加载审核图片"; }
    finally { if (!this.disposed) { this.busy = false; this.configure(); this.emit(); } }
  }
  async requestClose() {
    if (this.confirmation || this.busy || this.colorEdit || this.colorPick || this.submitting || this.savedRecord || this.closed) return;
    if ((this.dirty || this.job || this.pending || this.gestureActive || this.selection.draft || this.shapeDraft) && !await this.confirmAction("close")) return;
    this.cancelTask(); this.discardResult(); this.cancelColorPick(); this.cancelDraft();
    this.generation++; this.closed = true; this.configure(); this.emit();
    try { await this.integration?.onClose({ reason: "discard" }); }
    catch { if (!this.disposed) { this.closed = false; this.notice = "返回审核失败，请重试"; this.configure(); this.emit(); } }
  }
  private async confirmAction(kind: ConfirmationKind) {
    if (this.disposed || this.confirmation) return false;
    this.finishText();
    const id = uid("confirmation"), generation = this.generation, revision = this.revision;
    this.confirmation = { id, kind };
    const decision = new Promise<boolean>(resolve => { this.confirmationResolve = resolve; });
    this.configure(); this.emit();
    const accepted = await decision;
    if (this.confirmation?.id !== id) return false;
    this.confirmation = undefined; this.confirmationResolve = undefined;
    this.configure(); this.emit();
    return accepted && !this.disposed && generation === this.generation && revision === this.revision;
  }
  answerConfirmation(id: string, accepted: boolean) {
    if (this.confirmation?.id !== id || !this.confirmationResolve) return;
    const resolve = this.confirmationResolve; this.confirmationResolve = undefined; resolve(accepted);
  }
  undoLassoPoint() {
    if (this.locked || this.selection.mode !== "lasso" || !this.selection.draft) return;
    this.selection.undoPoint();
    if (!this.selection.draft) { this.cancelDraft(); this.notice = "已取消本次套索"; }
    else { this.notice = `已撤销上一点，当前 ${this.selection.draft.points.length} 个点`; this.noticePresentation = "quiet"; }
    this.emit();
  }
  resetEraseSelection() {
    if (this.locked) return;
    this.cancelDraft(); this.masks = []; this.operation = "add"; this.invalidateMaskPreview();
    this.notice = "已清空选区，可通过顶部撤销恢复"; this.commit();
  }

  private configure() {
    const editable = !this.locked && !this.space;
    const selected = new Set([...this.canvas.getActiveObjects(), this.canvas.getActiveObject()]);
    selected.forEach(object => {
      if (object && (object.editorPurpose === "content" || object instanceof ActiveSelection)) object.set({ borderColor: "#287dcc", borderOpacityWhenMoving: 1,
        cornerColor: "#ffffff", cornerStrokeColor: "#287dcc", transparentCorners: false });
      // Reapply editing assistance after selection, clone and history restore.
      // Keep the existing free rotation of a multi-selection unchanged.
      if (object?.editorPurpose === "content") object.set({ snapAngle: 90, snapThreshold: 5 });
    });
    const selection = editable && (this.tool === "select" || this.tool === "text");
    this.canvas.selection = selection; this.canvas.skipTargetFind = !selection;
    this.canvas.isDrawingMode = editable && this.tool === "draw";
    this.canvas.defaultCursor = this.colorPick ? "crosshair" : this.tool === "draw" ? "none" : this.tool === "pan" || this.space ? "grab" : this.tool === "select" || this.tool === "text" ? "default" : "crosshair";
    const brush = new ContentBrush(this.canvas); brush.color = this.color; brush.width = this.drawSize; this.canvas.freeDrawingBrush = brush; this.canvas.freeDrawingCursor = "none";
    this.canvas.requestRenderAll();
  }

  fit() {
    if (this.disposed || this.confirmation) return;
    const size = this.compareOriginal && this.original ? this.original.size : this.size;
    const zoom = Math.max(0.03, Math.min(1, (this.canvas.width - 80) / size.width, (this.canvas.height - 80) / size.height));
    this.canvas.setViewportTransform([zoom, 0, 0, zoom, (this.canvas.width - size.width * zoom) / 2, (this.canvas.height - size.height * zoom) / 2]);
    this.fitted = true; this.emit();
  }
  zoomTo(value: number, point = new Point(this.canvas.width / 2, this.canvas.height / 2)) {
    if (this.disposed || this.confirmation) return;
    this.fitted = false; this.canvas.zoomToPoint(point, Math.max(0.03, Math.min(4, value))); this.emit();
  }

  private scene(event: TPointerEventInfo) {
    const point = this.canvas.getScenePoint(event.e);
    return { x: Math.max(0, Math.min(this.size.width, point.x)), y: Math.max(0, Math.min(this.size.height, point.y)) };
  }
  private pointerDown(event: TPointerEventInfo) {
    this.finishPropertyEdit();
    if (this.colorPick && (event.e as MouseEvent).button === 0) {
      const point = this.canvas.getScenePoint(event.e);
      if (point.x < 0 || point.y < 0 || point.x >= this.size.width || point.y >= this.size.height) return;
      const data = this.colorPick.canvas.getContext("2d")!.getImageData(Math.floor(point.x), Math.floor(point.y), 1, 1).data;
      const color = "#" + [...data.slice(0, 3)].map(value => value.toString(16).padStart(2, "0")).join("");
      const apply = this.colorPick.apply; this.cancelColorPick(true); apply(color); return;
    }
    if (this.locked || this.maskHidden) return;
    const mouse = event.e as MouseEvent;
    if (typeof mouse.button === "number" && mouse.button !== 0) return;
    if (this.gestureActive) return;
    this.gestureActive = true;
    if (this.tool === "pan" || this.space) { this.panning = { x: mouse.clientX, y: mouse.clientY }; return; }
    const raw = this.canvas.getScenePoint(event.e);
    if (raw.x < 0 || raw.y < 0 || raw.x > this.size.width || raw.y > this.size.height) { this.gestureActive = false; return; }
    const point = this.scene(event);
    if (this.tool === "rect" || this.tool === "circle") {
      const properties = { left: point.x, top: point.y, originX: "left" as const, originY: "top" as const,
        selectable: false, evented: false, excludeFromExport: true };
      const object = this.tool === "rect" ? new Rect({ ...properties, width: 1, height: 1 })
        : new Ellipse({ ...properties, rx: 1, ry: 1 });
      applyShapeProperties(object, this.shapeDefaults);
      this.shapeDraft = { object, tool: this.tool, start: point, screenStart: { x: mouse.clientX, y: mouse.clientY } }; this.canvas.add(object); this.emit(); return;
    }
    if (this.tool !== "erase") return;
    this.noticePresentation = "quiet";
    if (this.selection.begin(point, this.operation, this.brushSize, this.canvas.getZoom())) this.finishLasso();
    else this.emit();
  }
  private pointerMove(event: TPointerEventInfo, final = false) {
    const mouse = event.e as MouseEvent;
    if (this.colorPick) { this.moveColorLens(mouse); return; }
    if (this.panning) {
      this.canvas.relativePan(new Point(mouse.clientX - this.panning.x, mouse.clientY - this.panning.y));
      this.panning = { x: mouse.clientX, y: mouse.clientY }; this.fitted = false; this.emit(); return;
    }
    const raw = this.canvas.getScenePoint(event.e);
    const point = { x: Math.max(0, Math.min(this.size.width, raw.x)), y: Math.max(0, Math.min(this.size.height, raw.y)) };
    this.cursor = this.canvas.getViewportPoint(event.e);
    if (this.locked) { this.scheduleOverlay(); return; }
    if (this.shapeDraft) {
      const { object, start } = this.shapeDraft;
      if (mouse.shiftKey) {
        const dx = point.x - start.x, dy = point.y - start.y;
        const length = Math.min(Math.max(Math.abs(dx), Math.abs(dy)), dx < 0 ? start.x : this.size.width - start.x, dy < 0 ? start.y : this.size.height - start.y);
        point.x = start.x + (dx < 0 ? -length : length); point.y = start.y + (dy < 0 ? -length : length);
      }
      const left = Math.min(start.x, point.x), top = Math.min(start.y, point.y);
      const width = Math.abs(start.x - point.x), height = Math.abs(start.y - point.y);
      if (object instanceof Rect) { object.set({ left, top, width, height }); syncRectRadius(object); }
      else if (object instanceof Ellipse) object.set({ left, top, rx: width / 2, ry: height / 2 });
      object.setCoords(); this.canvas.requestRenderAll();
    }
    this.selection.move(raw, this.size, this.canvas.getZoom(), final);
    this.scheduleOverlay();
  }
  private pointerUp(event: TPointerEventInfo["e"]) {
    const mouse = event as MouseEvent;
    if (mouse.button !== 0 || (mouse.buttons & 1) || !this.gestureActive) return;
    if (event instanceof PointerEvent && this.pointerId !== undefined && event.pointerId !== this.pointerId) return;
    if (this.panning || this.shapeDraft || (this.selection.draft && this.selection.mode !== "lasso")) this.pointerMove({ e: event } as TPointerEventInfo, true);
    this.gestureActive = false; this.pointerId = undefined;
    this.panning = undefined; this.selection.endMove();
    if (this.locked) { this.emit(); return; }
    if ((this.tool === "select" || this.tool === "text") && this.canvas.getActiveObjects().length) this.propertiesRequest++;
    if (this.shapeDraft) {
      const { object, tool, screenStart } = this.shapeDraft; this.shapeDraft = undefined;
      // A deliberate screen-space drag may form a narrow but valid shape at any zoom.
      if (Math.hypot(mouse.clientX - screenStart.x, mouse.clientY - screenStart.y) < 4 ||
        !Number.isFinite(object.width * object.height) || object.width <= 0 || object.height <= 0) {
        this.canvas.remove(object); this.emit(); return;
      }
      object.set({ excludeFromExport: false, selectable: true, evented: true, editorId: uid("shape"), editorRole: "shape",
        editorPurpose: "content", editorName: this.nextName(tool === "rect" ? "矩形" : "椭圆") });
      if (object instanceof Rect) syncRectRadius(object, true);
      this.canvas.discardActiveObject(); this.configure(); this.commit(); return;
    }
    if (this.selection.draft && this.selection.mode !== "lasso") {
      const valid = this.selection.valid(this.canvas.getZoom(), this.size), stroke = this.selection.take()!;
      if (valid) {
        this.commitMaskStroke(stroke);
      } else { this.notice = "选区过小，可放大图片后重选"; this.emit(); }
    }
    this.emit();
  }
  private commitMaskStroke(stroke: MaskStroke) {
    if (stroke.operation === "subtract" && !subtractionChangesMask(this.masks, stroke, this.size)) {
      this.notice = "未减去任何区域，请在已有选区内操作"; this.emit(); return;
    }
    this.masks.push(stroke); this.invalidateMaskPreview(); this.notice = "选区已更新；可继续添加或减去区域"; this.noticePresentation = "quiet"; this.commit();
    if (!this.hasMask) { this.notice = "选区已清空，请添加区域"; this.emit(); }
  }
  private finishLasso() {
    if (this.locked || !this.selection.draft || this.selection.mode !== "lasso") return;
    if (this.selection.draft.points.length < 3) { this.notice = "继续点击，至少添加三个点"; this.emit(); return; }
    if (!this.selection.valid(this.canvas.getZoom(), this.size)) { this.notice = "选区过小或接近直线，请调整选点"; this.emit(); return; }
    const stroke = this.selection.take()!;
    this.commitMaskStroke(stroke);
  }

  async addText(point?: PointData) {
    if (!this.ready || this.locked || this.gestureActive || this.selection.draft || this.shapeDraft) return;
    const recent = this.lastTextAdd;
    if (!point && recent?.generation === this.generation && performance.now() - recent.at < 350) {
      const previous = this.canvas.getObjects().find(object => object.editorId === recent.id);
      if (previous instanceof Textbox && previous === this.canvas.getActiveObject() && previous.visible && !previous.editorLocked) {
        this.canvas.setActiveObject(previous); previous.enterEditing(); previous.hiddenTextarea?.focus({ preventScroll: true });
        return;
      }
    }
    const active = this.canvas.getActiveObject();
    const properties = active instanceof Textbox ? textProperties(active) : { ...this.textDefaults };
    this.finishPropertyEdit(); this.finishText(); this.cancelDraft(); this.tool = "text"; this.workspace = "text";
    this.fontRetry = undefined;
    this.busy = true; this.configure(); this.emit(); const token = this.generation;
    try {
      await ensureFont(properties.fontFamily, properties.fontWeight, properties.fontStyle);
      if (this.disposed || token !== this.generation) return;
      const visibleArea = () => {
        const [zoom, , , , x, y] = this.canvas.viewportTransform;
        return { left: Math.max(0, -x / zoom), top: Math.max(0, -y / zoom),
          right: Math.min(this.size.width, (this.canvas.width - x) / zoom), bottom: Math.min(this.size.height, (this.canvas.height - y) / zoom) };
      };
      let area = visibleArea();
      if (!point && (area.right <= area.left || area.bottom <= area.top)) { this.fit(); area = visibleArea(); }
      const text = new ContentTextbox("Your text", { left: point?.x ?? 0, top: point?.y ?? 0, originX: "left", originY: "top",
        width: Math.min(420, this.size.width * .42), fontSize: properties.fontSize, fontFamily: properties.fontFamily, fill: this.color,
        splitByGrapheme: true, editorId: uid("text"), editorName: "文案", editorRole: "text", editorPurpose: "content" });
      applyTextProperties(text, properties);
      if (!point) {
        text.set({ width: Math.min(text.width, (area.right - area.left) * .8) }); text.initDimensions();
        const occupied = this.canvas.getObjects().filter(object => object instanceof Textbox && object.visible).map(object => object.getCenterPoint());
        const center = textPlacement(area, text.getBoundingRect(), occupied, this.canvas.getZoom());
        text.setPositionByOrigin(new Point(center.x, center.y), "center", "center");
      }
      this.textDefaults = { ...properties };
      this.canvas.add(text); this.canvas.setActiveObject(text);
      this.notice = `已添加文字，当前共 ${this.canvas.getObjects().filter(object => object instanceof Textbox).length} 段；可直接输入或拖动调整位置`;
      this.busy = false; this.configure(); this.commit(); text.enterEditing(); text.selectAll();
      this.lastTextAdd = { id: text.editorId!, generation: this.generation, at: performance.now() };
    } catch (error) {
      if (!this.disposed && token === this.generation) {
        this.fontRetry = { generation: token, selectedId: this.canvas.getActiveObject()?.editorId, message: (error as Error).message, run: () => this.addText(point) };
        this.report(error);
      }
    }
    finally { if (!this.disposed) { this.busy = false; this.configure(); this.emit(); } }
  }

  private syncSelectionWorkspace() {
    const selected = this.canvas.getActiveObjects();
    if (selected.length !== 1) return;
    this.workspace = selected[0] instanceof Textbox ? "text" : "draw";
    if (this.workspace === "draw") this.lastDrawingTool = selected[0] instanceof Rect ? "rect" : selected[0] instanceof Ellipse ? "circle" : "draw";
  }
  private selectionChanged() {
    this.finishNudge();
    if (!this.busy && (this.tool === "select" || this.tool === "text" || this.tool === "pan")) {
      const selected = this.canvas.getActiveObjects();
      if (selected.length && !this.changingSelection) this.propertiesRequest++;
      if (selected.length === 1) {
        if (this.tool !== "pan") this.tool = selected[0] instanceof Textbox ? "text" : "select";
        this.syncSelectionWorkspace();
      }
      this.configure();
    }
    this.emit();
  }

  selectLayer(id: string) {
    if (this.locked) return;
    const object = this.canvas.getObjects().find(item => item.editorId === id);
    if (!object || object.editorPurpose === "base" || object.editorLocked || !object.visible) return;
    this.finishPropertyEdit(); this.finishText();
    if (!this.canvas.getObjects().includes(object)) return;
    this.cancelDraft(); this.tool = "select"; this.configure(); this.canvas.setActiveObject(object); this.selectionChanged();
  }
  private positionTarget() {
    if (this.locked || this.gestureActive || this.space || this.selection.draft || this.shapeDraft ||
      (this.tool !== "select" && this.tool !== "text")) return;
    const selected = this.canvas.getActiveObjects();
    if (!selected.length || selected.some(object => object.editorPurpose !== "content" || !object.visible || object.editorLocked)) return;
    return this.canvas.getActiveObject();
  }
  centerSelection(axis: "horizontal" | "vertical") {
    if (!this.positionTarget() || this.canvas.getActiveObjects().length !== 1) return;
    this.finishPropertyEdit(); this.finishText();
    const object = this.positionTarget();
    if (!object) return;
    const center = object.getCenterPoint();
    const next = new Point(axis === "horizontal" ? this.size.width / 2 : center.x,
      axis === "vertical" ? this.size.height / 2 : center.y);
    if (center.distanceFrom(next) < .0001) return;
    object.setPositionByOrigin(next, "center", "center"); object.setCoords();
    this.canvas.requestRenderAll(); this.commit();
  }
  private finishNudge = () => {
    if (!this.nudgeKeys.size) return;
    this.nudgeKeys.clear(); this.finishPropertyEdit();
  };
  private nudgeSelection(event: KeyboardEvent) {
    const object = this.positionTarget(), direction = POSITION_KEYS[event.key];
    const target = event.target instanceof Element ? event.target : undefined;
    const app = this.viewport.closest(".app-shell");
    // Only the canvas, layer selection and position controls own movement keys.
    const inEditor = !target || target === document.body || this.viewport.contains(target) ||
      (!!app?.contains(target) && !!target.closest(".layer-select,.layer-card,.layer-position"));
    const control = target?.closest("input,textarea,select,[contenteditable='true'],dialog,[role='dialog'],[role='menu'],[role='listbox'],button,a[href],summary,[role='button'],[role='slider']");
    const ownsKeys = control && !control.matches(".layer-select,.layer-position button");
    if (!direction || !object || (object instanceof Textbox && object.isEditing) || event.ctrlKey || event.metaKey || event.altKey ||
      !inEditor || ownsKeys || (event.repeat && !this.nudgeKeys.has(event.key))) { this.finishNudge(); return; }
    event.preventDefault(); event.stopPropagation();
    if (!this.nudgeKeys.size) { this.finishPropertyEdit(); this.commit(); this.propertyEdit = true; }
    this.nudgeKeys.add(event.key);
    const step = event.shiftKey ? 10 : 1;
    object.set({ left: object.left + direction[0] * step, top: object.top + direction[1] * step });
    object.setCoords();
    this.canvas.getActiveObjects().forEach(item => item.setCoords());
    this.canvas.requestRenderAll(); this.emit();
  }
  updateLayer(id: string, patch: { visible?: boolean; locked?: boolean }) {
    if (this.locked) return;
    this.finishPropertyEdit();
    const object = this.canvas.getObjects().find(item => item.editorId === id);
    if (!object || object.editorPurpose === "base") return;
    const selected = this.canvas.getActiveObjects();
    const affected = selected.includes(object);
    if (affected) this.finishText();
    if (!this.canvas.getObjects().includes(object)) return;
    // Release the selection before changing membership so grouped coordinates survive.
    const removeFromSelection = affected && (patch.visible === false || patch.locked === true);
    const remaining = selected.filter(item => item !== object);
    this.changingSelection = true;
    if (removeFromSelection) this.canvas.discardActiveObject();
    if (patch.visible !== undefined) object.set("visible", patch.visible);
    if (patch.locked !== undefined) object.set({ editorLocked: patch.locked, selectable: !patch.locked, evented: !patch.locked });
    if (removeFromSelection && remaining.length) {
      this.canvas.setActiveObject(remaining.length === 1 ? remaining[0] : new ActiveSelection(remaining, { canvas: this.canvas }));
    }
    this.changingSelection = false;
    this.canvas.requestRenderAll(); this.commit();
  }
  moveLayer(id: string, direction: "up" | "down" | "top" | "bottom") {
    if (this.locked) return;
    const object = this.canvas.getObjects().find(item => item.editorId === id); if (!object || object.editorPurpose === "base" || object.editorLocked) return;
    const content = this.canvas.getObjects().filter(item => item.editorPurpose !== "base" && item.editorId);
    const index = content.indexOf(object);
    const towardsTop = direction === "up" || direction === "top";
    if (index < 0 || (towardsTop ? index === content.length - 1 : index === 0)) return;
    this.finishText();
    if (!this.canvas.getObjects().includes(object)) return;
    if (direction === "top") this.canvas.bringObjectToFront(object);
    else if (direction === "bottom") this.canvas.sendObjectToBack(object);
    else if (direction === "up") this.canvas.bringObjectForward(object);
    else this.canvas.sendObjectBackwards(object);
    const base = this.canvas.getObjects().find(item => item.editorPurpose === "base"); if (base) this.canvas.sendObjectToBack(base);
    this.commit();
  }
  deleteSelected() {
    if (this.locked) return;
    const objects = this.canvas.getActiveObjects().filter(item => item.editorPurpose !== "base" && !item.editorLocked);
    this.finishText(); this.canvas.discardActiveObject(); this.canvas.remove(...objects);
    if (objects.length) this.notice = objects.length > 1 ? `已删除 ${objects.length} 个图层，可撤销` : "已删除图层，可撤销";
    this.commit();
  }
  async duplicateSelected() {
    if (this.locked) return;
    this.finishText(); const selected = this.canvas.getActiveObjects();
    if (selected.length !== 1 || selected[0].editorPurpose === "base") return;
    this.busy = true; this.configure(); this.emit(); const token = this.generation;
    try {
      const object = await selected[0].clone(SERIALIZED_PROPS);
      if (this.disposed || token !== this.generation) return;
      object.set({ editorId: uid("copy"), left: object.left + 20, top: object.top + 20, editorLocked: false, selectable: true, evented: true });
      if (!(object instanceof Textbox)) object.editorName = this.nextName(object instanceof Rect ? "矩形" : object instanceof Ellipse ? "椭圆" : "画笔");
      this.canvas.add(object); this.canvas.setActiveObject(object);
    } catch (error) { this.report(error); }
    finally { if (!this.disposed) { this.busy = false; this.configure(); this.commit(); } }
  }
  async updateText(values: TextProperties) {
    if (this.locked) return;
    const text = this.canvas.getActiveObject();
    if (!(text instanceof Textbox)) { if (this.workspace === "text" && !this.canvas.getActiveObjects().length) { this.textDefaults = { ...values }; this.emit(); } return; }
    if (text.editorLocked) return;
    this.finishText();
    if (!this.canvas.getObjects().includes(text)) { this.textDefaults = { ...values }; this.emit(); return; }
    if (this.fontRetry) this.notice = "";
    this.fontRetry = undefined; this.busy = true; this.configure(); this.emit(); const token = this.generation;
    try {
      await ensureFont(values.fontFamily, values.fontWeight, values.fontStyle);
      if (!this.disposed && token === this.generation && this.canvas.getObjects().includes(text)) {
        applyTextProperties(text, values); this.textDefaults = { ...values }; this.canvas.requestRenderAll();
      }
    } catch (error) {
      if (!this.disposed && token === this.generation) {
        this.fontRetry = { generation: token, selectedId: text.editorId, message: (error as Error).message, run: () => this.updateText(values) };
        this.report(error);
      }
    }
    finally { if (!this.disposed) { this.busy = false; this.configure(); this.commit(); } }
  }
  updateTextOpacity(value: number, commit = true) {
    this.updateTextAlpha(value, "opacity", commit);
  }
  updateTextBackgroundOpacity(value: number, commit = true) {
    this.updateTextAlpha(value, "backgroundOpacity", commit);
  }
  private updateTextAlpha(value: number, field: "opacity" | "backgroundOpacity", commit: boolean) {
    if (this.locked || this.gestureActive) return;
    this.finishText();
    const opacity = Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 100;
    const text = this.canvas.getActiveObject();
    if (!(text instanceof Textbox)) {
      if (this.workspace === "text" && !this.canvas.getActiveObjects().length) {
        this.textDefaults = { ...this.textDefaults, [field]: opacity }; this.emit();
      }
      return;
    }
    if (text.editorLocked) return;
    if (!commit && !this.propertyEdit) { this.commit(); this.propertyEdit = true; }
    if (field === "backgroundOpacity") applyTextBackgroundOpacity(text, opacity);
    else text.set("opacity", opacity / 100);
    this.textDefaults = textProperties(text);
    this.canvas.requestRenderAll();
    if (commit) this.commit(); else this.emit();
  }
  toggleTextOrientation() {
    if (this.locked || this.gestureActive) return;
    this.finishText(); this.finishPropertyEdit();
    const text = this.canvas.getActiveObject();
    if (!(text instanceof Textbox) || text.editorLocked || !text.visible) return;
    const center = text.getCenterPoint();
    text.set("angle", isVerticalText(text) ? 0 : 90);
    text.setPositionByOrigin(center, "center", "center"); text.setCoords();
    this.canvas.requestRenderAll(); this.commit();
  }
  setAdjustments(values: ImageAdjustments, commit = false) {
    if (this.locked) return;
    if (commit) this.finishPropertyEdit();
    if (!commit && !this.propertyEdit) { this.commit(); this.propertyEdit = true; }
    this.applyAdjustments(values);
    if (commit) this.commit(); else this.emit();
  }
  private applyAdjustments(values: ImageAdjustments) {
    const image = this.canvas.getObjects().find(object => object.editorPurpose === "base"); if (!(image instanceof FabricImage)) return;
    const previous = image.filters;
    try {
      const normalized = normalizeAdjustments(values);
      image.filters = adjustmentFilters(normalized); image.applyFilters();
      this.adjustments = normalized; this.canvas.requestRenderAll();
    } catch (error) {
      image.filters = previous; image.applyFilters(); this.canvas.requestRenderAll(); this.report(error);
    }
  }

  async executeErase() {
    if (this.locked) return;
    if (!this.hasMask) { this.notice = "当前选区为空，请先添加需要修改的区域"; this.emit(); return; }
    const apiUrl = editorConfig.eraseApiUrl;
    if (!apiUrl) { this.notice = "消除服务尚未接入，图片和选区已保留"; this.noticePresentation = "persistent"; this.emit(); return; }
    if (this.selection.draft || this.shapeDraft) { this.notice = "请先完成或取消当前未闭合选区／图形"; this.emit(); return; }
    this.finishText(); this.commit();
    const snapshot = this.snapshot(), documentId = this.documentId, revision = this.revision;
    const job = { id: uid("request"), controller: new AbortController() }; this.job = job;
    const heldAssets = assetIds(snapshot); this.processingAssets.set(job.id, heldAssets);
    const current = () => !this.disposed && this.job === job && !job.controller.signal.aborted && this.documentId === documentId && this.revision === revision;
    this.notice = "正在消除所选区域，请稍候…"; this.configure(); this.emit();
    let beforeUrl: string | undefined, afterUrl: string | undefined;
    try {
      const mask = await exportMask(snapshot.masks, snapshot.size, job.controller.signal);
      if (!current()) return;
      const image = await renderDocument(snapshot, this.assets, "base");
      if (!current()) return;
      const result = await callEraseApi({ apiUrl, image, mask, ...snapshot.size, documentId, revision, signal: job.controller.signal });
      if (!current()) return;
      const asset = await this.assets.add(result);
      heldAssets.add(asset.id);
      if (!current()) return;
      if (asset.width !== snapshot.size.width || asset.height !== snapshot.size.height) throw new Error("结果尺寸与输入不同，未采用。当前版本仅支持同尺寸编辑，请与后端核对");
      const next = applyResult(snapshot, this.imageData(asset, "消除结果"));
      const before = await renderDocument(snapshot, this.assets, "final");
      if (!current()) return;
      const after = await renderDocument(next, this.assets, "final");
      if (!current()) return;
      beforeUrl = URL.createObjectURL(before); afterUrl = URL.createObjectURL(after);
      this.pending = { assetId: asset.id, beforeUrl, afterUrl, documentId, revision };
      beforeUrl = afterUrl = undefined;
      this.notice = "消除结果已返回，请检查后使用或放弃";
    } catch (error) {
      if (current()) {
        const reason = error instanceof TypeError ? "无法连接消除服务，请稍后重试" : (error as Error)?.message || "请稍后重试";
        this.report(new Error(`消除失败，图片和选区已保留。${reason}`));
      }
    }
    finally {
      if (beforeUrl) URL.revokeObjectURL(beforeUrl); if (afterUrl) URL.revokeObjectURL(afterUrl);
      this.processingAssets.delete(job.id);
      if (!this.disposed) {
        if (this.job === job) { this.job = undefined; this.configure(); this.emit(); }
        this.collect();
      }
    }
  }
  cancelTask() {
    if (!this.job) return;
    this.job.controller.abort(); this.job = undefined;
    this.notice = "已取消等待，图片和选区已保留";
    this.configure(); this.emit();
  }
  discardResult() {
    if (!this.pending) return;
    URL.revokeObjectURL(this.pending.beforeUrl); URL.revokeObjectURL(this.pending.afterUrl);
    this.pending = undefined; this.notice = "已放弃结果，当前图片未改变"; this.collect(); this.configure(); this.emit();
  }
  async acceptResult() {
    const pending = this.pending;
    if (!pending || this.busy || this.confirmation) return;
    if (pending.documentId !== this.documentId || pending.revision !== this.revision) { this.discardResult(); this.notice = "文档已变化，旧结果不能采用"; this.emit(); return; }
    this.pending = { ...pending, acceptError: undefined };
    this.busy = true; this.configure(); this.emit();
    try {
      const snapshot = applyResult(this.snapshot(), this.imageData(this.assets.get(pending.assetId), "消除结果"));
      await this.loadSnapshot(snapshot);
      if (!this.disposed) { this.busy = false; this.discardResult(); this.tool = "erase"; this.configure(); this.commit(); this.notice = "已使用消除结果，可继续选择区域"; }
    } catch {
      if (!this.disposed && this.pending?.assetId === pending.assetId) {
        this.pending = { ...pending, acceptError: "暂时无法使用结果，图片和选区已保留。可重试使用，无需重新消除。" };
      }
    }
    finally { if (!this.disposed) { this.busy = false; this.configure(); this.emit(); } }
  }

  private scheduleOverlay() {
    if (this.disposed || this.previewFrame) return;
    this.previewFrame = requestAnimationFrame(() => { this.previewFrame = 0; this.drawOverlay(); });
  }
  private drawOverlay() {
    const ctx = this.overlay.getContext("2d")!;
    if (this.overlay.width !== this.canvas.width || this.overlay.height !== this.canvas.height) { this.overlay.width = this.canvas.width; this.overlay.height = this.canvas.height; }
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    const v = this.canvas.viewportTransform;
    if (this.compareOriginal && this.originalElement?.complete) {
      ctx.fillStyle = "#edf0f4"; ctx.fillRect(0, 0, this.overlay.width, this.overlay.height);
      ctx.save(); ctx.setTransform(...v); ctx.fillStyle = "white"; ctx.fillRect(0, 0, this.original!.size.width, this.original!.size.height);
      ctx.drawImage(this.originalElement, 0, 0); ctx.restore(); return;
    }
    if (this.shapeDraft && !this.locked) {
      // Draft-only aid: never serialized, sampled by the eyedropper, or exported.
      // Once selected, Fabric's existing control frame takes over.
      const object = this.shapeDraft.object, bounds = object.getBoundingRect(), zoom = this.canvas.getZoom();
      const x = bounds.left * zoom + v[4], y = bounds.top * zoom + v[5];
      const width = bounds.width * zoom, height = bounds.height * zoom;
      ctx.save(); ctx.beginPath();
      if (object instanceof Ellipse) ctx.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
      else ctx.roundRect(x, y, width, height, Math.min(object.rx * zoom, width / 2, height / 2));
      ctx.strokeStyle = "#263c52"; ctx.lineWidth = 1; strokeOutline(ctx); ctx.restore(); return;
    }
    if (this.tool === "draw" && this.cursor && !this.locked && !this.space) {
      const radius = this.drawSize * this.canvas.getZoom() / 2;
      ctx.beginPath(); ctx.arc(this.cursor.x, this.cursor.y, radius, 0, Math.PI * 2);
      // Dark outer edge plus white halo keeps even a white brush visible on white.
      ctx.strokeStyle = "#263c52"; ctx.lineWidth = 5.5; ctx.stroke();
      ctx.strokeStyle = this.color; ctx.lineWidth = 1.5; strokeOutline(ctx);
      if (radius < 4) {
        ctx.beginPath();
        ctx.moveTo(this.cursor.x - 6, this.cursor.y); ctx.lineTo(this.cursor.x - 2, this.cursor.y);
        ctx.moveTo(this.cursor.x + 2, this.cursor.y); ctx.lineTo(this.cursor.x + 6, this.cursor.y);
        ctx.moveTo(this.cursor.x, this.cursor.y - 6); ctx.lineTo(this.cursor.x, this.cursor.y - 2);
        ctx.moveTo(this.cursor.x, this.cursor.y + 2); ctx.lineTo(this.cursor.x, this.cursor.y + 6);
        ctx.strokeStyle = "#263c52"; ctx.lineWidth = 1; strokeOutline(ctx);
      }
      return;
    }
    if (this.tool !== "erase") return;
    // Display-only isolation: never overwrite a layer's saved visibility during AI selection.
    ctx.fillStyle = "#edf0f4"; ctx.fillRect(0, 0, this.overlay.width, this.overlay.height);
    ctx.save(); ctx.setTransform(...v); ctx.beginPath(); ctx.rect(0, 0, this.size.width, this.size.height); ctx.clip();
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, this.size.width, this.size.height);
    this.canvas.getObjects().filter(object => object.editorPurpose === "base").forEach(object => object.render(ctx));
    ctx.restore();
    if (this.maskHidden) return;
    const maskCanvas = this.previewCanvas, committed = this.committedMaskCanvas;
    if (maskCanvas.width !== this.overlay.width || maskCanvas.height !== this.overlay.height) { maskCanvas.width = this.overlay.width; maskCanvas.height = this.overlay.height; }
    if (committed.width !== this.overlay.width || committed.height !== this.overlay.height) { committed.width = this.overlay.width; committed.height = this.overlay.height; this.committedMaskKey = ""; }
    const committedKey = `${this.maskVersion}|${committed.width}x${committed.height}|${v.join(",")}`;
    if (committedKey !== this.committedMaskKey) {
      const cached = committed.getContext("2d")!; cached.clearRect(0, 0, committed.width, committed.height);
      cached.save(); cached.setTransform(...v); cached.beginPath(); cached.rect(0, 0, this.size.width, this.size.height); cached.clip();
      this.masks.forEach(stroke => paintStroke(cached, stroke)); cached.restore();
      this.committedMaskKey = committedKey;
    }
    const paint = maskCanvas.getContext("2d")!; paint.clearRect(0, 0, maskCanvas.width, maskCanvas.height); paint.drawImage(committed, 0, 0);
    paint.save(); paint.setTransform(...v); paint.beginPath(); paint.rect(0, 0, this.size.width, this.size.height); paint.clip();
    if (this.selection.draft && this.selection.mode !== "lasso" && this.selection.mode !== "freehand") paintStroke(paint, this.selection.draft);
    paint.restore(); paint.save(); paint.globalCompositeOperation = "source-in"; paint.fillStyle = "rgba(245,65,89,.4)"; paint.fillRect(0, 0, maskCanvas.width, maskCanvas.height); paint.restore();
    ctx.drawImage(maskCanvas, 0, 0);
    if (this.selection.draft?.kind === "rect") {
      const zoom = this.canvas.getZoom(), first = this.selection.draft.points[0], last = this.selection.draft.points[this.selection.draft.points.length - 1];
      ctx.save(); ctx.setTransform(...v); ctx.strokeStyle = this.selection.draft.operation === "add" ? "#e63550" : "#168665"; ctx.lineWidth = 2 / zoom;
      ctx.beginPath(); ctx.rect(Math.min(first.x, last.x), Math.min(first.y, last.y), Math.abs(last.x - first.x), Math.abs(last.y - first.y)); strokeOutline(ctx, 1 / zoom); ctx.restore();
    }
    if (this.selection.draft && this.selection.mode === "freehand") {
      const zoom = this.canvas.getZoom(), points = this.selection.draft.points;
      const color = this.selection.draft.operation === "add" ? "#e63550" : "#168665";
      ctx.save(); ctx.setTransform(...v); ctx.lineWidth = 2 / zoom; ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.beginPath(); ctx.rect(0, 0, this.size.width, this.size.height); ctx.clip();
      ctx.strokeStyle = color; ctx.beginPath();
      points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
      strokeOutline(ctx, 1 / zoom);
      if (points.length > 1) {
        const first = points[0], last = points[points.length - 1];
        ctx.save(); ctx.globalAlpha = .55; ctx.setLineDash([6 / zoom, 5 / zoom]); ctx.beginPath();
        ctx.moveTo(last.x, last.y); ctx.lineTo(first.x, first.y); strokeOutline(ctx, 1 / zoom); ctx.restore();
      }
      const first = points[0];
      ctx.beginPath(); ctx.arc(first.x, first.y, 3 / zoom, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
      strokeOutline(ctx, 1 / zoom);
      ctx.restore();
    }
    if (this.selection.draft && this.selection.mode === "lasso") {
      const zoom = this.canvas.getZoom(), points = this.selection.draft.points, color = this.selection.draft.operation === "add" ? "#e63550" : "#168665";
      ctx.save(); ctx.setTransform(...v); ctx.strokeStyle = color; ctx.lineWidth = 2 / zoom; ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.beginPath();
      points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
      if (this.selection.hover) ctx.lineTo(this.selection.hover.x, this.selection.hover.y);
      strokeOutline(ctx, 1 / zoom);
      if (points.length > 1 && this.selection.hover) {
        ctx.save(); ctx.globalAlpha = .5; ctx.setLineDash([6 / zoom, 5 / zoom]); ctx.beginPath();
        ctx.moveTo(this.selection.hover.x, this.selection.hover.y); ctx.lineTo(points[0].x, points[0].y); strokeOutline(ctx, 1 / zoom); ctx.restore();
      }
      const startRadius = Math.max(2, Math.min(this.selection.closing ? 10 : 7, this.selection.closingRadius(zoom) * zoom));
      points.forEach((point, index) => {
        ctx.beginPath(); ctx.arc(point.x, point.y, (index === 0 ? startRadius : 3.5) / zoom, 0, Math.PI * 2);
        ctx.fillStyle = index === 0 ? color : "#ffffff"; ctx.fill();
        ctx.strokeStyle = color; ctx.lineWidth = 2 / zoom; strokeOutline(ctx, 1 / zoom);
      });
      if (this.selection.closing) {
        const first = points[0]; ctx.fillStyle = color; ctx.font = `600 ${11 / zoom}px sans-serif`;
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 3 / zoom; ctx.strokeText("点击闭合", first.x + 14 / zoom, first.y - 10 / zoom);
        ctx.fillText("点击闭合", first.x + 14 / zoom, first.y - 10 / zoom);
      }
      ctx.restore();
    }
    if (this.cursor && this.selection.mode === "brush" && !this.locked) {
      const width = this.selection.draft?.width ?? this.brushSize, zoom = this.canvas.getZoom();
      ctx.save();
      ctx.beginPath(); ctx.arc(this.cursor.x, this.cursor.y, width * zoom / 2, 0, Math.PI * 2);
      ctx.strokeStyle = this.operation === "add" ? "#e63550" : "#168665"; ctx.lineWidth = 1.5; strokeOutline(ctx);
      ctx.restore();
    }
  }
  private isInput(target: EventTarget | null) { return target instanceof HTMLElement && !!target.closest("input,textarea,select,[contenteditable='true']"); }
  private keyDown = (event: KeyboardEvent) => {
    if (!POSITION_KEYS[event.key] && event.key !== "Shift") this.finishNudge();
    if (this.confirmation) return;
    if (this.submitting || this.savedRecord || this.closed) { if (["Escape", "Enter", "Delete", "Backspace"].includes(event.key)) event.preventDefault(); return; }
    if ((this.colorPick || this.preparingColorPick) && event.key === "Escape") { event.preventDefault(); this.cancelColorPick(); return; }
    if (event.isComposing || event.defaultPrevented) return;
    if (POSITION_KEYS[event.key]) { this.nudgeSelection(event); return; }
    const command = event.ctrlKey || event.metaKey;
    if (this.isInput(event.target)) return;
    // Focused controls own activation keys; canvas shortcuts must not consume them.
    if (event.target instanceof Element && event.target.closest("button,a[href],summary,[role='button']") && (event.code === "Space" || event.key === "Enter")) return;
    if (event.code === "Space" && !this.locked) {
      event.preventDefault();
      if (this.drawingInProgress) return;
      if (event.repeat || (this.selection.draft && this.selection.draft.kind !== "rect" && this.selection.mode !== "lasso")) return;
      this.space = true;
      this.selection.startMove();
      this.configure(); return;
    }
    if (this.locked) return;
    if (command && event.key.toLowerCase() === "z") {
      event.preventDefault(); void this.undo(event.shiftKey);
    }
    if (command && event.key.toLowerCase() === "y") { event.preventDefault(); void this.undo(true); }
    if (command && event.key.toLowerCase() === "d") { event.preventDefault(); void this.duplicateSelected(); }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      if (this.selection.mode === "lasso" && this.selection.draft) this.undoLassoPoint(); else this.deleteSelected();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      if (this.selection.draft || this.shapeDraft || this.drawingInProgress) {
        const erasing = this.tool === "erase";
        this.cancelDraft(); this.configure(); this.notice = erasing ? "已取消本次绘制，已有选区保留" : "已取消本次绘制，已有内容保留"; this.emit();
      }
      else void this.requestClose();
    }
    if (event.key === "Enter" && this.tool === "erase" && this.selection.mode === "lasso") { event.preventDefault(); this.finishLasso(); }
  };
  private keyUp = (event: KeyboardEvent) => {
    if (this.nudgeKeys.delete(event.key) && !this.nudgeKeys.size) this.finishPropertyEdit();
    if (event.code === "Space" && this.space) {
      this.selection.endMove(); this.space = false; this.panning = undefined; this.configure();
    }
  };
  private windowPointerDown = (event: PointerEvent) => {
    this.finishNudge();
    if (event.button === 0 && !this.gestureActive && event.target === this.canvas.upperCanvasEl) this.pointerId = event.pointerId;
  };
  private windowPointerUp = (event: PointerEvent) => {
    if (event.button !== 0 || (event.buttons & 1)) return;
    if (this.pointerId !== undefined && this.pointerId !== event.pointerId) return;
    this.setMaskHidden(false); this.pointerUp(event);
    if (!this.gestureActive) this.pointerId = undefined;
  };
  private windowPointerCancel = (event: PointerEvent) => {
    if (this.pointerId !== undefined && this.pointerId !== event.pointerId) return;
    this.setMaskHidden(false);
    if (!this.gestureActive && !this.panning && !this.shapeDraft && !this.selection.draft) return;
    this.panning = undefined; this.cancelDraft(); this.notice = this.tool === "erase" ? "操作被中断，未完成的选区已取消" : "操作被中断，未完成的绘制已取消"; this.configure(); this.emit();
  };
  private windowBlur = () => {
    this.finishPropertyEdit();
    this.gestureActive = false; this.pointerId = undefined;
    this.space = false; this.panning = undefined; this.maskHidden = false;
    if (this.selection.draft || this.shapeDraft) { this.cancelDraft(); this.notice = "窗口失去焦点，未完成的操作已取消"; }
    this.configure(); this.emit();
  };
  private beforeUnload = (event: BeforeUnloadEvent) => { if (!this.closed && !this.savedRecord && this.ready && (this.dirty || this.job || this.pending || this.submitting)) { event.preventDefault(); event.returnValue = ""; } };

  dispose() {
    this.confirmationResolve?.(false); this.confirmationResolve = undefined; this.confirmation = undefined;
    this.colorLens?.remove(); this.colorLens = undefined; this.colorEdit = undefined;
    this.canvas.upperCanvasEl.removeEventListener("mousedown", this.captureColorDown, true);
    this.colorPick = undefined; this.disposed = true; this.generation++; this.job?.controller.abort(); this.observer.disconnect();
    window.removeEventListener("keydown", this.keyDown); window.removeEventListener("keyup", this.keyUp); window.removeEventListener("blur", this.windowBlur);
    window.removeEventListener("focusin", this.finishNudge); document.removeEventListener("visibilitychange", this.finishNudge);
    window.removeEventListener("pointerup", this.windowPointerUp, true); window.removeEventListener("pointercancel", this.windowPointerCancel, true);
    window.removeEventListener("pointerdown", this.windowPointerDown, true);
    window.removeEventListener("beforeunload", this.beforeUnload);
    cancelAnimationFrame(this.previewFrame); this.previewCanvas.width = this.previewCanvas.height = 0; this.committedMaskCanvas.width = this.committedMaskCanvas.height = 0;
    if (this.pending) { URL.revokeObjectURL(this.pending.beforeUrl); URL.revokeObjectURL(this.pending.afterUrl); }
    this.textInputEvents?.abort(); this.emptyTexts.clear(); this.fontRetry = undefined;
    this.assets.dispose(); void this.canvas.dispose();
  }
}
