import { FabricObject, Textbox, util } from "fabric";
import { createEditor } from "./editing-tools";

export async function checkRotation(check: (value: boolean, message: string) => void) {
  for (const [kind, label] of [["text", "文字"], ["draw", "画笔"], ["rect", "矩形"], ["circle", "椭圆"]] as const) {
    const report = (value: boolean, message: string) => check(value, `${label}：${message}`);
    const { editor, state, mouse, drag, dispose } = createEditor();
    const active = () => editor.canvas.getActiveObject() as FabricObject;
    // Synthetic MouseEvent coordinates may be rounded to screen pixels. Snaps
    // must be exact; a free angle allows only the corresponding pointer error.
    const near = (a: number, b: number) => Math.abs(a - b) < (b % 90 === 0 ? .001 : 1.5);
    const rotate = (angles: number[], expected: number) => {
      const object = active(), before = object.getCenterPoint();
      object.setCoords();
      const handle = util.transformPoint(object.oCoords.mtr, util.invertTransform(editor.canvas.viewportTransform));
      const start = Math.atan2(handle.y - before.y, handle.x - before.x), originalAngle = object.angle;
      const radius = handle.distanceFrom(before);
      mouse("mousedown", handle.x, handle.y);
      let x = handle.x, y = handle.y;
      for (const angle of angles) {
        const radians = start + (angle - originalAngle) * Math.PI / 180;
        x = before.x + Math.cos(radians) * radius; y = before.y + Math.sin(radians) * radius;
        mouse("mousemove", x, y);
      }
      const preview = near(object.angle, expected);
      mouse("mouseup", x, y);
      const matched = preview && near(object.angle, expected) && before.distanceFrom(object.getCenterPoint()) < .001;
      if (!matched) throw new Error(`${label}旋转到${angles.join("→")}：预览匹配=${preview}，结果=${object.angle}，预期=${expected}，中心偏移=${before.distanceFrom(object.getCenterPoint())}`);
      return matched;
    };
    try {
      await editor.initialize(); editor.setTool(kind);
      if (kind === "text") { await editor.addText({ x: 150, y: 150 }); (active() as Textbox).exitEditing(); }
      else { drag(150, 150, 270, 210); editor.selectLayer(editor.canvas.getObjects().at(-1)!.editorId!); }
      report(rotate([88], 90) && (kind !== "text" || state().textVertical === true), "拖动旋转接近90度时精确吸附，预览与松手一致");
      report(rotate([93], 90) && rotate([97], 97) && (kind !== "text" || !state().textVertical), "直角两侧均可吸附，拖出5度范围恢复自由旋转");
      report(rotate([178], 180) && rotate([272], 270), "180度与270度同样吸附，对象中心不漂移");
      report(rotate([358], 0) && rotate([2], 0), "跨越360度与零度两侧均正确吸附为零度");
      report(rotate([37], 37), "非直角附近保留原有自由旋转");
      report(rotate([84, 92, 88], 90), "连续旋转过程中实时吸附，松手保留最终角度");
      await editor.undo(); report(near(active().angle, 37), "一次撤销整个连续旋转，恢复原自由角度");
      await editor.undo(true); report(near(active().angle, 90) && rotate([183], 180), "重做恢复角度后继续拖动仍能吸附");
      await editor.duplicateSelected();
      report(near(active().angle, 180) && rotate([267], 270), "复制保留角度，复制对象继续拖动仍能吸附");
    } finally { dispose(); }
  }
}
