import type { AddedText, TextCheck } from "../integration";

/** Removed from normal production builds; never a fallback for host service errors. */
export const validatePreviewTexts: ((texts: AddedText[]) => Promise<TextCheck>) | undefined =
  import.meta.env.DEV || import.meta.env.MODE === "demo" ? async texts => {
    const issues = texts.filter(item => /\bdurable\b/i.test(item.text)).map(item => ({ objectId: item.id, words: ["durable"] }));
    return issues.length ? { passed: false, message: "新增文案包含模拟违禁词 durable", issues } : { passed: true };
  } : undefined;
