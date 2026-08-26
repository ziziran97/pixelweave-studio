import {
  ArrowDown, ArrowRight, ArrowUp, BoxSelect, Brush, Check, ChevronDown,
  Circle as CircleIcon, CircleDashed, Eraser, Eye, EyeOff, ImagePlus,
  LassoSelect, Layers3, Lock, MousePointer2, Redo2,
  Save, SlidersHorizontal, Sparkles, Square, Trash2, Type, Undo2, Unlock,
  Upload, WandSparkles, ZoomIn, ZoomOut,
} from "lucide-react";
import {
  Canvas, Ellipse, FabricImage, Group, Line, PencilBrush, Polygon,
  Rect, StaticCanvas, Textbox, Triangle, filters,
} from "fabric";
import type { FabricObject } from "fabric";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { editorConfig } from "./config";
import { callEraseApi, callInstructionEditApi } from "./lib/eraseApi";
import {
  DEFAULT_ADJUSTMENTS, type DocumentSize, type EditorObject, type EraseMode,
  type ImageAdjustments, type LayerItem, type ToolId,
} from "./types";

const INITIAL_SIZE: DocumentSize = { width: 1280, height: 800 };
const SERIALIZED_PROPS = ["editorId", "editorName", "editorRole", "editorLocked"];

const TOOL_ITEMS: Array<{ id: ToolId; label: string; icon: typeof MousePointer2 }> = [
  { id: "select", label: "选择", icon: MousePointer2 },
  { id: "image", label: "替换图片", icon: ImagePlus },
  { id: "erase", label: "消除笔", icon: Eraser },
  { id: "draw", label: "绘制", icon: Brush },
  { id: "text", label: "文本", icon: Type },
  { id: "rect", label: "矩形", icon: Square },
  { id: "circle", label: "圆形", icon: CircleIcon },
  { id: "arrow", label: "箭头", icon: ArrowRight },
  { id: "adjust", label: "调色", icon: SlidersHorizontal },
  { id: "layers", label: "图层", icon: Layers3 },
];

const ERASE_MODES: Array<{ id: EraseMode; label: string; icon: typeof Brush }> = [
  { id: "brush", label: "涂抹", icon: Brush },
  { id: "rect", label: "框选", icon: BoxSelect },
  { id: "ellipse", label: "圈选", icon: CircleDashed },
  { id: "lasso", label: "套索", icon: LassoSelect },
];

type HistorySnapshot = { size: DocumentSize; canvas: Record<string, unknown> };

function uid(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(blob);
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type = "image/jpeg") {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("图片生成失败")),
      type,
      editorConfig.jpegQuality,
    );
  });
}

async function normalizeToJpeg(blob: Blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("浏览器无法处理图片");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const jpeg = await canvasToBlob(canvas);
  return { blob: jpeg, dataUrl: await blobToDataUrl(jpeg), width: canvas.width, height: canvas.height };
}

async function createDefaultImage() {
  const canvas = document.createElement("canvas");
  canvas.width = INITIAL_SIZE.width;
  canvas.height = INITIAL_SIZE.height;
  const context = canvas.getContext("2d")!;
  const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, "#eaf4ff");
  gradient.addColorStop(0.52, "#f8fbff");
  gradient.addColorStop(1, "#dcecff");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#2e76b8";
  context.font = "700 52px Microsoft YaHei, sans-serif";
  context.textAlign = "center";
  context.fillText("PixelWeave Studio", canvas.width / 2, canvas.height / 2 - 20);
  context.fillStyle = "#71879b";
  context.font = "24px Microsoft YaHei, sans-serif";
  context.fillText("点击“替换图片”开始编辑", canvas.width / 2, canvas.height / 2 + 34);
  return canvasToBlob(canvas);
}

async function loadImageElement(dataUrl: string) {
  const image = new Image();
  image.decoding = "async";
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("图片加载失败"));
    image.src = dataUrl;
  });
  return image;
}

function isMask(object: FabricObject) {
  return (object as EditorObject).editorRole === "erase-mask";
}

function isDraft(object: FabricObject) {
  return Boolean((object as EditorObject).editorDraft);
}

async function renderJpeg(
  objects: FabricObject[],
  size: DocumentSize,
  mode: "composite" | "mask" | "local-erase",
) {
  const surface = new StaticCanvas(undefined, {
    width: size.width,
    height: size.height,
    enableRetinaScaling: false,
    backgroundColor: mode === "mask" ? "#000000" : "#ffffff",
  });
  for (const original of objects) {
    if (isDraft(original)) continue;
    const mask = isMask(original);
    if (mode === "composite" && mask) continue;
    if (mode === "mask" && !mask) continue;
    const clone = await original.clone(SERIALIZED_PROPS);
    if (mask) {
      const brushMask = ((original as EditorObject).editorName ?? "").includes("涂抹");
      clone.set({
        stroke: "#ffffff",
        fill: brushMask ? null : "#ffffff",
        opacity: 1,
        globalCompositeOperation: "source-over",
        shadow: undefined,
      });
    }
    surface.add(clone);
  }
  surface.renderAll();
  const blob = await surface.toBlob({
    format: "jpeg",
    quality: mode === "mask" ? 1 : editorConfig.jpegQuality,
    multiplier: 1,
    enableRetinaScaling: false,
  });
  await surface.dispose();
  if (!blob) throw new Error("JPG 生成失败");
  return blob;
}

function ToolButton({
  id, label, icon: Icon, active, onClick,
}: (typeof TOOL_ITEMS)[number] & { active: boolean; onClick: () => void }) {
  return (
    <button className={`tool-button ${active ? "active" : ""}`} onClick={onClick} type="button" aria-label={label} data-tool={id}>
      <Icon size={21} strokeWidth={1.9} /><span>{label}</span>
    </button>
  );
}

