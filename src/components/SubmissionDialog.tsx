import { useEffect, useRef, useState } from "react";
import { Check, CircleAlert, CircleCheck, CircleHelp, LoaderCircle } from "lucide-react";
import type { EditorView } from "../types";
import type { EditorController } from "../editor/EditorController";
import { submissionSteps } from "../editor/submissionProgress";

export function SubmissionDialog({ view, engine, previewOnly = false }: { view: EditorView; engine: EditorController; previewOnly?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null), heading = useRef<HTMLHeadingElement>(null), action = useRef<HTMLButtonElement>(null);
  const progress = view.submissionProgress, status = progress?.status;
  const complete = status === "preview_complete", unknown = status === "unknown", querying = status === "querying";
  const reviewFailed = status === "review_failed";
  const waiting = !!progress && (status === "processing" || querying);
  const [now, setNow] = useState(Date.now);
  const seconds = progress ? Math.max(0, Math.floor((now - progress.waitStartedAt) / 1000)) : 0;
  useEffect(() => { ref.current?.showModal(); heading.current?.focus(); }, []);
  useEffect(() => {
    if (!waiting) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [waiting, progress?.waitStartedAt]);
  useEffect(() => {
    if (unknown || reviewFailed || complete) action.current?.focus();
    else if (querying || status === "processing") heading.current?.focus();
  }, [unknown, querying, reviewFailed, complete, status]);
  const title = complete ? "演示完成" : unknown ? "替换结果待确认" : querying ? "正在查询替换结果" :
    view.saved ? "图片已保存" : previewOnly ? view.previewScenario === "texts" ? "正在检测文案" : "替换流程演示" : "正在替换图片";
  const Icon = complete ? CircleCheck : unknown ? CircleHelp : reviewFailed ? CircleAlert : LoaderCircle;
  const steps = progress && !unknown && !querying && !complete && !(previewOnly && view.previewScenario === "texts") ? submissionSteps(progress) : [];
  const hint = previewOnly ? "所有阶段均为模拟，不会保存或替换任务图片，编辑草稿会保留。" :
    unknown || querying ? "查询仅确认本次结果，不会再次提交图片。" :
    view.saved ? "只更新审核页面，不会重复保存图片。" : "编辑内容已保留，处理完成后自动返回审核。";
  return <dialog ref={ref} className="submission-dialog" aria-labelledby="submission-heading" aria-describedby="submission-detail submission-hint"
    onKeyDown={event => event.stopPropagation()} onKeyUp={event => event.stopPropagation()} onCancel={event => event.preventDefault()}>
    {previewOnly && <p className="submission-demo">演示 · 未保存到任务</p>}
    <h2 ref={heading} tabIndex={-1} id="submission-heading">{title}</h2>
    {!!steps.length && <ol className="submission-steps" aria-label="替换处理步骤">{steps.map((step, index) =>
      <li key={step.id} className={`is-${step.status}`} data-step={step.id} data-status={step.status}
        aria-current={step.status === "active" ? "step" : undefined} aria-label={`${step.label}，${({ done: "已完成", skipped: "无需检查", active: "进行中", waiting: "尚未开始", failed: "需要重试" })[step.status]}`}>
        <span className="submission-step-dot">{step.status === "done" ? <Check size={14} /> : step.status === "failed" ? "!" : step.status === "skipped" ? "–" : index + 1}</span>
        <span>{step.label}</span>{step.status === "skipped" && <small>无需检查</small>}
      </li>)}</ol>}
    <p className={`submission-detail${reviewFailed ? " has-error" : ""}`} id="submission-detail" role="status"><Icon size={18} className={waiting ? "submission-spinner" : ""} aria-hidden="true" /><span>{view.submissionStage}</span></p>
    {waiting && seconds >= 10 && <p className="submission-elapsed" aria-live="off">已等待 {seconds} 秒</p>}
    <p className="submission-hint" id="submission-hint">{hint}</p>
    {view.needsConfirmation && <button ref={action} className="primary-button" onClick={() => void engine.confirmReplacement()}>查询替换结果</button>}
    {reviewFailed && !view.busy && <button ref={action} className="primary-button" onClick={() => void engine.returnToReview()}>重新加载审核图片</button>}
    {complete && <button ref={action} className="primary-button" onClick={() => engine.finishPreviewSubmission()}>返回编辑</button>}
  </dialog>;
}
