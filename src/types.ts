import type { FabricObject, SerializedObjectProps } from "fabric";

export type ToolId = "select" | "pan" | "erase" | "draw" | "text" | "rect" | "circle" | "adjust";
export type WorkspaceId = "erase" | "draw" | "text" | "adjust";
export type EraseMode = "brush" | "rect" | "freehand" | "lasso";
export type ObjectPurpose = "base" | "content";
export type EditorRole = "image" | "text" | "shape" | "drawing";
export type PointData = { x: number; y: number };

export interface EditorMetadata {
  editorId?: string;
  editorName?: string;
  editorRole?: EditorRole;
  editorPurpose?: ObjectPurpose;
  editorLocked?: boolean;
  editorAssetId?: string;
  editorFilled?: boolean;
  editorColor?: string;
  editorLineWidth?: number;
  editorLineStyle?: ShapeLineStyle;
  editorRadius?: number;
  editorTextBackground?: boolean;
  editorTextBackgroundColor?: string;
  editorTextBackgroundOpacity?: number;
  editorTextPadding?: number;
  editorTextRadius?: number;
  editorTextShadowColor?: string;
  editorTextShadowEnabled?: boolean;
  editorTextShadowBlur?: number;
  editorTextShadowOffsetX?: number;
  editorTextShadowOffsetY?: number;
  editorTextStrokeEnabled?: boolean;
  editorTextStrokeColor?: string;
  editorTextStrokeWidth?: number;
  editorTextBoldRestoreWeight?: string;
}

declare module "fabric" {
  interface FabricObject extends EditorMetadata {}
  interface SerializedObjectProps extends EditorMetadata {}
}

export type EditorObject = FabricObject;
export type ObjectData = Partial<SerializedObjectProps> & { type: string; src?: string; objects?: ObjectData[]; [key: string]: unknown };
export type MaskStroke = { kind: "brush" | "rect" | "polygon"; operation: "add" | "subtract"; points: PointData[]; width: number; breaks?: number[] };

export type LayerItem = {
  id: string;
  name: string;
  role: EditorRole;
  purpose: ObjectPurpose;
  visible: boolean;
  locked: boolean;
  selected: boolean;
  transparent?: boolean;
  textIssueWords?: string[];
  kind?: "rect" | "ellipse" | "brush";
  color?: string;
  thumbnailUrl?: string;
};

export type DocumentSize = {
  width: number;
  height: number;
};

export type ImageFilter = "none" | "clear" | "bright" | "soft" | "vivid" | "warm" | "cool" | "mono" | "sepia";
export type ImageAdjustments = {
  brightness: number;
  contrast: number;
  saturation: number;
  temperature: number;
  sharpen: number;
  overlayColor: string;
  overlayStrength: number;
  filter: ImageFilter;
  filterStrength: number;
};

export const DEFAULT_ADJUSTMENTS: ImageAdjustments = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  sharpen: 0,
  overlayColor: "#ffffff",
  overlayStrength: 0,
  filter: "none",
  filterStrength: 100,
};

export type ShapeLineStyle = "solid" | "dashed" | "dense-dashed" | "dotted" | "dash-dot";
export type ShapeProperties = { filled: boolean; color: string; lineWidth: number; lineStyle: ShapeLineStyle; radius: number; opacity: number };
export type DocumentSnapshot = {
  size: DocumentSize;
  objects: ObjectData[];
  masks: MaskStroke[];
  source?: "online" | "upload";
  adjustments: ImageAdjustments;
};
export type TextProperties = {
  fontFamily: string; fontSize: number; fill: string; fontWeight: string; fontStyle: string;
  underline?: boolean; linethrough?: boolean;
  opacity?: number;
  background: boolean; backgroundColor: string; backgroundOpacity?: number; backgroundPadding: number; backgroundRadius: number;
  textAlign: string; lineHeight: number; charSpacing: number;
  stroke: string; strokeWidth: number; shadowColor: string; shadowBlur: number;
  shadowOffsetX: number; shadowOffsetY: number;
  shadowEnabled?: boolean; strokeEnabled?: boolean; boldRestoreWeight?: string;
};
export type ImageRegion = { x: number; y: number; width: number; height: number };
export type EraseStage = "preparing" | "waiting" | "preview";
export type PendingResult = {
  assetId: string; beforeUrl: string; afterUrl: string;
  documentId: string; revision: number;
  acceptError?: string;
  previewError?: string; previewPreparing?: boolean; region?: ImageRegion;
};
export type ConfirmationKind = "replace" | "reset" | "upload" | "close" | "switch";
export type EditorConfirmation = { id: string; kind: ConfirmationKind;
  preview?: { status: "loading" | "ready" | "error"; url?: string; error?: string };
};
export type EditorView = {
  confirmation?: EditorConfirmation;
  ready: boolean; busy: boolean; task: boolean; notice: string;
  eraseStage?: EraseStage; eraseStageStartedAt?: number;
  noticeId: number; noticePresentation: "quiet" | "transient" | "persistent";
  tool: ToolId; eraseMode: EraseMode; maskOperation: "add" | "subtract";
  workspace: WorkspaceId; drawingTool: "draw" | "rect" | "circle"; propertiesRequest: number;
  brushSize: number; drawSize: number; color: string;
  zoom: number; size: DocumentSize; layers: LayerItem[]; selectionCount: number;
  canCenterSelection?: boolean;
  shape: ShapeProperties; shapeKind?: "rect" | "circle"; drawing?: { color: string; width: number };
  shapeRadiusMax?: number;
  picking: boolean; colorEditing: boolean; submitting: boolean; submissionStage: string; needsConfirmation: boolean; saved: boolean; closed: boolean;
  submissionProgress?: import("./editor/submissionProgress").SubmissionProgress;
  previewScenario?: import("./editor/previewReplacement").PreviewReplacementScenario;
  canSubmit: boolean; canUpload: boolean;
  problemObjectId?: string;
  problemObjectIds?: string[];
  selectedId?: string; selectedPurpose?: ObjectPurpose; text?: TextProperties;
  textEditing?: boolean; textVertical?: boolean; textError?: string; textFontError?: string;
  masks: number; lassoPoints: number;
  hasMask: boolean; maskHidden: boolean;
  unfinishedSelection: boolean; canUndo: boolean; canRedo: boolean; dirty: boolean;
  adjustments: ImageAdjustments; pending?: PendingResult;
  originalUrl?: string; compareOriginal: boolean; compareAdjustments?: boolean;
};
