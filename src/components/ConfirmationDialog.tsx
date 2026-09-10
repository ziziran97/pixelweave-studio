import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { ConfirmationKind, EditorConfirmation } from "../types";

export const CONFIRMATION_COPY: Record<ConfirmationKind, { title: string; message: string; cancel: string; accept: string }> = {
  replace: { title: "确认替换图片？", message: "将使用当前编辑结果替换任务中的图片。替换后无法恢复，请确认图片内容无误。", cancel: "返回编辑", accept: "确认替换" },
  reset: { title: "确认还原初始图片？", message: "将清除当前修改，恢复进入编辑时的图片。还原后可通过撤销恢复。", cancel: "取消", accept: "确认还原" },
  upload: { title: "确认载入新图片？", message: "当前未保存的编辑内容和待采用结果将被清除。新图片仅载入编辑，不会立即替换任务图片。", cancel: "取消", accept: "载入图片" },
  close: { title: "放弃编辑并关闭？", message: "未保存的修改和待采用结果将丢失。", cancel: "继续编辑", accept: "放弃并关闭" },
  switch: { title: "切换编辑图片？", message: "当前未保存的编辑内容和待采用结果将丢失。", cancel: "取消", accept: "切换图片" },
};

export function ConfirmationDialog({ confirmation, answer, retryPreview, previewOnly = false }: { confirmation: EditorConfirmation; previewOnly?: boolean; answer: (id: string, accepted: boolean) => void; retryPreview?: (id: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null), cancel = useRef<HTMLButtonElement>(null), answered = useRef(false);
  const copy = CONFIRMATION_COPY[confirmation.kind];
  const [imageState, setImageState] = useState<{ url: string; loaded: boolean }>();
  const preview = confirmation.preview, replace = confirmation.kind === "replace";
  const previewUrl = useRef(preview?.url); previewUrl.current = preview?.url;
  const loaded = preview?.status === "ready" && imageState?.url === preview.url && imageState?.loaded;
  const loadError = preview?.url && imageState?.url === preview.url && !imageState.loaded;
  const respond = (accepted: boolean) => { if (!answered.current) { answered.current = true; answer(confirmation.id, accepted); } };
  useEffect(() => { dialog.current?.showModal(); cancel.current?.focus(); }, []);
  return <dialog ref={dialog} className={`confirmation-dialog${replace ? " replacement-confirmation" : ""}`} aria-labelledby="confirmation-title" aria-describedby="confirmation-message"
    onKeyDown={event => event.stopPropagation()} onKeyUp={event => event.stopPropagation()}
    onCancel={event => { event.preventDefault(); respond(false); }}>
    <div className="confirmation-heading"><h2 id="confirmation-title">{copy.title}</h2><button className="icon-button" aria-label="取消并关闭弹窗" onClick={() => respond(false)}><X size={18} /></button></div>
    <p id="confirmation-message">{previewOnly && confirmation.kind === "replace" ? "本次按所选场景演示替换流程，不会保存或替换任务图片，编辑内容将保留。" : copy.message}</p>
    {replace && <div className="replacement-preview" aria-label="最终成图预览" aria-busy={!loaded && !loadError && preview?.status !== "error"}>
      {preview?.url && !loadError && <img key={preview.url} src={preview.url} alt="将用于替换的最终图片"
        onLoad={() => { if (previewUrl.current === preview.url) setImageState({ url: preview.url!, loaded: true }); }}
        onError={() => { if (previewUrl.current === preview.url) setImageState({ url: preview.url!, loaded: false }); }} />}
      {preview?.status === "error" || loadError ? <div className="replacement-preview-message"><p role="alert">{preview?.error ?? "成图预览加载失败，编辑内容已保留。"}</p><button className="secondary-button" onClick={() => retryPreview?.(confirmation.id)}>重新生成预览</button></div>
        : !loaded && <p className="replacement-preview-message" role="status">正在生成最终成图预览…</p>}
    </div>}
    {replace && <p className="replacement-preview-caption">预览包含所有可见内容，隐藏图层不进入成图。</p>}
    <div className="dialog-actions"><button ref={cancel} className="secondary-button" onClick={() => respond(false)}>{copy.cancel}</button><button className="primary-button" disabled={replace && !loaded} onClick={() => respond(true)}>{copy.accept}</button></div>
  </dialog>;
}
