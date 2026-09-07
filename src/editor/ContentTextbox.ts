import { Textbox, classRegistry } from "fabric";

/** One text object, including its opaque padded background, in canvas and final render. */
export class ContentTextbox extends Textbox {
  static type = "ContentTextbox";
  static createControls() {
    const { controls } = Textbox.createControls();
    return { controls: { ml: controls.ml, mr: controls.mr, mtr: controls.mtr } };
  }
  _renderBackground(ctx: CanvasRenderingContext2D) {
    if (!this.editorTextBackground) return;
    const padding = this.editorTextPadding ?? 10;
    const width = this.width + padding * 2, height = this.height + padding * 2;
    const radius = Math.min(this.editorTextRadius ?? 0, width / 2, height / 2);
    ctx.save();
    ctx.shadowColor = "transparent";
    ctx.fillStyle = this.editorTextBackgroundColor ?? "#ffffff";
    ctx.beginPath(); ctx.roundRect(-width / 2, -height / 2, width, height, radius); ctx.fill();
    ctx.restore();
  }
  shouldCache() { this.ownCaching = false; return false; }
}
classRegistry.setClass(ContentTextbox);
