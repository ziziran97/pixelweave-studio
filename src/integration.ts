/** Host adapter. The host owns authorization, detection, durable saving and review refresh. */
export type ImageContext = { taskId: string; imageId: string; baseRecordId?: string };
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
