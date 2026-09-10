# 消除结果固定示意素材

用于“检查消除结果”弹窗的固定样例演示。使用内置 imagegen 先生成含橙色标签的商品图，再以该图为输入生成移除标签的对照图；未调用本项目的真实消除服务。

界面明确标识固定样图及未调用消除服务。这组图片用于演示对比、同步缩放、拖动、区域定位，以及受限于默认样图和预设标签区域的完整消除流程，不作为算法效果或区域外像素保持的验收样本，也不计入真实消除统计。

- [消除前示意图](./before-2910x1800.png)：陶瓷杯旁有橙色标签，也用作独立预览的默认底图。
- [消除后示意图](./after-2910x1800.png)：移除橙色标签。
- 当前两图均为 **2910 × 1800 px**，由 970 × 600 版本等比放大 3 倍，保持相同构图、杯子及标签位置。
- [sample.json](./sample.json) 记录文件名、尺寸及区域位置；区域是用于视图定位的示例外框，不是真实消除请求的 Mask。

保留 1536 × 1024 px 原始素材 [before.png](./before.png) 和 [after.png](./after.png)，以及 [970 × 600 消除前](./before-970x600.png)、[970 × 600 消除后](./after-970x600.png) 版本。970 × 600 版本从两张原图统一裁取左上角 `(300, 200)`、大小 `1164 × 720` 的区域后等比缩小；当前 2910 × 1800 版本以这两张 970 × 600 图片为输入，使用高质量双三次插值精确放大 3 倍，输出 RGB PNG，无新增裁剪或重新生成内容。放大改变像素尺寸，不代表获得新的真实细节。区域的坐标及宽高均乘以 3，更新为 `(1899, 1374, 891, 351)`。

已接入独立演示页面消除笔面板的“查看消除结果示例”，通过受开发／演示构建条件保护的模块按需加载。独立预览未指定图片时，默认底图复用消除前图片；宿主图片及明确配置的图片仍然优先。普通正式构建不包含入口、演示模块或这两张样图，也不使用演示默认底图；真实宿主不显示示例。正式 ERP 接入请使用普通构建，不要将本目录复制到 `public/`、ERP 静态资源或部署目录。真实消除的结果弹窗仍须保留。

未配置消除接口、当前仍为未调色的默认样图时，“选择示例标签区域”设置上述固定区域，再由用户点击“开始消除”体验模拟等待及使用／放弃。使用后以预置消除后图更新当前草稿，新增内容保持独立，可撤销或继续替换演示；上传、明确指定图片、调色后的底图及任意改动的选区不套用此结果。取消、失败及迟到响应沿用现有恢复规则；真实接口失败不回退模拟。独立“查看消除结果示例”仍只查看和关闭。正式构建须同时排除 `src/editor/previewErase.ts` 及其演示分支，完整约定见项目 README。

## 生成提示词

原始素材生成方式：内置 imagegen；第二张以第一张为编辑输入。以下为原始素材的提示词；970 × 600 和 2910 × 1800 版本采用上述精确裁剪与缩放。

### 消除前

```text
Use case: product-mockup. Asset type: the BEFORE image of an explicitly illustrative object-removal demo in a product-image review editor. Create ONE landscape image at exactly 1536 x 1024 pixels, full-bleed photography, no panels or split screen. Scene: a single unbranded ivory-white ceramic mug with a rounded handle on its right, standing on a matte light warm-gray tabletop against a softly lit pale beige studio backdrop. High quality, natural ceramic texture, soft daylight and gentle shadows. Composition: whole mug unobstructed, roughly centered slightly left; mug and handle occupy about x=460 to 1010 and y=220 to 740. Place one small bright orange rectangular paper tag lying flat on the tabletop in the lower-right open area, well separated from the mug, about x=1120 to 1310 and y=780 to 865. The tag is the only unwanted object, entirely blank with no writing, with a subtle contact shadow. This will later be removed in a second image, so use a simple continuous tabletop around it. No other props, no plant, no utensils, no logos, no watermark, no captions, no printed text anywhere. Neutral realistic photographic style, visually clean and easy to compare. Do not label this as a real algorithm output.
```

### 消除后

```text
Use case: precise-object-edit. Asset type: the AFTER image of a clearly illustrative object-removal demo, paired with the supplied BEFORE image. Input image 1 is the edit target. Remove ONLY the orange rectangular paper tag lying on the tabletop in the lower-right, together with its narrow contact shadow, approximately within x=1060..1415, y=750..890 on this 1536 x 1024 image. Fill that small area with seamlessly continuous warm-gray tabletop texture and lighting. Preserve every other part of the supplied image as faithfully as possible: the ivory ceramic mug, its exact position, shape, handle, glaze, highlights, edges and shadow; the tabletop and background; perspective, crop, exposure, color and texture. Keep the exact same 1536 x 1024 pixel canvas, no shifting, no zooming, no recropping, no new props, no text or watermark. Return ONE image only, not a comparison sheet. This is a generated illustration of the interaction, not a measured output of the user's eraser service.
```
