import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpToLine, ChevronRight, Clipboard, Copy, CopyPlus, EyeOff, Layers3, Lock, Trash2 } from "lucide-react";
import type { EditorView } from "../types";
import type { EditorController } from "../editor/EditorController";

export type LayerMenuPosition = { x: number; y: number; ids: string[]; origin: HTMLElement };
const menuButtons = (menu: HTMLElement) => [...menu.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]')]
  .filter(button => button.closest('[role="menu"]') === menu && !button.disabled);

export function LayerContextMenu({ position, view, engine, close }: {
  position: LayerMenuPosition; view: EditorView; engine: EditorController; close: (restoreFocus?: boolean) => void;
}) {
  const menu = useRef<HTMLDivElement>(null), submenu = useRef<HTMLDivElement>(null), orderButton = useRef<HTMLButtonElement>(null);
  const [point, setPoint] = useState({ left: position.x, top: position.y });
  const [orderOpen, setOrderOpen] = useState(false), [orderPoint, setOrderPoint] = useState({ left: 0, top: 0 });
  const focusOrder = useRef(false), closeRef = useRef(close); closeRef.current = close;
  const single = position.ids.length === 1;
  const content = view.layers.filter(layer => layer.purpose === "content");
  const index = content.findIndex(layer => layer.id === position.ids[0]);
  const canUp = single && index > 0, canDown = single && index >= 0 && index < content.length - 1;
  const run = (action: () => void) => {
    const ids = engine.contextSelectionAt();
    close();
    if (ids && ids.length === position.ids.length && ids.every(id => position.ids.includes(id))) action();
  };
  const openOrder = (focus = false) => { focusOrder.current = focus; setOrderOpen(true); };
  const closeOrder = () => { setOrderOpen(false); orderButton.current?.focus({ preventScroll: true }); };
  useLayoutEffect(() => {
    const bounds = menu.current!.getBoundingClientRect();
    setPoint({ left: Math.max(8, Math.min(position.x, window.innerWidth - bounds.width - 8)),
      top: Math.max(8, Math.min(position.y, window.innerHeight - bounds.height - 8)) });
    menuButtons(menu.current!)[0]?.focus({ preventScroll: true });
  }, [position]);
  useLayoutEffect(() => {
    if (!orderOpen || !submenu.current || !orderButton.current) return;
    const parent = menu.current!.getBoundingClientRect(), row = orderButton.current.getBoundingClientRect(), bounds = submenu.current.getBoundingClientRect();
    setOrderPoint({ left: Math.max(8, parent.right + bounds.width + 4 <= window.innerWidth - 8 ? parent.right + 4 : parent.left - bounds.width - 4),
      top: Math.max(8, Math.min(row.top, window.innerHeight - bounds.height - 8)) });
    if (focusOrder.current) menuButtons(submenu.current)[0]?.focus({ preventScroll: true });
  }, [orderOpen]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (menu.current?.contains(event.target as Node)) return;
      // Closing the menu is one action; that same click must not transform the canvas.
      event.preventDefault(); event.stopPropagation(); closeRef.current();
    };
    const moved = (event: Event) => { if (!menu.current?.contains(event.target as Node)) closeRef.current(false); };
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", moved); window.addEventListener("scroll", moved, true); window.addEventListener("blur", moved);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("resize", moved); window.removeEventListener("scroll", moved, true); window.removeEventListener("blur", moved);
    };
  }, []);
  const action = (label: string, Icon: typeof Copy, execute: () => void, shortcut?: string, disabled = false, danger = false) =>
    <button type="button" role="menuitem" tabIndex={-1} disabled={disabled} aria-label={label} className={danger ? "menu-danger" : undefined}
      onMouseEnter={() => setOrderOpen(false)} onClick={() => run(execute)}>
      <Icon size={16} /><span>{label}</span>{shortcut && <kbd>{shortcut}</kbd>}
    </button>;
  return createPortal(<div ref={menu} role="menu" aria-label={single ? "图层快捷操作" : `所选 ${position.ids.length} 个图层的快捷操作`}
    className="layer-context-menu" style={point} onContextMenu={event => event.preventDefault()}
    onKeyUp={event => event.stopPropagation()} onKeyDown={event => {
      event.stopPropagation();
      const target = event.target as HTMLElement, currentMenu = target.closest<HTMLElement>('[role="menu"]')!;
      const child = currentMenu === submenu.current;
      if (event.key === "Escape") { event.preventDefault(); child ? closeOrder() : close(); }
      else if (event.key === "Tab") { event.preventDefault(); close(); }
      else if (event.key === "ArrowLeft" && child) { event.preventDefault(); closeOrder(); }
      else if (event.key === "ArrowRight" && target === orderButton.current && single) { event.preventDefault(); openOrder(true); }
      else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault(); const items = menuButtons(currentMenu), index = items.indexOf(target as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items[next]?.focus({ preventScroll: true });
      } else if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey) {
        const key = event.key.toLowerCase();
        if (key === "c" && single) { event.preventDefault(); run(() => engine.copySelected()); }
        else if (key === "v" && view.canPasteLayer) { event.preventDefault(); run(() => void engine.pasteLayer()); }
        else if (key === "d" && single) { event.preventDefault(); run(() => void engine.duplicateSelected()); }
      } else if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); run(() => engine.deleteSelected()); }
    }}>
    {action("复制", Copy, () => engine.copySelected(), "Ctrl+C", !single)}
    {action("粘贴", Clipboard, () => void engine.pasteLayer(), "Ctrl+V", !view.canPasteLayer)}
    {action("创建副本", CopyPlus, () => void engine.duplicateSelected(), "Ctrl+D", !single)}
    <div role="separator" />
    <button ref={orderButton} type="button" role="menuitem" tabIndex={-1} aria-label="调整层级" aria-haspopup="menu" aria-expanded={orderOpen}
      disabled={!single || (!canUp && !canDown)} onMouseEnter={() => { if (single && (canUp || canDown)) openOrder(); }} onClick={() => openOrder(true)}>
      <Layers3 size={16} /><span>调整层级</span><ChevronRight size={15} />
    </button>
    {action("隐藏图层", EyeOff, () => engine.updateLayer(position.ids[0], { visible: false }), undefined, !single)}
    {action("锁定图层", Lock, () => engine.updateLayer(position.ids[0], { locked: true }), undefined, !single)}
    <div role="separator" />
    {action(single ? "删除图层" : `删除所选 ${position.ids.length} 个图层`, Trash2, () => engine.deleteSelected(), "Delete", false, true)}
    {orderOpen && <div ref={submenu} role="menu" aria-label="调整图层层级" className="layer-context-menu layer-order-submenu" style={orderPoint}>
      {([
        ["top", "置顶", ArrowUpToLine, canUp], ["up", "上移一层", ArrowUp, canUp],
        ["down", "下移一层", ArrowDown, canDown], ["bottom", "置底", ArrowDownToLine, canDown],
      ] as const).map(([direction, label, Icon, enabled]) => <button key={direction} type="button" role="menuitem" aria-label={label} tabIndex={-1} disabled={!enabled}
        onClick={() => run(() => engine.moveLayer(position.ids[0], direction))}><Icon size={16} /><span>{label}</span></button>)}
    </div>}
  </div>, document.body);
}
