// Match the per-file limit in server/lamaProxy.mjs; the UI labels it as 25MB.
export const MAX_IMAGE_FILE_BYTES = 25 * 1024 * 1024;

export class ImageFileSizeError extends Error {}

export function checkImageFileSize(file: Blob, message = "图片不能超过 25MB，请压缩后重新上传") {
  if (file.size > MAX_IMAGE_FILE_BYTES) throw new ImageFileSizeError(message);
}

export function checkEraseFileSizes(image: Blob, mask: Blob) {
  checkImageFileSize(image, "当前消除图片超过 25MB，请缩小图片后重试");
  checkImageFileSize(mask, "消除选区数据超过 25MB，请缩小图片后重新选择区域");
}
