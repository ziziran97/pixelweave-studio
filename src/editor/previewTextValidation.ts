import type { AddedText, TextCheck } from "../integration";

/** Removed from normal production builds; never a fallback for host service errors. */
export const validatePreviewTexts: ((texts: AddedText[]) => Promise<TextCheck>) | undefined =
  import.meta.env.DEV || import.meta.env.MODE === "demo" ? async texts => {
    const issues = texts.flatMap(item => {
      const words = [...new Set((item.text.match(/\b(?:durable|supreme)\b/gi) ?? []).map(word => word.toLowerCase()))];
      return words.length ? [{ objectId: item.id, words }] : [];
    });
    return issues.length ? { passed: false, message: "新增文案包含模拟违禁词", issues } : { passed: true };
  } : undefined;
