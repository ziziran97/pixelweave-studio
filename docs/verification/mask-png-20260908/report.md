# 8-bit 单通道灰度蒙版验证

2026-09-08，本机 Windows、Intel Core Ultra 5 245K、Chromium 152，Vite 生产构建。

实际导出的三组新 PNG 均为 **bit depth 8、color type 0、无 alpha、无 tRNS**。浏览器原生解码与独立 Pillow 解码均确认：尺寸相同，与旧 RGBA 输出逐像素一致，非二值像素和差异像素均为 0。文件体积减少 67.6%～76.0%；完整导出耗时中位数增加 13.6～31.2 ms。测试只涉及本地蒙版编码，未测量服务端预处理耗时或真实接口收益。

## 实现与内存

- `src/editor/mask.ts`：仅调整 `exportMask` 最终阶段；现有选区绘制和叠加规则保持不变。读回 Canvas 像素，立即释放 Canvas，将 RGBA ArrayBuffer 转移至专用 Worker。
- `src/editor/maskEncoder.worker.ts`：复用现有 `binaryPixels`（alpha 覆盖度阈值 128），再原地提取已二值化的红通道。每个目标灰度值只有 0 或 255；没有另建全尺寸灰度缓冲。
- `src/editor/grayPng.ts`：直接封装 PNG 签名、IHDR、IDAT、IEND，使用 filter 0 和浏览器原生 `CompressionStream("deflate")`。按 64 行分批压缩，不创建整幅未压缩扫描线副本；4K 单批扫描线约 240 KiB。没有 RGBA PNG 编码/解码中转，没有新增依赖。
- 二值化、提取、压缩和 CRC 均在 Worker 执行。成功、编码异常、Worker 加载异常及消息异常均通过 `finally` 终止 Worker。缓冲通过 transferable 转移，不复制到 Worker；释放时机仍由浏览器决定。
- 绘制和 Canvas 像素读回仍在主线程。Worker 生产文件为 1.69 kB（未 gzip）；主包相较上次构建约增加 0.27 kB。浏览器需支持模块 Worker 和 CompressionStream。
- 输出仍是 `Blob`；字段 `mask`、文件名 `mask.png`、MIME `image/png`。JPEG、全部 metadata、预览/采用、取消及旧结果隔离流程不变。

