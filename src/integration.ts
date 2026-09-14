import type { EraseTelemetryOptions } from "./telemetry";
export type { EraseTelemetryEvent, EraseTelemetryOptions } from "./telemetry";
/** Host adapter. The host owns authorization, detection, durable saving and review refresh. */
export type ImageContext = {
  taskId: string; imageId: string;
  /** Actual system base image record; absent when replacing from a local upload. */
  baseRecordId?: string;
  /** Opaque version of the target at opening, independent of the working base.
   * Optional for legacy hosts; M-37218 hosts must supply and enforce it, including first replacements. */
  targetVersion?: string;
};
export type AddedText = { id: string; text: string };
export type TextIssue = { objectId: string; words: string[] };
export type TextCheck = { passed: true } | { passed: false; message: string; objectId?: string; issues?: TextIssue[] };

/** Wrap a text-only service. The host handles HTTP/auth and extracts its words array. */
export function createTextValidator(checkText: (text: string) => Promise<string[]>): EditorIntegration["validateTexts"] {
  return async texts => {
    const requests = new Map<string, Promise<string[]>>();
    const issues = (await Promise.all(texts.map(async ({ id, text }) => {
      if (!requests.has(text)) requests.set(text, Promise.resolve().then(() => checkText(text)).then(normalizeWords));
      const words = await requests.get(text)!;
      return words.length ? { objectId: id, words } : undefined;
    }))).filter((issue): issue is TextIssue => !!issue);
    return issues.length ? { passed: false, message: "新增文案包含违禁词，请修改后再次替换", issues } : { passed: true };
  };
}

function normalizeWords(value: unknown): string[] {
  if (!Array.isArray(value) || value.some(word => typeof word !== "string" || !word.trim())) throw new Error("文案检测结果异常，请再次替换重试");
  return [...new Set(value.map(word => word.trim()))];
}

/** Reject incomplete/mismatched results instead of silently treating them as a pass. */
export function textCheckIssues(result: TextCheck, texts: AddedText[]): TextIssue[] {
  if (!result || (result.passed !== true && result.passed !== false)) throw new Error("文案检测结果异常，请再次替换重试");
  if (result.passed || result.issues === undefined) return [];
  if (!Array.isArray(result.issues) || !result.issues.length) throw new Error("文案检测结果异常，请再次替换重试");
  const merged = new Map<string, string[]>();
  for (const issue of result.issues) {
    if (!issue || !texts.some(text => text.id === issue.objectId)) throw new Error("文案检测结果无法对应图层，请再次替换重试");
    const words = normalizeWords(issue.words);
    if (!words.length) throw new Error("文案检测结果异常，请再次替换重试");
    merged.set(issue.objectId, [...new Set([...(merged.get(issue.objectId) ?? []), ...words])]);
  }
  return [...merged].map(([objectId, words]) => ({ objectId, words }));
}
export type ReplaceOutcome =
  | { status: "succeeded"; recordId: string }
  | { status: "failed"; message: string; objectId?: string }
  | { status: "pending" };

/** Both replacement and query receipts cross a runtime boundary; types alone are not validation. */
export function readReplacementOutcome(value: unknown): ReplaceOutcome {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { status: "pending" };
  const result = value as Record<string, unknown>;
  if (result.status === "succeeded" && typeof result.recordId === "string" && result.recordId.trim()) {
    return { status: "succeeded", recordId: result.recordId.trim() };
  }
  if (result.status === "failed") {
    const message = typeof result.message === "string" && result.message.trim() ? result.message.trim() : "替换未成功，编辑内容已保留，请重试";
    const objectId = typeof result.objectId === "string" ? result.objectId.trim() : "";
    return { status: "failed", message, ...(objectId ? { objectId } : {}) };
  }
  return { status: "pending" };
}
export type ReplacementInput = {
  submissionId: string; context: ImageContext; image: Blob; width: number; height: number;
  source: "online" | "upload"; texts: AddedText[];
};
/** Backend stage order: person -> XMP processing/verification -> OCR -> text check -> saving.
 * Report OCR only after metadata succeeds; successful OCR with no text may skip image_text.
 * These are progress reports, not proof of successful checks. Plain messages remain supported. */
export type ReplacementStage = "person" | "marking" | "ocr" | "image_text" | "saving";
export type ReplacementProgress = { stage: ReplacementStage; message?: string };
export type EditorIntegration = {
  /** Optional metadata-only receiver. Host owns transport, deduplication and aggregation. */
  telemetry?: EraseTelemetryOptions;
  /** Required business image. Missing/empty input never falls back to standalone preview defaults. */
  initialImage: Blob | string;
  context: ImageContext;
  validateTexts: (texts: AddedText[], context: ImageContext) => Promise<TextCheck>;
  replace: (input: ReplacementInput, progress: (value: string | ReplacementProgress) => void) => Promise<ReplaceOutcome>;
  confirmResult: (submissionId: string, context: ImageContext) => Promise<ReplaceOutcome>;
  onClose: (result: { reason: "discard" } | { reason: "saved"; recordId: string }) => void | Promise<void>;
};
declare global { interface Window { pixelweaveIntegration?: EditorIntegration } }
