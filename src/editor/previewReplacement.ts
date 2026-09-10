import type { ReplacementProgress } from "../integration";

export type PreviewReplacementScenario = "texts" | "success" | "slow" | "no_progress" | "image_blocked" | "detection_failed" | "unknown" | "review_failed";
type PreviewOutcome = "completed" | "unknown" | { message: string };

/** Kept out of normal production builds. No network, business records, or saved image IDs. */
export const previewReplacement = import.meta.env.DEV || import.meta.env.MODE === "demo" ? (() => {
  const scenarios: { id: PreviewReplacementScenario; label: string }[] = [
    { id: "success", label: "完整成功流程" }, { id: "texts", label: "仅新增文案检测" },
    { id: "slow", label: "等待较久" }, { id: "no_progress", label: "未回报具体阶段" },
    { id: "image_blocked", label: "图中文字未通过" }, { id: "detection_failed", label: "检测服务失败" },
    { id: "unknown", label: "替换结果待确认" }, { id: "review_failed", label: "审核页面刷新失败" },
  ];
  const normalize = (value: string | null): PreviewReplacementScenario => scenarios.find(item => item.id === value)?.id ?? "success";
  const wait = (duration: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException("已取消演示", "AbortError")); return; }
    const abort = () => { clearTimeout(timer); reject(new DOMException("已取消演示", "AbortError")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, duration);
    signal.addEventListener("abort", abort, { once: true });
  });
  async function run(scenario: PreviewReplacementScenario, report: (value: ReplacementProgress) => void, signal: AbortSignal): Promise<PreviewOutcome> {
    if (scenario === "no_progress") { await wait(2600, signal); return "completed"; }
    report({ stage: "person" }); await wait(scenario === "slow" ? 12000 : 850, signal);
    report({ stage: "ocr" }); await wait(650, signal);
    report({ stage: "image_text" }); await wait(900, signal);
    if (scenario === "image_blocked") return { message: "演示：图中文字未通过检查（模拟问题词：示例问题词）。尚未替换图片，编辑内容已保留。" };
    if (scenario === "detection_failed") return { message: "演示：图中文字检测服务暂不可用。尚未替换图片，编辑内容已保留，请稍后重试。" };
    report({ stage: "marking" }); await wait(450, signal);
    report({ stage: "saving" }); await wait(850, signal);
    return scenario === "unknown" ? "unknown" : "completed";
  }
  return { scenarios, normalize, wait, run };
})() : undefined;
