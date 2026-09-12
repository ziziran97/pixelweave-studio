import { useEffect, useRef } from "react";
import { X } from "lucide-react";

export function ShortcutHelp({ close }: { close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const dismiss = () => { dialog.current?.close(); close(); };
  return <dialog ref={dialog} className="shortcut-help-dialog" aria-labelledby="shortcut-help-title"
    onCancel={event => { event.preventDefault(); dismiss(); }} onKeyDown={event => event.stopPropagation()} onKeyUp={event => event.stopPropagation()}>
    <div className="confirmation-heading"><h2 id="shortcut-help-title">操作帮助</h2><button className="icon-button" aria-label="关闭操作帮助" onClick={dismiss}><X size={18} /></button></div>
    <div className="shortcut-help-content">
      <div className="shortcut-columns">
        <section aria-labelledby="shortcut-general-title">
          <h3 id="shortcut-general-title">通用与图层</h3>
          <dl className="shortcut-list">
            <div><dt>撤销</dt><dd><kbd>Ctrl+Z</kbd></dd></div>
            <div><dt>重做</dt><dd><kbd>Ctrl+Shift+Z</kbd> / <kbd>Ctrl+Y</kbd></dd></div>
            <div><dt>删除图层</dt><dd><kbd>Delete</kbd> / <kbd>Backspace</kbd></dd></div>
            <div><dt>创建图层副本</dt><dd><kbd>Ctrl+D</kbd></dd></div>
            <div><dt>复制 / 粘贴图层</dt><dd><kbd>Ctrl+C</kbd> / <kbd>Ctrl+V</kbd></dd></div>
            <div><dt>图层快捷菜单</dt><dd>选中后右键 / <kbd>Ctrl+Shift+X</kbd></dd></div>
            <div><dt>消除笔 / 绘制 / 选择 / 平移</dt><dd><kbd>E</kbd> / <kbd>D</kbd> / <kbd>V</kbd> / <kbd>H</kbd></dd></div>
            <div><dt>多选图层</dt><dd>画布框选 / <kbd>Shift</kbd> 或 <kbd>Ctrl</kbd>＋点击</dd></div>
            <div><dt>全选可编辑图层</dt><dd>选择时 <kbd>Ctrl+A</kbd></dd></div>
            <div><dt>上移 / 下移一层</dt><dd>单选时 <kbd>Ctrl+↑</kbd> / <kbd>Ctrl+↓</kbd></dd></div>
            <div><dt>置顶 / 置底</dt><dd>单选时 <kbd>Ctrl+Shift+↑</kbd> / <kbd>Ctrl+Shift+↓</kbd></dd></div>
            <div><dt>微调图层（图片像素）</dt><dd>方向键 1 px / <kbd>Shift</kbd>＋方向键 10 px</dd></div>
          </dl>
        </section>
        <section aria-labelledby="shortcut-edit-title">
          <h3 id="shortcut-edit-title">绘制、编辑与查看</h3>
          <dl className="shortcut-list">
            <div><dt>编辑文字 / 换行</dt><dd>双击文字 / <kbd>Enter</kbd></dd></div>
            <div><dt>画笔画直线</dt><dd>绘制时按住 <kbd>Shift</kbd></dd></div>
            <div><dt>画正方形 / 圆形</dt><dd>绘制矩形 / 椭圆时按住 <kbd>Shift</kbd></dd></div>
            <div><dt>移动矩形选区框</dt><dd>未松手时，按住空格拖动</dd></div>
            <div><dt>闭合套索（至少三点）</dt><dd>点击起点 / <kbd>Enter</kbd></dd></div>
            <div><dt>开始消除（选区已完成）</dt><dd><kbd>Ctrl+Enter</kbd></dd></div>
            <div><dt>添加／减去选区</dt><dd>消除笔中 <kbd>X</kbd></dd></div>
            <div><dt>套索撤销点（未闭合）</dt><dd><kbd>Backspace</kbd> / <kbd>Delete</kbd> / <kbd>Ctrl+Z</kbd></dd></div>
            <div><dt>取消未完成绘制</dt><dd><kbd>Esc</kbd></dd></div>
            <div><dt>数值输入</dt><dd><kbd>Enter</kbd> 保留 / <kbd>Esc</kbd> 还原本轮</dd></div>
            <div><dt>退出图片取色</dt><dd><kbd>Esc</kbd></dd></div>
            <div><dt>关闭编辑（画布空闲）</dt><dd><kbd>Esc</kbd>，有草稿时先确认</dd></div>
            <div><dt>缩放图片</dt><dd>鼠标滚轮</dd></div>
            <div><dt>完整显示图片并居中</dt><dd><kbd>F</kbd></dd></div>
            <div><dt>100% 查看图片细节</dt><dd><kbd>1</kbd></dd></div>
            <div><dt>定位本次消除区域</dt><dd>结果预览中 <kbd>R</kbd></dd></div>
            <div><dt>查看初始原图</dt><dd>按住 <kbd>C</kbd>，松开返回</dd></div>
            <div><dt>临时平移画布</dt><dd>按住空格拖动</dd></div>
          </dl>
        </section>
      </div>
      <div className="shortcut-help-notes">
        <p className="field-help">输入文字、数值或操作菜单时，按键用于当前区域；E／D／V／H、F／1／C／X 及 Ctrl+Enter 不触发画布操作。</p>
        <p className="field-help">F／1 也可用于消除结果预览，只调整弹窗内图片。C 始终查看进入编辑时的原图，不等同于隐藏选区或查看调色前。</p>
        <p className="field-help">画布和图层列表均可按住 Shift／Ctrl 点击增减选择；复制支持多选。Mac 可用 ⌘ Command 代替 Ctrl。</p>
      </div>
    </div>
  </dialog>;
}
