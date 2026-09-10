import type { ReplacementProgress, ReplacementStage } from "../integration";

export type SubmissionProgress = {
  step: "texts" | "image" | "saving" | "review";
  status: "processing" | "unknown" | "querying" | "review_failed" | "preview_complete";
  textsSkipped: boolean;
  waitStartedAt: number;
  backendStage?: ReplacementStage;
};

const STAGES: ReplacementStage[] = ["person", "ocr", "image_text", "marking", "saving"];
const MESSAGES: Record<ReplacementStage, string> = {
  person: "正在检测图片中的人物…",
  ocr: "正在识别图片中的文字…",
  image_text: "正在检查图中文字是否符合要求…",
  marking: "正在准备图片保存信息…",
  saving: "检查已完成，正在保存图片…",
};

/** Do not infer stages from arbitrary text, or let out-of-order callbacks move the UI backwards. */
export function readReplacementProgress(value: unknown, previous?: ReplacementStage):
  { message: string; stage?: ReplacementStage } | undefined {
  if (typeof value === "string") {
    const message = value.trim();
    return message ? { message: message.slice(0, 500) } : undefined;
  }
  if (!value || typeof value !== "object") return;
  const { stage, message } = value as ReplacementProgress;
  if (!STAGES.includes(stage) || (previous && STAGES.indexOf(stage) < STAGES.indexOf(previous))) return;
  if (message !== undefined && typeof message !== "string") return;
  return { stage, message: message?.trim().slice(0, 500) || MESSAGES[stage] };
}

export function submissionSteps(progress: SubmissionProgress) {
  const order = ["texts", "image", "saving", "review"] as const;
  const labels = ["新增文案", "图片检测", "保存图片", "返回审核"];
  const current = order.indexOf(progress.step);
  return order.map((id, index) => ({ id, label: labels[index], status:
    id === "texts" && progress.textsSkipped ? "skipped" :
    progress.status === "preview_complete" || index < current ? "done" :
    index === current ? (progress.status === "review_failed" ? "failed" : "active") : "waiting" }));
}
