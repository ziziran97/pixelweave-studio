import type { FabricObject } from "fabric";

export type ToolId =
  | "select"
  | "image"
  | "erase"
  | "draw"
  | "text"
  | "rect"
  | "circle"
  | "arrow"
  | "adjust"
  | "layers";

export type EraseMode = "brush" | "rect" | "ellipse" | "lasso";

export type EditorRole =
  | "image"
  | "text"
  | "shape"
  | "drawing"
  | "erase-mask";

export type EditorObject = FabricObject & {
  editorId?: string;
  editorName?: string;
  editorRole?: EditorRole;
  editorLocked?: boolean;
  editorDraft?: boolean;
};

export type LayerItem = {
  id: string;
  name: string;
  role: EditorRole;
  visible: boolean;
  locked: boolean;
  selected: boolean;
};

export type DocumentSize = {
  width: number;
  height: number;
};

export type ImageAdjustments = {
  brightness: number;
  contrast: number;
  saturation: number;
  blur: number;
  grayscale: boolean;
  sepia: boolean;
};

export const DEFAULT_ADJUSTMENTS: ImageAdjustments = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  blur: 0,
  grayscale: false,
  sepia: false,
};
