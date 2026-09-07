import { useEffect, useRef } from "react";
import { Columns2 } from "lucide-react";
import type { EditorController } from "../editor/EditorController";
import { ActionButton } from "./ActionButton";

export function OriginalPreviewButton({ engine, active, disabled, below = false, className }: {
  engine: EditorController | null; active: boolean; disabled: boolean; below?: boolean; className?: string;
}) {
  const held = useRef<{ pointer: number } | { key: string } | null>(null);
  const release = () => {
    if (!held.current) return;
    held.current = null; engine?.setCompare(false);
  };
  useEffect(() => {
    const pointerUp = (event: PointerEvent) => {
      if (held.current && "pointer" in held.current && held.current.pointer === event.pointerId && event.button === 0 && !(event.buttons & 1)) release();
    };
    const pointerCancel = (event: PointerEvent) => {
      if (held.current && "pointer" in held.current && held.current.pointer === event.pointerId) release();
    };
    const keyUp = (event: KeyboardEvent) => {
      if (held.current && "key" in held.current && held.current.key === event.key) release();
    };
    const visibility = () => { if (document.hidden) release(); };
    window.addEventListener("pointerup", pointerUp, true);
    window.addEventListener("pointercancel", pointerCancel, true);
    window.addEventListener("keyup", keyUp, true);
    window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("pointerup", pointerUp, true);
      window.removeEventListener("pointercancel", pointerCancel, true);
      window.removeEventListener("keyup", keyUp, true);
      window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", visibility);
      release();
    };
  }, [engine]);
  useEffect(() => { if (disabled) release(); }, [disabled]);

  return <ActionButton below={below} className={className} hint={active ? "松开返回编辑" : "按住查看原图"} aria-label="按住查看原图" aria-pressed={active} disabled={disabled}
    onPointerDown={event => {
      if (event.button !== 0 || held.current || active || disabled) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      held.current = { pointer: event.pointerId }; engine?.setCompare(true);
    }}
    onLostPointerCapture={event => { if (held.current && "pointer" in held.current && held.current.pointer === event.pointerId) release(); }}
    onBlur={release}
    onKeyDown={event => {
      if (event.key !== " " && event.key !== "Enter") return;
      event.preventDefault(); event.stopPropagation();
      if (event.repeat || held.current || active || disabled) return;
      held.current = { key: event.key }; engine?.setCompare(true);
    }}
    onKeyUp={event => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); event.stopPropagation(); } }}
    onClick={event => event.preventDefault()}><Columns2 /></ActionButton>;
}
