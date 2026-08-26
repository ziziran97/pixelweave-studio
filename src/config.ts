export const editorConfig = {
  /** 消除接口：multipart 字段为 image、mask，二者均为 JPG。 */
  eraseApiUrl: import.meta.env.VITE_ERASER_API_URL?.trim() ?? "",

  /** 指令改图接口：multipart 字段为 image、prompt。 */
  instructionEditApiUrl:
    import.meta.env.VITE_INSTRUCTION_EDIT_API_URL?.trim() ?? "",

  /** 可配置默认图片；也支持访问页面时传入 ?image=https://... */
  defaultImageUrl: import.meta.env.VITE_DEFAULT_IMAGE_URL?.trim() ?? "",

  jpegQuality: 0.94,
};