function SliderRow({ label, value, min, max, unit = "", onChange, onCommit }: {
  label: string; value: number; min: number; max: number; unit?: string;
  onChange: (value: number) => void; onCommit?: () => void;
}) {
  return (
    <label className="slider-row">
      <span className="slider-title"><span>{label}</span><strong>{value}{unit}</strong></span>
      <input type="range" min={min} max={max} value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        onMouseUp={onCommit} onTouchEnd={onCommit} />
    </label>
  );
}

export default function App() {
  const canvasElementRef = useRef<HTMLCanvasElement | null>(null);
  const canvasScrollRef = useRef<HTMLDivElement | null>(null);
  const fabricRef = useRef<Canvas | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const restoringRef = useRef(false);
  const activeToolRef = useRef<ToolId>("select");
  const eraseModeRef = useRef<EraseMode>("brush");
  const eraseControllerRef = useRef<AbortController | null>(null);
  const instructionControllerRef = useRef<AbortController | null>(null);
  const maskShapeRef = useRef<{ object: Rect; startX: number; startY: number } | null>(null);
  const pointLassoRef = useRef<{
    points: Array<{ x: number; y: number }>;
    segments: Line[];
    hoverLine: Line;
  } | null>(null);
  const annotationDraftRef = useRef<{
    type: "rect" | "circle" | "arrow";
    object: Rect | Ellipse | Line;
    startX: number;
    startY: number;
  } | null>(null);
  const finishPointLassoRef = useRef<() => void>(() => undefined);
  const cancelPointLassoRef = useRef<() => void>(() => undefined);
  const shapeColorRef = useRef("#2574d8");
  const sizeRef = useRef<DocumentSize>(INITIAL_SIZE);
  const zoomRef = useRef(0.72);

  const [activeTool, setActiveTool] = useState<ToolId>("select");
  const [eraseMode, setEraseModeState] = useState<EraseMode>("brush");
  const [eraseSize, setEraseSize] = useState(50);
  const [drawSize, setDrawSize] = useState(6);
  const [drawColor, setDrawColor] = useState("#2574d8");
  const [shapeColor, setShapeColor] = useState("#2574d8");
  const [zoom, setZoomState] = useState(0.72);
  const [docSize, setDocSize] = useState<DocumentSize>(INITIAL_SIZE);
  const [layers, setLayers] = useState<LayerItem[]>([]);
  const [notice, setNotice] = useState("正在载入默认图片…");
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [isErasing, setIsErasing] = useState(false);
  const [isInstructionEditing, setIsInstructionEditing] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [adjustments, setAdjustments] = useState<ImageAdjustments>(DEFAULT_ADJUSTMENTS);

  const updateHistoryFlags = useCallback(() => {
    setCanUndo(historyIndexRef.current > 0);
    setCanRedo(historyIndexRef.current < historyRef.current.length - 1);
  }, []);

  const refreshLayers = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const selected = canvas.getActiveObjects();
    setLayers(canvas.getObjects().filter((item) => !isDraft(item)).map((item, index) => {
      const object = item as EditorObject;
      if (!object.editorId) object.editorId = uid("layer");
      if (!object.editorName) object.editorName = `图层 ${index + 1}`;
      return {
        id: object.editorId, name: object.editorName, role: object.editorRole ?? "shape",
        visible: object.visible !== false, locked: Boolean(object.editorLocked),
        selected: selected.includes(item),
      } as LayerItem;
    }).reverse());
  }, []);

  const applyCanvasSize = useCallback((size: DocumentSize, nextZoom = zoomRef.current) => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    canvas.setDimensions({
      width: Math.max(1, Math.round(size.width * nextZoom)),
      height: Math.max(1, Math.round(size.height * nextZoom)),
    });
    canvas.setZoom(nextZoom);
    canvas.requestRenderAll();
  }, []);

  const fitCanvasToViewport = useCallback((size = sizeRef.current) => {
    requestAnimationFrame(() => {
      const viewport = canvasScrollRef.current;
      if (!viewport) return;
      const availableWidth = Math.max(180, viewport.clientWidth - 72);
      const availableHeight = Math.max(180, viewport.clientHeight - 104);
      const fitted = Math.min(1, availableWidth / size.width, availableHeight / size.height) * 0.96;
      const value = Math.max(0.1, Number(fitted.toFixed(3)));
      zoomRef.current = value;
      setZoomState(value);
      applyCanvasSize(size, value);
    });
  }, [applyCanvasSize]);

  const captureHistory = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas || restoringRef.current) return;
    const snapshot: HistorySnapshot = { size: sizeRef.current, canvas: canvas.toObject(SERIALIZED_PROPS) };
    const encoded = JSON.stringify(snapshot);
    if (historyRef.current[historyIndexRef.current] === encoded) return;
    historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
    historyRef.current.push(encoded);
    if (historyRef.current.length > 50) historyRef.current.shift();
    historyIndexRef.current = historyRef.current.length - 1;
    updateHistoryFlags();
    refreshLayers();
  }, [refreshLayers, updateHistoryFlags]);

  const configureTool = useCallback((tool: ToolId) => {
    const canvas = fabricRef.current;
    activeToolRef.current = tool;
    setActiveTool(tool);
    if (!canvas) return;
    if (annotationDraftRef.current) {
      canvas.remove(annotationDraftRef.current.object);
      annotationDraftRef.current = null;
    }
    if (!(tool === "erase" && eraseModeRef.current === "lasso")) cancelPointLassoRef.current();
    const eraseDrawing = tool === "erase" && (eraseModeRef.current === "brush" || eraseModeRef.current === "ellipse");
    const createsOnCanvas = tool === "text" || tool === "rect" || tool === "circle" || tool === "arrow";
    canvas.isDrawingMode = tool === "draw" || eraseDrawing;
    canvas.selection = tool === "select" || tool === "layers";
    canvas.skipTargetFind = !canvas.selection;
    canvas.defaultCursor = canvas.isDrawingMode || createsOnCanvas || tool === "erase" ? "crosshair" : "default";
    if (!canvas.selection) canvas.discardActiveObject();
    canvas.requestRenderAll();
  }, []);

  const restoreHistory = useCallback(async (nextIndex: number) => {
    const canvas = fabricRef.current;
    const encoded = historyRef.current[nextIndex];
    if (!canvas || !encoded) return;
    const snapshot = JSON.parse(encoded) as HistorySnapshot;
    restoringRef.current = true;
    canvas.discardActiveObject();
    await canvas.loadFromJSON(snapshot.canvas);
    sizeRef.current = snapshot.size;
    setDocSize(snapshot.size);
    applyCanvasSize(snapshot.size);
    canvas.getObjects().forEach((item) => {
      const object = item as EditorObject;
      const fixed = object.editorRole === "image" || object.editorRole === "erase-mask";
      object.set({ selectable: !fixed && !object.editorLocked, evented: !fixed && !object.editorLocked });
    });
    historyIndexRef.current = nextIndex;
    restoringRef.current = false;
    configureTool(activeToolRef.current);
    updateHistoryFlags();
    refreshLayers();
    canvas.requestRenderAll();
  }, [applyCanvasSize, configureTool, refreshLayers, updateHistoryFlags]);

  const undo = useCallback(() => {
    if (historyIndexRef.current > 0) void restoreHistory(historyIndexRef.current - 1);
  }, [restoreHistory]);

  const redo = useCallback(() => {
    if (historyIndexRef.current < historyRef.current.length - 1) void restoreHistory(historyIndexRef.current + 1);
  }, [restoreHistory]);

  const replaceCurrentImage = useCallback(async (
    blob: Blob,
    name: string,
    options: { capture?: boolean; keepTool?: boolean } = {},
  ) => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const normalized = await normalizeToJpeg(blob);
    const element = await loadImageElement(normalized.dataUrl);
    element.width = normalized.width;
    element.height = normalized.height;
    const image = new FabricImage(element, {
      left: 0,
      top: 0,
      originX: "left",
      originY: "top",
      scaleX: 1,
      scaleY: 1,
      selectable: false,
      evented: false,
    });
    const object = image as EditorObject;
    object.editorId = uid("image");
    object.editorName = name.replace(/\.[^.]+$/, "") || "当前图片";
    object.editorRole = "image";
    restoringRef.current = true;
    canvas.clear();
    sizeRef.current = { width: normalized.width, height: normalized.height };
    setDocSize(sizeRef.current);
    applyCanvasSize(sizeRef.current);
    canvas.add(image);
    canvas.sendObjectToBack(image);
    canvas.requestRenderAll();
    restoringRef.current = false;
    refreshLayers();
    if (options.capture !== false) captureHistory();
    if (options.keepTool !== false) configureTool(activeToolRef.current);
    fitCanvasToViewport(sizeRef.current);
  }, [applyCanvasSize, captureHistory, configureTool, fitCanvasToViewport, refreshLayers]);

  useEffect(() => { shapeColorRef.current = shapeColor; }, [shapeColor]);

  useEffect(() => {
    const viewport = canvasScrollRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(() => fitCanvasToViewport(sizeRef.current));
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [fitCanvasToViewport]);

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas || (activeTool !== "draw" && activeTool !== "erase")) return;
    const brush = new PencilBrush(canvas);
    if (activeTool === "draw") {
      brush.width = drawSize;
      brush.color = drawColor;
    } else if (eraseMode === "brush") {
      brush.width = eraseSize;
      brush.color = "rgba(255,63,82,.48)";
    } else {
      brush.width = 3;
      brush.color = "rgba(255,63,82,.9)";
    }
    canvas.freeDrawingBrush = brush;
  }, [activeTool, drawColor, drawSize, eraseMode, eraseSize]);

  useEffect(() => {
    if (!canvasElementRef.current) return;
    const canvas = new Canvas(canvasElementRef.current, {
      width: Math.round(INITIAL_SIZE.width * zoomRef.current),
      height: Math.round(INITIAL_SIZE.height * zoomRef.current),
      enableRetinaScaling: false, preserveObjectStacking: true,
      selectionColor: "rgba(35,116,216,.10)", selectionBorderColor: "#2574d8",
    });
    canvas.setZoom(zoomRef.current);
    fabricRef.current = canvas;

    const sync = () => refreshLayers();
    canvas.on("selection:created", sync);
    canvas.on("selection:updated", sync);
    canvas.on("selection:cleared", sync);
    canvas.on("object:modified", () => captureHistory());
    canvas.on("text:editing:exited", () => captureHistory());
    canvas.on("object:added", sync);
    canvas.on("object:removed", sync);

    cancelPointLassoRef.current = () => {
      const draft = pointLassoRef.current;
      if (!draft) return;
      pointLassoRef.current = null;
      canvas.remove(...draft.segments, draft.hoverLine);
      canvas.requestRenderAll();
    };
    finishPointLassoRef.current = () => {
      const draft = pointLassoRef.current;
      if (!draft || draft.points.length < 3) {
        setNotice("套索至少需要 3 个点；继续点击，最后双击闭合");
        return;
      }
      pointLassoRef.current = null;
      canvas.remove(...draft.segments, draft.hoverLine);
      const polygon = new Polygon(draft.points, {
        fill: "rgba(255,63,82,.25)", stroke: "rgba(255,63,82,.78)", strokeWidth: 3,
        selectable: false, evented: false, objectCaching: false,
        editorId: uid("mask"), editorName: "套索消除区", editorRole: "erase-mask",
      } as never);
      canvas.add(polygon);
      canvas.requestRenderAll();
      captureHistory();
      setNotice("套索已闭合并加入遮罩，可继续选择或执行消除");
    };

    canvas.on("path:created", (event) => {
      const path = event.path as EditorObject;
      if (activeToolRef.current === "erase") {
        const circleSelect = eraseModeRef.current === "ellipse";
        path.set({
          editorId: uid("mask"), editorName: circleSelect ? "圈选消除区" : "涂抹消除区",
          editorRole: "erase-mask", selectable: false, evented: false,
          fill: circleSelect ? "rgba(255,63,82,.25)" : null,
          stroke: "rgba(255,63,82,.65)", opacity: 1,
        });
        setNotice("消除区域已加入遮罩，可继续选择或执行消除");
      } else {
        path.set({ editorId: uid("draw"), editorName: "自由画笔", editorRole: "drawing" });
      }
      captureHistory();
    });

    canvas.on("mouse:down", (event) => {
      const tool = activeToolRef.current;
      const point = canvas.getScenePoint(event.e);
      const color = shapeColorRef.current;
      const strokeWidth = Math.max(3, sizeRef.current.width * 0.0045);

      if (tool === "text") {
        const text = new Textbox("输入文字", {
          left: point.x, top: point.y, width: Math.min(420, sizeRef.current.width * 0.42),
          originX: "left", originY: "top", fontSize: Math.max(24, sizeRef.current.width * 0.035),
          fontFamily: "Arial, 'Microsoft YaHei', sans-serif", fill: color,
          editorId: uid("text"), editorName: "文字", editorRole: "text",
        } as never);
        canvas.add(text);
        canvas.setActiveObject(text);
        captureHistory();
        configureTool("select");
        requestAnimationFrame(() => { text.enterEditing(); text.selectAll(); });
        setNotice("文字已放到点击位置，直接输入内容即可");
        return;
      }

      if (tool === "rect" || tool === "circle" || tool === "arrow") {
        const base = {
          left: point.x, top: point.y, originX: "left", originY: "top",
          fill: "rgba(255,255,255,0)", stroke: color, strokeWidth,
          selectable: false, evented: false, objectCaching: false,
        };
        const object = tool === "rect"
          ? new Rect({ ...base, width: 1, height: 1, rx: 8, ry: 8 } as never)
          : tool === "circle"
            ? new Ellipse({ ...base, rx: 0.5, ry: 0.5 } as never)
            : new Line([point.x, point.y, point.x, point.y], { stroke: color, strokeWidth, selectable: false, evented: false } as never);
        canvas.add(object);
        annotationDraftRef.current = { type: tool, object, startX: point.x, startY: point.y };
        return;
      }

      if (tool !== "erase") return;
      const mode = eraseModeRef.current;
      if (mode === "lasso") {
        const detail = (event.e as MouseEvent).detail;
        if (detail >= 2) {
          finishPointLassoRef.current();
          return;
        }
        const draft = pointLassoRef.current;
        if (!draft) {
          const hoverLine = new Line([point.x, point.y, point.x, point.y], {
            stroke: "rgba(255,63,82,.85)", strokeWidth: 3,
            selectable: false, evented: false, objectCaching: false,
          });
          (hoverLine as EditorObject).editorDraft = true;
          pointLassoRef.current = { points: [point], segments: [], hoverLine };
          canvas.add(hoverLine);
          setNotice("逐点点击形成多边形，最后双击或按 Enter 闭合");
        } else {
          const from = draft.points[draft.points.length - 1];
          canvas.remove(draft.hoverLine);
          const fixedLine = new Line([from.x, from.y, point.x, point.y], {
            stroke: "rgba(255,63,82,.85)", strokeWidth: 3,
            selectable: false, evented: false, objectCaching: false,
          });
          (fixedLine as EditorObject).editorDraft = true;
          const hoverLine = new Line([point.x, point.y, point.x, point.y], {
            stroke: "rgba(255,63,82,.85)", strokeWidth: 3,
            selectable: false, evented: false, objectCaching: false,
          });
          (hoverLine as EditorObject).editorDraft = true;
          draft.segments.push(fixedLine);
          draft.points.push(point);
          draft.hoverLine = hoverLine;
          canvas.add(fixedLine, hoverLine);
          canvas.requestRenderAll();
        }
        return;
      }
      if (mode !== "rect") return;
      const common = {
        left: point.x, top: point.y, width: 1, height: 1,
        originX: "left", originY: "top",
        fill: "rgba(255,63,82,.25)", stroke: "rgba(255,63,82,.78)", strokeWidth: 3,
        selectable: false, evented: false, editorId: uid("mask"),
        editorName: "框选消除区", editorRole: "erase-mask",
      };
      const object = new Rect(common as never);
      canvas.add(object);
      maskShapeRef.current = { object, startX: point.x, startY: point.y };
    });
    canvas.on("mouse:move", (event) => {
      const point = canvas.getScenePoint(event.e);
      const annotation = annotationDraftRef.current;
      if (annotation) {
        const left = Math.min(annotation.startX, point.x);
        const top = Math.min(annotation.startY, point.y);
        const width = Math.abs(point.x - annotation.startX);
        const height = Math.abs(point.y - annotation.startY);
        if (annotation.object instanceof Ellipse) annotation.object.set({ left, top, rx: width / 2, ry: height / 2 });
        else if (annotation.object instanceof Rect) annotation.object.set({ left, top, width, height });
        else annotation.object.set({ x1: annotation.startX, y1: annotation.startY, x2: point.x, y2: point.y });
        annotation.object.setCoords();
        canvas.requestRenderAll();
        return;
      }

      const lasso = pointLassoRef.current;
      if (lasso) {
        lasso.hoverLine.set({ x2: point.x, y2: point.y });
        lasso.hoverLine.setCoords();
        canvas.requestRenderAll();
        return;
      }

      const current = maskShapeRef.current;
      if (!current) return;
      const left = Math.min(current.startX, point.x);
      const top = Math.min(current.startY, point.y);
      const width = Math.abs(point.x - current.startX);
      const height = Math.abs(point.y - current.startY);
      current.object.set({ left, top, width, height });
      current.object.setCoords();
      canvas.requestRenderAll();
    });
    canvas.on("mouse:up", () => {
      const annotation = annotationDraftRef.current;
      if (annotation) {
        annotationDraftRef.current = null;
        const width = Math.abs(Number(annotation.object.width ?? 0) * Number(annotation.object.scaleX ?? 1));
        const height = Math.abs(Number(annotation.object.height ?? 0) * Number(annotation.object.scaleY ?? 1));
        let finalObject: FabricObject = annotation.object;
        if (annotation.type === "arrow") {
          const line = annotation.object as Line;
          const endX = Number(line.x2 ?? annotation.startX);
          const endY = Number(line.y2 ?? annotation.startY);
          const dx = endX - annotation.startX;
          const dy = endY - annotation.startY;
          const distance = Math.hypot(dx, dy);
          canvas.remove(line);
          if (distance < 5) return;
          const lineWidth = Math.max(3, sizeRef.current.width * 0.0045);
          const shaft = new Line([0, 0, distance, 0], { stroke: shapeColorRef.current, strokeWidth: lineWidth, strokeLineCap: "round" });
          const headSize = Math.max(18, lineWidth * 4.5);
          const head = new Triangle({ left: distance, top: 0, width: headSize, height: headSize * 1.2, fill: shapeColorRef.current, angle: 90, originX: "center", originY: "center" });
          finalObject = new Group([shaft, head], {
            left: annotation.startX, top: annotation.startY, originX: "left", originY: "center",
            angle: Math.atan2(dy, dx) * 180 / Math.PI,
          });
          canvas.add(finalObject);
        } else if (width < 4 || height < 4) {
          canvas.remove(annotation.object);
          return;
        }
        const editorObject = finalObject as EditorObject;
        editorObject.set({ selectable: true, evented: true });
        editorObject.editorId = uid("shape");
        editorObject.editorName = annotation.type === "rect" ? "矩形标注" : annotation.type === "circle" ? "圆形标注" : "箭头标注";
        editorObject.editorRole = "shape";
        canvas.setActiveObject(finalObject);
        canvas.requestRenderAll();
        captureHistory();
        configureTool("select");
        setNotice(`${editorObject.editorName}已创建，可拖动或缩放调整`);
        return;
      }

      if (!maskShapeRef.current) return;
      maskShapeRef.current = null;
      setNotice("消除区域已加入遮罩，可继续选择或执行消除");
      captureHistory();
    });

    configureTool("select");
    void (async () => {
      try {
        const queryImage = new URLSearchParams(window.location.search).get("image")?.trim();
        const initialUrl = queryImage || editorConfig.defaultImageUrl;
        const blob = initialUrl
          ? await fetch(initialUrl).then((response) => {
              if (!response.ok) throw new Error(`默认图片加载失败：HTTP ${response.status}`);
              return response.blob();
            })
          : await createDefaultImage();
        historyRef.current = [];
        historyIndexRef.current = -1;
        await replaceCurrentImage(blob, "当前图片", { keepTool: false });
        setNotice("当前图片已就绪");
      } catch (error) {
        setNotice((error as Error).message || "默认图片加载失败");
      }
    })();

    return () => {
      eraseControllerRef.current?.abort();
      instructionControllerRef.current?.abort();
      finishPointLassoRef.current = () => undefined;
      cancelPointLassoRef.current = () => undefined;
      fabricRef.current = null;
      void canvas.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setZoom = useCallback((nextZoom: number) => {
    const value = Math.min(1.5, Math.max(0.1, Number(nextZoom.toFixed(2))));
    zoomRef.current = value;
    setZoomState(value);
    applyCanvasSize(sizeRef.current, value);
  }, [applyCanvasSize]);

  const setEraseMode = useCallback((mode: EraseMode) => {
    eraseModeRef.current = mode;
    setEraseModeState(mode);
    configureTool("erase");
  }, [configureTool]);

  const handleFiles = useCallback((files: FileList | File[]) => {
    const file = Array.from(files).find((item) => item.type.startsWith("image/"));
    if (!file) return setNotice("请选择 JPG、PNG 或 WebP 图片");
    void replaceCurrentImage(file, file.name)
      .then(() => setNotice("当前图片已替换；旧图片可通过撤销恢复"))
      .catch((error) => setNotice((error as Error).message));
  }, [replaceCurrentImage]);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const file = Array.from(event.clipboardData?.files ?? []).find((item) => item.type.startsWith("image/"));
      if (file) handleFiles([file]);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.matches("input, textarea, [contenteditable='true']")) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault(); event.shiftKey ? redo() : undo();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault(); redo();
      }
      if (activeToolRef.current === "erase" && eraseModeRef.current === "lasso" && event.key === "Enter") {
        event.preventDefault(); finishPointLassoRef.current();
      }
      if (activeToolRef.current === "erase" && eraseModeRef.current === "lasso" && event.key === "Escape") {
        event.preventDefault(); cancelPointLassoRef.current(); setNotice("已取消当前套索");
      }
    };
    window.addEventListener("paste", onPaste);
    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("paste", onPaste); window.removeEventListener("keydown", onKeyDown); };
  }, [handleFiles, redo, undo]);

  const handleTool = useCallback((tool: ToolId) => {
    if (tool === "image") return fileInputRef.current?.click();
    configureTool(tool);
    if (tool === "text") setNotice("在图片上点击文字起始位置");
    if (tool === "rect" || tool === "circle" || tool === "arrow") setNotice(`在图片上按住鼠标并拖动创建${tool === "rect" ? "矩形" : tool === "circle" ? "圆形" : "箭头"}`);
  }, [configureTool]);

  const clearMasks = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    cancelPointLassoRef.current();
    const masks = canvas.getObjects().filter(isMask);
    if (!masks.length) return;
    canvas.remove(...masks); canvas.requestRenderAll(); captureHistory(); setNotice("已清除全部消除选区");
  }, [captureHistory]);

  const executeErase = useCallback(async () => {
    const canvas = fabricRef.current;
    if (!canvas || isErasing) return;
    const objects = canvas.getObjects();
    const masks = objects.filter(isMask);
    if (!masks.length) return setNotice("请先使用涂抹、框选、圈选或套索选择消除区域");
    setIsErasing(true);
    const controller = new AbortController();
    eraseControllerRef.current?.abort(); eraseControllerRef.current = controller;
    try {
      let result: Blob;
      if (editorConfig.eraseApiUrl) {
        setNotice("正在提交当前 JPG 图片和黑白 JPG 遮罩…");
        const [image, mask] = await Promise.all([
          renderJpeg(objects, sizeRef.current, "composite"), renderJpeg(objects, sizeRef.current, "mask"),
        ]);
        result = await callEraseApi({ apiUrl: editorConfig.eraseApiUrl, image, mask, signal: controller.signal });
      } else {
        setNotice("测试模式：正在把消除区以白色覆盖到当前图片…");
        result = await renderJpeg(objects, sizeRef.current, "local-erase");
      }
      if (controller.signal.aborted) return;
      await replaceCurrentImage(result, "消除后的图片", { keepTool: true });
      configureTool("erase");
      setNotice(editorConfig.eraseApiUrl ? "消除完成，返回图片已替换当前图片" : "测试消除完成，白色涂抹已写入当前图片");
    } catch (error) {
      if ((error as Error).name !== "AbortError") setNotice((error as Error).message || "消除失败");
    } finally {
      if (eraseControllerRef.current === controller) eraseControllerRef.current = null;
      setIsErasing(false);
    }
  }, [configureTool, isErasing, replaceCurrentImage]);

  const executeInstructionEdit = useCallback(async () => {
    const canvas = fabricRef.current;
    const prompt = instruction.trim();
    if (!canvas || !prompt || isInstructionEditing) return;
    if (!editorConfig.instructionEditApiUrl) return setNotice("请在 .env 中配置 VITE_INSTRUCTION_EDIT_API_URL");
    const controller = new AbortController();
    instructionControllerRef.current?.abort(); instructionControllerRef.current = controller;
    setIsInstructionEditing(true); setNotice("正在提交当前合成 JPG 和改图指令…");
    try {
      const image = await renderJpeg(canvas.getObjects(), sizeRef.current, "composite");
      const objects = JSON.stringify(canvas.getObjects()
        .filter((item) => {
          const role = (item as EditorObject).editorRole;
          return role !== "image" && role !== "erase-mask";
        })
        .map((item) => item.toObject(SERIALIZED_PROPS)));
      const result = await callInstructionEditApi({
        apiUrl: editorConfig.instructionEditApiUrl, image, prompt, objects, signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      await replaceCurrentImage(result, "指令改图结果", { keepTool: false });
      setInstruction(""); configureTool("select");
      setNotice("指令改图完成，返回图片已替换当前图片");
    } catch (error) {
      if ((error as Error).name !== "AbortError") setNotice((error as Error).message || "指令改图失败");
    } finally {
      if (instructionControllerRef.current === controller) instructionControllerRef.current = null;
      setIsInstructionEditing(false);
    }
  }, [configureTool, instruction, isInstructionEditing, replaceCurrentImage]);

  const applyAdjustments = useCallback((next: ImageAdjustments) => {
    setAdjustments(next);
    const canvas = fabricRef.current;
    const image = canvas?.getObjects().find((item) => (item as EditorObject).editorRole === "image");
    if (!canvas || !(image instanceof FabricImage)) return;
    const nextFilters = [];
    if (next.brightness) nextFilters.push(new filters.Brightness({ brightness: next.brightness / 100 }));
    if (next.contrast) nextFilters.push(new filters.Contrast({ contrast: next.contrast / 100 }));
    if (next.saturation) nextFilters.push(new filters.Saturation({ saturation: next.saturation / 100 }));
    if (next.blur) nextFilters.push(new filters.Blur({ blur: next.blur / 100 }));
    if (next.grayscale) nextFilters.push(new filters.Grayscale());
    if (next.sepia) nextFilters.push(new filters.Sepia());
    image.filters = nextFilters; image.applyFilters(); canvas.requestRenderAll();
  }, []);

  const exportImage = useCallback(async () => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    try {
      const blob = await renderJpeg(canvas.getObjects(), sizeRef.current, "composite");
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `pixelweave-${new Date().toISOString().slice(0, 10)}.jpg`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000); setNotice("JPG 已导出（无透明通道）");
    } catch (error) { setNotice((error as Error).message || "导出失败"); }
  }, []);

  const selectLayer = useCallback((id: string) => {
    const canvas = fabricRef.current;
    const object = canvas?.getObjects().find((item) => (item as EditorObject).editorId === id) as EditorObject | undefined;
    if (!canvas || !object || object.editorRole === "image" || object.editorRole === "erase-mask" || object.editorLocked) return;
    canvas.setActiveObject(object); canvas.requestRenderAll(); refreshLayers();
  }, [refreshLayers]);

  const toggleLayerVisible = useCallback((id: string) => {
    const canvas = fabricRef.current;
    const object = canvas?.getObjects().find((item) => (item as EditorObject).editorId === id) as EditorObject | undefined;
    if (!canvas || !object) return;
    object.set("visible", object.visible === false); canvas.requestRenderAll(); captureHistory();
  }, [captureHistory]);

  const toggleLayerLock = useCallback((id: string) => {
    const canvas = fabricRef.current;
    const object = canvas?.getObjects().find((item) => (item as EditorObject).editorId === id) as EditorObject | undefined;
    if (!canvas || !object || object.editorRole === "image" || object.editorRole === "erase-mask") return;
    object.editorLocked = !object.editorLocked;
    object.set({ selectable: !object.editorLocked, evented: !object.editorLocked });
    if (object.editorLocked) canvas.discardActiveObject();
    canvas.requestRenderAll(); captureHistory();
  }, [captureHistory]);

  const moveLayer = useCallback((id: string, direction: "up" | "down") => {
    const canvas = fabricRef.current;
    const object = canvas?.getObjects().find((item) => (item as EditorObject).editorId === id);
    if (!canvas || !object || (object as EditorObject).editorRole === "image") return;
    direction === "up" ? canvas.bringObjectForward(object) : canvas.sendObjectBackwards(object);
    const base = canvas.getObjects().find((item) => (item as EditorObject).editorRole === "image");
    if (base) canvas.sendObjectToBack(base);
    canvas.requestRenderAll(); captureHistory();
  }, [captureHistory]);

  const deleteSelected = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const removable = canvas.getActiveObjects().filter((item) => {
      const object = item as EditorObject;
      return object.editorRole !== "image" && !object.editorLocked;
    });
    if (!removable.length) return setNotice("请先选择可删除的标注图层");
    canvas.remove(...removable); canvas.discardActiveObject(); captureHistory();
  }, [captureHistory]);

  const activePanelTitle = useMemo(() => {
    if (activeTool === "erase") return "消除笔";
    if (activeTool === "draw") return "自由绘制";
    if (activeTool === "adjust") return "图片调整";
    if (activeTool === "layers") return "图层管理";
    return "快速编辑";
  }, [activeTool]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark"><Sparkles size={27} /></span><span><strong>PixelWeave</strong><small>Studio · 单图编辑器</small></span></div>
        <div className="top-actions">
          <button className="icon-button" onClick={undo} disabled={!canUndo} title="撤销 Ctrl+Z"><Undo2 /></button>
          <button className="icon-button" onClick={redo} disabled={!canRedo} title="重做 Ctrl+Y"><Redo2 /></button>
          <button className="text-button" onClick={() => fileInputRef.current?.click()}><Upload size={17} />替换当前图片</button>
          <span className="shortcut-tip">每次只编辑一张图片</span>
        </div>
        <div className="top-right"><span className="document-size">{docSize.width} × {docSize.height}</span><button className="primary-button" onClick={() => void exportImage()}><Save size={17} />导出 JPG</button></div>
      </header>

      <main className="workspace">
        <aside className="tool-rail">
          {TOOL_ITEMS.map((tool) => <ToolButton key={tool.id} {...tool} active={activeTool === tool.id} onClick={() => handleTool(tool.id)} />)}
        </aside>

        <aside className="settings-panel">
          <div className="panel-heading"><span>{activePanelTitle}</span><ChevronDown size={17} /></div>
          {activeTool === "erase" ? (
            <div className="panel-content">
              <div className="erase-mode-grid">
                {ERASE_MODES.map(({ id, label, icon: Icon }) => (
                  <button key={id} className={eraseMode === id ? "selected" : ""} onClick={() => setEraseMode(id)}><Icon /><span>{label}</span></button>
                ))}
              </div>
              {eraseMode === "brush" && <SliderRow label="消除笔大小" value={eraseSize} min={8} max={180} unit=" px" onChange={setEraseSize} />}
              <button className="primary-button full" onClick={() => void executeErase()} disabled={isErasing}><Eraser size={17} />{isErasing ? "正在消除…" : "执行消除"}</button>
              <button className="secondary-button full" onClick={clearMasks}>清除全部选区</button>
              <div className="tip-card"><strong>遮罩规则</strong><span>接口收到黑底白区的 JPG 遮罩：纯白消除，纯黑保留。未配置接口时以白色覆盖模拟结果。</span></div>
            </div>
          ) : activeTool === "draw" ? (
            <div className="panel-content"><div className="color-row"><label>画笔颜色</label><input type="color" value={drawColor} onChange={(event) => setDrawColor(event.target.value)} /><code>{drawColor.toUpperCase()}</code></div><SliderRow label="画笔大小" value={drawSize} min={1} max={60} unit=" px" onChange={setDrawSize} /></div>
          ) : activeTool === "adjust" ? (
            <div className="panel-content">
              <SliderRow label="亮度" value={adjustments.brightness} min={-100} max={100} onChange={(value) => applyAdjustments({ ...adjustments, brightness: value })} onCommit={captureHistory} />
              <SliderRow label="对比度" value={adjustments.contrast} min={-100} max={100} onChange={(value) => applyAdjustments({ ...adjustments, contrast: value })} onCommit={captureHistory} />
              <SliderRow label="饱和度" value={adjustments.saturation} min={-100} max={100} onChange={(value) => applyAdjustments({ ...adjustments, saturation: value })} onCommit={captureHistory} />
              <SliderRow label="模糊" value={adjustments.blur} min={0} max={30} onChange={(value) => applyAdjustments({ ...adjustments, blur: value })} onCommit={captureHistory} />
              <div className="toggle-grid"><button className={adjustments.grayscale ? "selected" : ""} onClick={() => { applyAdjustments({ ...adjustments, grayscale: !adjustments.grayscale }); setTimeout(captureHistory); }}>黑白</button><button className={adjustments.sepia ? "selected" : ""} onClick={() => { applyAdjustments({ ...adjustments, sepia: !adjustments.sepia }); setTimeout(captureHistory); }}>复古</button></div>
            </div>
          ) : (
            <div className="panel-content">
              <button className="large-action" onClick={() => fileInputRef.current?.click()}><ImagePlus /><span><strong>替换当前图片</strong><small>不会新增第二张图片</small></span></button>
              <div className="panel-section"><h3>常用标注</h3><div className="quick-grid"><button onClick={() => handleTool("text")}><Type />文字</button><button onClick={() => handleTool("rect")}><Square />矩形</button><button onClick={() => handleTool("circle")}><CircleIcon />圆形</button><button onClick={() => handleTool("arrow")}><ArrowRight />箭头</button></div></div>
              <div className="color-row"><label>标注颜色</label><input type="color" value={shapeColor} onChange={(event) => setShapeColor(event.target.value)} /><code>{shapeColor.toUpperCase()}</code></div>
              {(activeTool === "text" || activeTool === "rect" || activeTool === "circle" || activeTool === "arrow") && <div className="tip-card"><strong>在图片上创建</strong><span>{activeTool === "text" ? "点击需要放置文字的位置，然后直接输入。" : `按住鼠标拖动，松开后生成${activeTool === "rect" ? "矩形" : activeTool === "circle" ? "圆形" : "箭头"}。`}</span></div>}
              <button className="danger-button full" onClick={deleteSelected}><Trash2 size={17} />删除所选标注</button>
            </div>
          )}
        </aside>

        <section className="canvas-stage">
          <div className="notice-bar"><Check size={14} /><span>{notice}</span></div>
          <div className="canvas-scroll" ref={canvasScrollRef}>
            <div className="canvas-content">
              <div className="canvas-shadow"><canvas ref={canvasElementRef} /></div>
              <div className="instruction-bar">
                <WandSparkles size={18} />
                <input
                  value={instruction}
                  onChange={(event) => setInstruction(event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void executeInstructionEdit(); } }}
                  placeholder="输入改图指令，将当前图片和全部标注一起发送…"
                  aria-label="指令改图"
                />
                <button className="primary-button" onClick={() => void executeInstructionEdit()} disabled={!instruction.trim() || isInstructionEditing}>
                  {isInstructionEditing ? "正在改图…" : "发送改图"}
                </button>
              </div>
            </div>
          </div>
          <div className="zoom-control"><button onClick={() => setZoom(zoom - 0.1)}><ZoomOut /></button><span>{Math.round(zoom * 100)}%</span><button onClick={() => setZoom(zoom + 0.1)}><ZoomIn /></button></div>
        </section>

        <aside className="layers-panel">
          <div className="layers-heading"><span><Layers3 size={18} />图层</span><strong>{layers.length}</strong></div>
          <div className="layer-list">
            {layers.map((layer) => (
              <div className={`layer-card ${layer.selected ? "selected" : ""}`} key={layer.id} onClick={() => selectLayer(layer.id)} role="button" tabIndex={0}>
                <span className={`layer-thumb role-${layer.role}`}>{layer.role === "image" ? <ImagePlus /> : layer.role === "text" ? <Type /> : layer.role === "erase-mask" ? <Eraser /> : layer.role === "drawing" ? <Brush /> : <Square />}</span>
                <span className="layer-info"><strong>{layer.name}</strong><small>{layer.role === "image" ? "唯一底图" : layer.role === "erase-mask" ? "消除遮罩" : "标注图层"}</small></span>
                <span className="layer-actions" onClick={(event) => event.stopPropagation()}><button onClick={() => toggleLayerVisible(layer.id)}>{layer.visible ? <Eye /> : <EyeOff />}</button>{layer.role !== "image" && layer.role !== "erase-mask" && <button onClick={() => toggleLayerLock(layer.id)}>{layer.locked ? <Lock /> : <Unlock />}</button>}</span>
              </div>
            ))}
          </div>
          <div className="layer-order"><span>标注层级</span><button onClick={() => { const item = layers.find((entry) => entry.selected); if (item) moveLayer(item.id, "up"); }}><ArrowUp /></button><button onClick={() => { const item = layers.find((entry) => entry.selected); if (item) moveLayer(item.id, "down"); }}><ArrowDown /></button></div>
        </aside>
      </main>

      <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => { if (event.target.files) handleFiles(event.target.files); event.target.value = ""; }} />
    </div>
  );
}