格式依据：[W3C PNG 规范](https://www.w3.org/TR/png-3/#11IHDR)、[CompressionStream 文档](https://developer.mozilla.org/en-US/docs/Web/API/CompressionStream)。

## 体积与耗时

每个尺寸使用同一组按比例缩放的固定混合选区：矩形、100 点曲线画笔、多边形、画笔减选、矩形减选及越过图像边缘的多边形。旧路径严格复现改动前的 `getImageData → binaryPixels → putImageData → canvas.toBlob("image/png")`。

每条路径预热 1 次，再交替运行各 5 次，报告中位数。耗时从调用导出函数到获得 Blob，包含绘制、读回、二值化和编码；新路径还包含每次 Worker 创建、加载和销毁等待中的成本。**这不是仅压缩函数的计时**，用于评估用户实际增加的等待时间。两条路径均不计测试中的解码、比对和文件保存时间。

| 尺寸 | 旧 RGBA PNG | 新灰度 PNG | 体积减少 | 旧导出中位数 | 新导出中位数 | 增加 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1024×1024 | 38,075 B | 12,339 B | 67.6% | 7.4 ms | 21.0 ms | 13.6 ms |
| 2048×2048 | 119,120 B | 35,890 B | 69.9% | 26.1 ms | 49.1 ms | 23.0 ms |
| 3840×2160 | 216,665 B | 52,085 B | 76.0% | 50.3 ms | 81.5 ms | 31.2 ms |

另用 4 ms 定时器观察每次导出期间的事件循环间隔。它是响应性的近似观测，不能替代浏览器性能剖析，也不是纯编码 CPU 时间：

| 尺寸 | 旧路径每次最大间隔的中位数 | 新路径每次最大间隔的中位数 | 新路径全部样本最大间隔 |
| --- | ---: | ---: | ---: |
| 1024×1024 | 4.8 ms | 5.5 ms | 5.9 ms |
| 2048×2048 | 17.6 ms | 11.6 ms | 13.0 ms |
| 3840×2160 | 34.8 ms | 23.9 ms | 24.1 ms |

2048 旧路径有一次 283.5 ms 耗时、271.8 ms 定时器间隔的异常样本，已完整保留在原始数据中，没有删除；表中使用中位数降低偶发停顿的影响。不能仅凭这次异常推断原因。该基准只有本机一种浏览器和一类混合选区，不能保证其他设备或选区获得同样收益。

## 正确性和回归

- 实际文件解析：PNG 签名正确，IHDR 的 bit depth=8、color type=0、压缩/过滤/交错方法均为 0；仅存在 IHDR、IDAT、IEND，所有块 CRC 通过独立校验。
- 独立浏览器解码：矩形四边、画笔分段和小数边缘、多边形和越界裁切、混合加选、矩形减选、画笔/多边形减选、减空再加选，均逐像素与旧路径一致。
- 独立 Pillow 解码三组已落盘文件：mode=`L`，与旧文件 R/G/B 各通道逐像素一致，只有 0/255，无透明元数据；旧文件确认是 RGBA，alpha 全 255。
- 空集合、仅减选、完全减空三种情况沿用“当前选区为空，请先添加需要修改的区域”。
- 实际 multipart 检查：`mask.png` 文件头为 8-bit 灰度，尺寸与 JPEG 解码尺寸及 metadata 一致。
- `npm test`：30 项通过，含独立 Node zlib 解压、CRC、逐字节校验和已有接口错误/取消用例。
- `/tests/browser.html`：569 项通过，包括灰度格式检查、JPEG/metadata、选区、错误、取消、晚到结果、尺寸校验、预览和编辑回归。
- `/tests/mask-png.html`：33 项检查通过，另完成 3 个尺寸的性能测试。
- `/tests/eraser-ui.html`：35 项消除笔及结果预览界面检查通过。
- `npm run build` 和 `git diff --check` 通过；构建仍有已有的主包大于 500 kB 提示。

## 复现与产物

启动 `npm run dev` 后打开 `/tests/mask-png.html`，页面自动执行检查和基准，并提供旧/新 PNG 与 JSON 下载。性能比较应使用同一台设备、同一浏览器，尽量减少其他负载；正式性能数字采用生产构建。`?capture=1` 仅供本地验证服务器提供 `/capture/文件名` 接收端时保存文件，普通 Vite 验证无需这个参数。

独立文件校验命令（需 Pillow）：

```sh
python tests/verify-mask-png.py docs/verification/mask-png-20260908
```

- [完整原始性能数据](./benchmark.json)
- [Pillow 校验、文件 SHA-256](./pillow-verification.json)
- 1024×1024：[旧 RGBA](./1024x1024-rgba.png)、[新灰度](./1024x1024-gray.png)
- 2048×2048：[旧 RGBA](./2048x2048-rgba.png)、[新灰度](./2048x2048-gray.png)
- 3840×2160：[旧 RGBA](./3840x2160-rgba.png)、[新灰度](./3840x2160-gray.png)

业务后端地址尚未提供，本次未进行真实消除接口联调，也未测量服务端处理成本。

## 后续取消生命周期修复

`exportMask` 已接入任务 AbortSignal：编码阶段取消、换图、确认关闭或卸载会立即终止 Worker，以取消状态结束导出并清理事件回调。控制器在蒙版导出后再次检查任务有效性，旧任务不继续渲染 JPEG 或发请求。

新增 `tests/mask-cancellation.ts`，通过可控 Worker 将任务停在编码阶段，覆盖已取消信号、取消、连续取消重试、换图、关闭、卸载，以及编码返回与取消同时发生的情况；验证任务资源释放、原图片/选区保留、旧回调隔离和无后续 JPEG/请求。更新后的浏览器契约检查为 604 项通过，消除笔界面检查 35 项通过，单元测试 30 项通过，构建和差异检查通过。

上文性能数据保留为取消修复前的实测记录；本次修复减少取消后的无效计算，未重新测量正常导出耗时。
