import { Textbox, controlsUtils } from "fabric";
import type { ControlCursorCallback } from "fabric";

const cornerDirections = ["e", "se", "s", "sw", "w", "nw", "n", "ne"];

export const cornerScaleCursor: ControlCursorCallback = (event, control, object, coord) => {
  if (object.editorLocked || (object instanceof Textbox && (object.isEditing || object.lockScalingX || object.lockScalingY)) ||
    controlsUtils.scaleCursorStyleHandler(event, control, object, coord) === "not-allowed") return "not-allowed";
  // Corner orientation stays independent of the object's width-to-height ratio.
  const angle = object.getTotalAngle() + Math.atan2(control.y, control.x) * 180 / Math.PI;
  return `${cornerDirections[(Math.round(angle / 45) % 8 + 8) % 8]}-resize`;
};
