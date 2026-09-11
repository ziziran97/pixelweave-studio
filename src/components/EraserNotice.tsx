import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { EditorView } from "../types";

/** Feedback floats above the image so transient notices never change canvas size. */
export function EraserNotice({ view, cancelTask, locateProblem, retryImage }: { view: EditorView; cancelTask: () => void; locateProblem?: () => void; retryImage?: () => void }) {
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now);
  const waitingSince = view.task && (view.eraseStage === "waiting" || view.eraseStage === "sample") ? view.eraseStageStartedAt : undefined;
  useEffect(() => {
    if (waitingSince === undefined) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [waitingSince]);
  const elapsed = waitingSince === undefined ? 0 : Math.max(0, Math.floor((now - waitingSince) / 1000));
  const working = !view.ready || view.busy || view.task;
  useEffect(() => {
    if (working || view.noticePresentation !== "transient") return;
    const timer = window.setTimeout(() => setDismissed(view.noticeId), 5000);
    return () => window.clearTimeout(timer);
  }, [view.noticeId, view.noticePresentation, working]);
  if (!working && (view.noticePresentation === "quiet" || dismissed === view.noticeId)) return null;
  return <div className="eraser-notice" role="status" aria-live="polite">
    <span>{view.notice}</span>
    {elapsed >= 10 && <span className="erase-elapsed" aria-live="off">已等待 {elapsed} 秒</span>}
    {locateProblem && <button onClick={locateProblem}>查看问题图层</button>}
    {view.canRetryInitialImage && <button onClick={retryImage}>重新加载图片</button>}
    {view.task && <button title="取消后不采用本次结果；取消等待不代表后台处理已停止" onClick={cancelTask}>取消等待</button>}
    {!working && <button className="dismiss-notice" aria-label="关闭提示" title="关闭提示" onClick={() => setDismissed(view.noticeId)}><X size={14} /></button>}
  </div>;
}
