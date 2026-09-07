import { useEffect, useRef } from "react";
import type { PendingResult } from "../types";

export function ResultPreview({ result, busy, accept, discard }: { result: PendingResult; busy: boolean; accept: () => void; discard: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="result-dialog" aria-labelledby="result-title" onCancel={event => { event.preventDefault(); if (!busy) discard(); }}>
    <h2 id="result-title">检查消除结果</h2><p>使用结果后，本轮选区会清空；放弃后选区保留，可继续调整或重试。</p>
    <div className="result-images"><figure><figcaption>消除前</figcaption><img src={result.beforeUrl} alt="本次修改前的正式画面" /></figure><figure><figcaption>消除后</figcaption><img src={result.afterUrl} alt="待采用结果的正式画面" /></figure></div>
    <div className="dialog-actions"><button className="secondary-button" disabled={busy} onClick={discard}>放弃结果</button><button className="primary-button" disabled={busy} onClick={accept}>{busy ? "正在使用…" : "使用消除结果"}</button></div>
  </dialog>;
}
