import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { EditorView } from "../types";

/** Eraser-only feedback floats above the image so it never changes canvas size. */
export function EraserNotice({ view, cancelTask }: { view: EditorView; cancelTask: () => void }) {
  const [dismissed, setDismissed] = useState<number | null>(null);
  const working = !view.ready || view.busy || view.task;
  useEffect(() => {
    if (working || view.noticePresentation !== "transient") return;
    const timer = window.setTimeout(() => setDismissed(view.noticeId), 5000);
    return () => window.clearTimeout(timer);
  }, [view.noticeId, view.noticePresentation, working]);
  if (!working && (view.noticePresentation === "quiet" || dismissed === view.noticeId)) return null;
  return <div className="eraser-notice" role="status" aria-live="polite">
    <span>{view.notice}</span>
    {view.task && <button onClick={cancelTask}>取消等待</button>}
    {!working && <button className="dismiss-notice" aria-label="关闭提示" title="关闭提示" onClick={() => setDismissed(view.noticeId)}><X size={14} /></button>}
  </div>;
}
