export const editorConfig = {
  /** 消除：image.jpg + 严格二值 mask.png。未配置时不模拟生成。 */
  eraseApiUrl: import.meta.env.VITE_ERASER_API_URL?.trim() ?? "",
  /** 可配置默认图片；也支持访问页面时传入 ?image=https://... */
  defaultImageUrl: import.meta.env.VITE_DEFAULT_IMAGE_URL?.trim() ?? "",

  jpegQuality: 0.94,
  historyBudgetBytes: 256 * 1024 * 1024,
};

