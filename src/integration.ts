/** Host adapter. The host owns authorization, detection, durable saving and review refresh. */
export type ImageContext = { taskId: string; imageId: string; baseRecordId?: string };
export type AddedText = { id: string; text: string };
export type TextCheck = { passed: true } | { passed: false; message: string; objectId?: string };
export type ReplaceOutcome =
  | { status: "succeeded"; recordId: string }
  | { status: "failed"; message: string; objectId?: string }
  | { status: "pending" };
export type ReplacementInput = {
  submissionId: string; context: ImageContext; image: Blob; width: number; height: number;
  source: "online" | "upload"; texts: AddedText[];
};
export type EditorIntegration = {
  initialImage: Blob | string;
  context: ImageContext;
  validateTexts: (texts: AddedText[], context: ImageContext) => Promise<TextCheck>;
  replace: (input: ReplacementInput, progress: (message: string) => void) => Promise<ReplaceOutcome>;
  confirmResult: (submissionId: string, context: ImageContext) => Promise<ReplaceOutcome>;
  onClose: (result: { reason: "discard" } | { reason: "saved"; recordId: string }) => void | Promise<void>;
};
declare global { interface Window { pixelweaveIntegration?: EditorIntegration } }
