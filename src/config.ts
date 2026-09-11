export const isPureDemo = import.meta.env.MODE === "demo";
export const isLocalEraseTest = import.meta.env.MODE === "production-test";

export const editorConfig = {
  /** 业务后端消除地址；提交 image.jpg + 不透明黑白 mask.png。留空时提示尚未接入。 */
  eraseApiUrl: isPureDemo ? "" : import.meta.env.VITE_ERASER_API_URL?.trim() ?? "",
  /** 可配置默认图片；也支持访问页面时传入 ?image=https://... */
  defaultImageUrl: isPureDemo ? "" : import.meta.env.VITE_DEFAULT_IMAGE_URL?.trim() ?? "",

  jpegQuality: 0.94,
  historyBudgetBytes: 256 * 1024 * 1024,
};

