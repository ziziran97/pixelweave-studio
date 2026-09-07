import { EditorController } from "../src/editor/EditorController";
import { toBlob } from "../src/editor/assets";
import type { EditorView } from "../src/types";
import { editorConfig } from "../src/config";

// Exercise the production controller through Fabric's DOM mouse listeners, not
// private fields. Read visible state and overlay pixels as independent outcomes.
export async function checkSelectionInteractions(check: (condition: boolean, message: string) => void) {
  const host = document.createElement("div");
  host.style.cssText = "position:relative;width:800px;height:600px";
  const element = document.createElement("canvas"), overlay = document.createElement("canvas");
  overlay.style.cssText = "position:absolute;inset:0;pointer-events:none";
  host.append(element, overlay); document.body.append(host);
  let view: EditorView;
  const editor = new EditorController(element, overlay, host, value => { view = value; });
  const state = () => view;
  const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  const mouse = (type: string, x: number, y: number, options: MouseEventInit = {}) => {
    const bounds = editor.canvas.upperCanvasEl.getBoundingClientRect(), v = editor.canvas.viewportTransform;
    const target = type === "mousedown" ? editor.canvas.upperCanvasEl : document;
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0,
      buttons: type === "mouseup" ? 0 : 1, clientX: bounds.left + x * v[0] + v[4], clientY: bounds.top + y * v[3] + v[5], ...options }));
  };
  const click = (x: number, y: number) => { mouse("mousedown", x, y); mouse("mouseup", x, y); };
  const drag = (x1: number, y1: number, x2: number, y2: number) => { mouse("mousedown", x1, y1); mouse("mousemove", x2, y2); mouse("mouseup", x2, y2); };
  const key = (code: string, value: string, type = "keydown", ctrlKey = false) => window.dispatchEvent(new KeyboardEvent(type, { code, key: value, ctrlKey, bubbles: true, cancelable: true }));
  const at = (x: number, y: number) => {
    const v = editor.canvas.viewportTransform;
    return [...overlay.getContext("2d")!.getImageData(Math.round(x * v[0] + v[4]), Math.round(y * v[3] + v[5]), 1, 1).data].join();
  };
  try {
    const source = document.createElement("canvas"); source.width = 512; source.height = 384;
    const ctx = source.getContext("2d")!; ctx.fillStyle = "#123456"; ctx.fillRect(0, 0, 512, 384);
    await editor.openImage(await toBlob(source), "选区回归测试", false); await frame();
    editor.setEraseMode("lasso");
    click(100, 100); click(110, 100); click(110, 110);
    check(state().lassoPoints === 3, "小范围套索的第二、第三个顶点不会被起点吸附吞掉");
    check(state().canUndo && !state().canRedo, "首个套索草稿即可撤销，草稿期间禁用重做");
    editor.setCompare(true);
    check(!state().compareOriginal && state().lassoPoints === 3, "未闭合套索时拒绝进入初始对比，节点保持");
    const button = document.createElement("button"), label = document.createElement("span");
    button.append(label); host.append(button);
    try {
      for (const [code, value] of [["Enter", "Enter"], ["Space", " "]]) {
        const event = new KeyboardEvent("keydown", { code, key: value, bubbles: true, cancelable: true });
        label.dispatchEvent(event);
        check(!event.defaultPrevented && state().lassoPoints === 3 && !state().hasMask,
          `按钮 ${code} 不被画布拦截，也不闭合套索`);
        key(code, value, "keyup");
      }
    } finally { button.remove(); }
    await editor.undo();
    check(state().lassoPoints === 2 && state().unfinishedSelection, "顶部撤销只移除套索最后一个顶点");
    key("KeyZ", "z", "keydown", true);
    check(state().lassoPoints === 1, "Ctrl+Z 与顶部撤销行为一致");
    click(110, 100); click(110, 110); click(100, 100);
    check(state().hasMask && !state().unfinishedSelection, "小套索点击起点完成闭合");
    editor.setCompare(true);
    check(state().compareOriginal && state().hasMask, "选区完成后可以对比初始，选区保留");
    editor.setCompare(false);
    check(!state().compareOriginal && state().hasMask, "返回编辑后已完成选区保持");
    for (const zoom of [.5, 1, 4]) for (const [width, height] of [[10, 10], [60, 6]]) {
      editor.resetEraseSelection(); editor.zoomTo(zoom);
      const right = 100 + width / zoom, bottom = 100 + height / zoom;
      click(100, 100); click(right, 100); click(right, bottom); click(100, bottom);
      check(state().lassoPoints === 4 && state().unfinishedSelection,
        `${zoom * 100}% 缩放的 ${width}×${height}px 套索第四点可正常添加`);
      click(100 + 1 / zoom, 100 + 1 / zoom); await frame();
      check(state().hasMask && !state().unfinishedSelection,
        `${zoom * 100}% 缩放的小套索仍可点击起点附近闭合`);
    }
    editor.fit();
    editor.resetEraseSelection(); editor.setEraseMode("rect");
    drag(40, 40, 140, 140); editor.setMaskOperation("subtract"); drag(40, 40, 140, 140);
    check(!state().hasMask && state().masks === 2, "添加后完全减去，控制器按最终像素判空");
    await editor.executeErase();
    check(state().notice.includes("选区为空"), "空选区在调用后端前被阻止");
    await editor.undo(); check(state().hasMask, "撤销减选后恢复有效选区");
    await editor.undo(true); check(!state().hasMask, "重做减选后再次判空");
    editor.resetEraseSelection(); editor.setMaskOperation("add");
    mouse("mousedown", 40, 40); mouse("mousemove", 100, 100);
    key("Space", " "); mouse("mousemove", 130, 120); key("Space", " ", "keyup");
    mouse("mousemove", 140, 130); mouse("mouseup", 140, 130); await frame();
    check(at(45, 45) === "18,52,86,255" && at(80, 80) !== "18,52,86,255" && at(135, 125) !== "18,52,86,255", "空格平移框选后可继续调整大小且不会遗留原位置");
    editor.resetEraseSelection();
    mouse("mousedown", 400, 200); mouse("mousemove", 480, 280);
    key("Space", " "); mouse("mousemove", 600, 280); key("Space", " ", "keyup");
    mouse("mousemove", 590, 280); mouse("mouseup", 590, 280); await frame();
    check(at(440, 220) !== "18,52,86,255" && at(505, 220) === "18,52,86,255", "选框移动到图片边缘后松开空格可平滑缩小，无跳变");
    const before = at(450, 230);
    editor.setMaskHidden(true); await frame();
    check(state().maskHidden && at(450, 230) === "18,52,86,255", "查看图片仅隐藏遮罩并显示当前底图");
    window.dispatchEvent(new PointerEvent("pointerup")); await frame();
    check(!state().maskHidden && at(450, 230) === before, "全局松手恢复原遮罩");
    editor.setMaskHidden(true); window.dispatchEvent(new Event("blur"));
    check(!state().maskHidden, "窗口失焦不会遗留隐藏遮罩状态");
    editor.resetEraseSelection(); editor.setEraseMode("freehand");
    mouse("mousedown", 100, 100); mouse("mousemove", 200, 200); mouse("mousemove", 100, 200); mouse("mousemove", 200, 100); await frame();
    check(!state().hasMask && at(150, 120) === "18,52,86,255", "交叉圈选拖动时只显示轮廓，不提前填充");
    mouse("mouseup", 200, 100); await frame();
    check(state().hasMask && at(150, 120) !== "18,52,86,255", "交叉圈选松手自动闭合并填充");
    editor.setEraseMode("brush");
    editor.setBrushSize(1); check(state().brushSize === 4, "笔刷不低于最小尺寸");
    editor.setBrushSize(400); check(state().brushSize === 300, "笔刷不超过最大尺寸");
    editor.setBrushSize(60); mouse("mousedown", 80, 80); editor.setBrushSize(80);
    check(state().brushSize === 60, "正在涂抹的一笔内大小保持固定"); mouse("mouseup", 80, 80);
    editor.setEraseMode("rect"); editor.resetEraseSelection();
    editor.setMaskOperation("subtract"); check(state().maskOperation === "add", "空选区不能进入减去模式");
    mouse("mousedown", 40, 40); mouse("mouseup", 140, 140); await frame();
    check(state().hasMask && at(130, 130) !== "18,52,86,255", "没有移动事件时框选仍使用松手终点");
    editor.setMaskOperation("subtract"); drag(200, 200, 240, 240);
    check(state().masks === 1, "图外无交集减选不增加操作记录");
    await editor.undo(); check(!state().hasMask && state().canRedo, "无效减选不挤占撤销历史");
    await editor.undo(true); check(state().hasMask && state().masks === 1, "顶部重做恢复已完成选区");
    editor.setMaskOperation("subtract"); editor.resetEraseSelection();
    check(state().maskOperation === "add" && state().eraseMode === "rect" && state().brushSize === 60, "重置只清选区并回到添加，工具和大小保留");
    editor.setEraseMode("lasso");
    click(100, 100); click(180, 100);
    editor.setEraseMode("lasso"); editor.setTool("erase"); editor.setMaskOperation("add");
    check(state().lassoPoints === 2, "重复点击当前工具和操作模式不会丢失套索草稿");
    click(180, 180); key("Enter", "Enter");
    click(200, 200); editor.setEraseMode("brush");
    check(state().hasMask && !state().unfinishedSelection && state().notice.includes("取消"), "真正切换工具只取消草稿并提示，完成选区保留");
    editor.resetEraseSelection(); editor.setBrushSize(20);
    mouse("mousedown", 40, 40); mouse("mouseup", 140, 40); await frame();
    check(at(100, 40) !== "18,52,86,255", "快速涂抹补齐松手位置，不漏尾段");
    editor.resetEraseSelection(); editor.setEraseMode("freehand");
    mouse("mousedown", 40, 40); mouse("mousemove", 160, 40); mouse("mouseup", 100, 160); await frame();
    check(state().hasMask && at(100, 80) !== "18,52,86,255", "圈选以松手终点闭合，未提前填充");
    editor.resetEraseSelection(); editor.setEraseMode("brush");
    mouse("mousedown", 40, 40); mouse("mouseup", -30, 40); await frame();
    check(at(2, 40) !== "18,52,86,255", "快速从图内拖到图外松手仍补齐至图片边界");
    editor.resetEraseSelection();
    mouse("mousedown", 40, 40); mouse("mousemove", 80, 40);
    window.dispatchEvent(new PointerEvent("pointerup", { button: 2, buttons: 1 }));
    check(state().unfinishedSelection && state().masks === 0, "其他鼠标键松开不会结束左键选区");
    mouse("mousemove", 120, 40); mouse("mouseup", 140, 40);
    check(!state().unfinishedSelection && state().masks === 1, "对应左键松开后选区只完成一次");
    editor.resetEraseSelection();
    mouse("mousedown", 40, 40); mouse("mousemove", -30, 40); mouse("mousemove", -30, 250); mouse("mousemove", 40, 250); mouse("mouseup", 80, 250); await frame();
    check(at(2, 150) === "18,52,86,255" && at(40, 150) === "18,52,86,255" && at(60, 250) !== "18,52,86,255", "涂抹离图暂停、回图分段，不沿边画线也不跨区连接");
    await editor.undo(); check(!state().hasMask, "出图再进入的分段涂抹仍能一次撤销");
    await editor.undo(true); await frame(); check(at(40, 150) === "18,52,86,255", "重做保留笔画断点");
    mouse("mousedown", 200, 200); window.dispatchEvent(new Event("blur")); mouse("mouseup", 300, 300);
    check(state().masks === 1 && !state().unfinishedSelection, "失焦只取消草稿，迟到松手不会误提交");
    mouse("mousedown", 200, 200); window.dispatchEvent(new PointerEvent("pointercancel")); mouse("mouseup", 300, 300);
    check(state().masks === 1 && !state().unfinishedSelection, "操作取消不影响已完成选区");
    editor.setEraseMode("rect"); mouse("mousedown", 200, 200); mouse("mouseup", 201, 201);
    check(state().notice.includes("放大图片"), "过小选区提示可放大后重选");

    // Capture the frontend request locally; no HTTP call or AI result is produced.
    const originalFetch = window.fetch, originalUrl = editorConfig.eraseApiUrl;
    let submitted: FormData | undefined;
    try {
      editorConfig.eraseApiUrl = "/__selection_contract__";
      window.fetch = async (input, init) => {
        if (input === "/__selection_contract__") { submitted = init?.body as FormData; return new Response(null, { status: 503 }); }
        return originalFetch(input, init);
      };
      await editor.executeErase();
      const bitmap = await createImageBitmap(submitted!.get("mask") as Blob);
      const output = document.createElement("canvas"); output.width = bitmap.width; output.height = bitmap.height;
      const out = output.getContext("2d")!; out.drawImage(bitmap, 0, 0); bitmap.close();
      check(output.width === 512 && output.height === 384 && out.getImageData(40, 150, 1, 1).data[0] === 0 && out.getImageData(60, 250, 1, 1).data[0] === 255,
        "实际提交的原尺寸 Mask 保留笔画断点，不只预览正确");
      editor.resetEraseSelection(); editor.zoomTo(.5); key("Space", " ");
      mouse("mousedown", 200, 150); mouse("mousemove", 240, 180); mouse("mouseup", 240, 180); key("Space", " ", "keyup");
      drag(200, 150, 280, 230); await frame();
      check(at(230, 180) !== "18,52,86,255", "缩放并平移后选区仍跟随图片");
      await editor.executeErase();
      const transformed = await createImageBitmap(submitted!.get("mask") as Blob); out.clearRect(0, 0, 512, 384); out.drawImage(transformed, 0, 0); transformed.close();
      check(out.getImageData(230, 180, 1, 1).data[0] === 255 && out.getImageData(150, 150, 1, 1).data[0] === 0,
        "缩放平移后的提交 Mask 仍使用原图坐标");
      check(state().hasMask && !state().task && !state().pending, "前端请求失败后保留选区且可继续编辑");

      // Verify the actual exported mask as well as the clipped visible overlay.
      const checkBoundaryMask = async (points: Array<[number, number]>, selected: [number, number], clear: [number, number], label: string) => {
        editor.resetEraseSelection(); editor.setEraseMode("freehand");
        mouse("mousedown", ...points[0]);
        for (const point of points.slice(1, -1)) mouse("mousemove", ...point);
        mouse("mouseup", ...points[points.length - 1]); await frame();
        check(state().hasMask && !state().unfinishedSelection && at(...selected) !== "18,52,86,255" && at(...clear) === "18,52,86,255", `${label}：预览正确保留图内区域`);
        await editor.executeErase();
        const result = await createImageBitmap(submitted!.get("mask") as Blob);
        out.clearRect(0, 0, 512, 384); out.drawImage(result, 0, 0); result.close();
        check(out.getImageData(...selected, 1, 1).data[0] === 255 && out.getImageData(...clear, 1, 1).data[0] === 0,
          `${label}：提交 Mask 与预览使用相同裁切路径`);
      };
      await checkBoundaryMask([[100, 100], [300, 100], [300, 450]], [250, 350], [180, 350], "圈选在图片下方松手");
      await editor.undo(); check(!state().hasMask, "图外收尾的圈选可整次撤销");
      await editor.undo(true); await frame(); check(state().hasMask && at(250, 350) !== "18,52,86,255", "重做恢复图外收尾选区");
      await checkBoundaryMask([[100, 100], [600, 100], [600, 450], [100, 300]], [500, 350], [100, 350], "圈选跨过右下角再回图内");
      editor.setMaskOperation("subtract");
      mouse("mousedown", 100, 100); mouse("mousemove", 600, 100); mouse("mousemove", 600, 450); mouse("mouseup", 100, 300);
      check(!state().hasMask && state().maskOperation === "add", "图外轨迹的同形减选能完全减空");
      await editor.undo(); check(state().hasMask, "撤销图外轨迹减选恢复选区");
      editor.resetEraseSelection();
      mouse("mousedown", 0, 100); mouse("mousemove", -200, 100); mouse("mousemove", -200, 200); mouse("mouseup", 0, 200);
      check(!state().hasMask && state().masks === 0, "仅在图外有面积的圈选不会成为有效选区");
      mouse("mousedown", 100, 100); mouse("mousemove", 300, 100); mouse("mousemove", 600, 450);
      window.dispatchEvent(new Event("blur")); mouse("mouseup", 300, 450);
      check(!state().unfinishedSelection && !state().hasMask, "图外拖动失焦后取消草稿，迟到松手不提交");
    } finally { window.fetch = originalFetch; editorConfig.eraseApiUrl = originalUrl; }

    // Fixture image only: validates adoption/history, not AI generation quality.
    await editor.openImage(await toBlob(source), "采用与历史检查", false);
    editor.setTool("rect"); drag(250, 200, 300, 250);
    const shapeId = state().selectedId!;
    editor.setEraseMode("brush"); editor.setBrushSize(64);
    drag(60, 60, 120, 60);
    const objects = editor.canvas.getObjects();
    await editor.undo();
    check(!state().hasMask && editor.canvas.getObjects().every((object, i) => object === objects[i]),
      "仅撤销选区时复用底图和图形对象，不重新解码或重建");
    await editor.undo(true);
    check(state().hasMask && editor.canvas.getObjects().every((object, i) => object === objects[i]),
      "重做选区保持相同对象和有效像素");
    editor.setAdjustments({ ...state().adjustments, brightness: 20 }, true);
    await editor.undo();
    check(state().adjustments.brightness === 0 && state().hasMask && editor.canvas.getObjects()[0] !== objects[0],
      "跨过调色历史时完整恢复文档并保留选区");
    await editor.undo(true);
    check(state().adjustments.brightness === 20, "完整恢复后仍能重做调色");
    const previousFetch = window.fetch, previousUrl = editorConfig.eraseApiUrl;
    try {
      editorConfig.eraseApiUrl = "/__adoption_contract__";
      const fixture = await toBlob(source);
      window.fetch = async (input, init) => input === "/__adoption_contract__"
        ? new Response(fixture, { headers: { "content-type": "image/png" } }) : previousFetch(input, init);
      await editor.executeErase();
      check(!!state().pending && state().hasMask, "测试图片返回后等待采用，选区保持");
      editor.discardResult();
      check(!state().pending && state().hasMask && state().tool === "erase", "放弃结果后可继续调整同一轮选区");
      await editor.executeErase(); await editor.acceptResult();
      check(state().tool === "erase" && state().eraseMode === "brush" && state().brushSize === 64 &&
        !state().hasMask && state().maskOperation === "add" && !state().pending,
        "采用消除结果后停留在消除笔，保留工具和设置并清空本轮选区");
      check(state().adjustments.brightness === 0 && state().layers.some(layer => layer.id === shapeId),
        "采用结果重置已烘焙调色并保留独立图形对象");
      await editor.undo();
      check(state().hasMask && state().adjustments.brightness === 20, "撤销采用恢复选区及调色，不误用选区快速路径");
      editor.selectLayer(shapeId);
      check(state().selectedId === shapeId && state().selectedPurpose === "content", "完整文档恢复后图形仍可选中编辑");
      editor.setTool("erase"); await editor.undo(true);
      check(!state().hasMask && state().adjustments.brightness === 0, "重做采用恢复已采用图片状态");
      drag(160, 60, 220, 60);
      check(state().hasMask && state().canUndo && !state().canRedo, "采用后可直接开启下一轮消除选区");
    } finally { window.fetch = previousFetch; editorConfig.eraseApiUrl = previousUrl; }

    source.width = 4096; source.height = 2160; ctx.fillStyle = "#123456"; ctx.fillRect(0, 0, source.width, source.height);
    await editor.openImage(await toBlob(source), "4K 选区响应检查", false); editor.setEraseMode("rect"); await frame();
    const updates: number[] = [], undoTimes: number[] = [];
    for (let i = 0; i < 20; i++) {
      const x = 400 + i * 100, start = performance.now(); drag(x, 400, x + 90, 600); updates.push(performance.now() - start); await frame();
    }
    editor.setMaskOperation("subtract");
    for (let i = 0; i < 10; i++) {
      const x = 400 + i * 100, start = performance.now(); drag(x, 400, x + 90, 600); updates.push(performance.now() - start); await frame();
    }
    for (let i = 0; i < 5; i++) { const start = performance.now(); await editor.undo(); undoTimes.push(performance.now() - start); await frame(); }
    const maximum = (values: number[]) => Math.round(Math.max(...values));
    check(state().masks === 25 && state().hasMask,
      `4K 连续 20 次添加、10 次减选、5 次撤销正确；本次操作耗时最大 ${maximum(updates)}ms，撤销最大 ${maximum(undoTimes)}ms（不含屏幕刷新）`);
  } finally { editor.dispose(); host.remove(); }
}
