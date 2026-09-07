import { useEffect, useRef } from "react";
import { X } from "lucide-react";

export function ShortcutHelp({ close }: { close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const dismiss = () => { dialog.current?.close(); close(); };
  return <dialog ref={dialog} className="shortcut-help-dialog" aria-labelledby="shortcut-help-title"
    onCancel={event => { event.preventDefault(); dismiss(); }} onKeyDown={event => event.stopPropagation()} onKeyUp={event => event.stopPropagation()}>
    <div className="confirmation-heading"><h2 id="shortcut-help-title">操作帮助</h2><button className="icon-button" aria-label="关闭操作帮助" onClick={dismiss}><X size={18} /></button></div>
    <dl className="shortcut-list">
      <div><dt>撤销 / 重做</dt><dd><kbd>Ctrl+Z</kbd> / <kbd>Ctrl+Shift+Z</kbd></dd></div>
      <div><dt>删除 / 复制图层</dt><dd><kbd>Delete</kbd> / <kbd>Ctrl+D</kbd></dd></div>
      <div><dt>缩放图片</dt><dd>滚动鼠标滚轮</dd></div>
      <div><dt>临时平移画布</dt><dd>按住空格拖动</dd></div>
      <div><dt>编辑文字 / 换行</dt><dd>双击文字 / <kbd>Enter</kbd></dd></div>
    </dl>
    <p className="field-help">文字输入时，删除和撤销等按键用于编辑文字。绘制矩形选区时，松手前按住空格移动的是选框。</p>
  </dialog>;
}
