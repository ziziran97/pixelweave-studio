import { useEffect, useRef } from "react";
import type { EditorView } from "../types";
import type { EditorController } from "../editor/EditorController";

export function SubmissionDialog({ view, engine }: { view: EditorView; engine: EditorController }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="submission-dialog" aria-labelledby="submission-heading" onCancel={event => event.preventDefault()}>
    <h2 id="submission-heading">{view.saved ? "图片已保存" : "正在替换图片"}</h2>
    <p role="status">{view.submissionStage}</p>
    {view.needsConfirmation && <button className="primary-button" onClick={() => void engine.confirmReplacement()}>查询替换结果</button>}
    {view.saved && !view.busy && <button className="primary-button" onClick={() => void engine.returnToReview()}>重新加载审核图片</button>}
  </dialog>;
}
