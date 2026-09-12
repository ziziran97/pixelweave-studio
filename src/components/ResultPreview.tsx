import { useEffect, useRef, useState } from "react";
import { Crosshair, ScanSquare, ZoomIn, ZoomOut } from "lucide-react";
import type { DocumentSize, PendingResult } from "../types";
import { ActionButton } from "./ActionButton";

type Camera = { zoom: number | null; x: number; y: number };
type PreviewImages = Pick<PendingResult, "beforeUrl" | "afterUrl" | "region" | "previewError" | "previewPreparing" | "acceptError" | "illustrative">;
type ResultPreviewProps = {
  result: PreviewImages | PendingResult; size: DocumentSize; busy: boolean; suspended?: boolean;
  replacementMode?: "simulated" | "unavailable";
} & ({
  example: true; closeExample: () => void;
  accept?: never; discard?: never; retryPreview?: never; onPreviewState?: never;
} | {
  example?: false; closeExample?: never;
  accept: () => void; discard: () => void; retryPreview: () => void;
  onPreviewState?: (outcome: "shown" | "failed", loadAttempt: number) => void;
});

export function ResultPreview({ result, size, busy, suspended = false, replacementMode, accept, discard, retryPreview, onPreviewState, example: requestedExample = false, closeExample }: ResultPreviewProps) {
  const example = (import.meta.env.DEV || import.meta.env.MODE === "demo") && requestedExample;
  const illustrative = (import.meta.env.DEV || import.meta.env.MODE === "demo") && result.illustrative;
  const simulatedReplacement = (import.meta.env.DEV || import.meta.env.MODE === "demo") && replacementMode === "simulated";
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const panes = useRef<Array<HTMLDivElement | null>>([]);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const [bounds, setBounds] = useState({ width: 1, height: 1 });
  const [camera, setCamera] = useState<Camera>({ zoom: null, x: size.width / 2, y: size.height / 2 });
  const [loaded, setLoaded] = useState([false, false]);
  const [loadError, setLoadError] = useState(false);
  const loadGeneration = useRef(0);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const reloadPreview = () => {
    if (busy) return;
    drag.current = null;
    setLoaded([false, false]); setLoadError(false);
    setLoadAttempt(++loadGeneration.current);
  };
  const fitZoom = Math.min(1, bounds.width / size.width, bounds.height / size.height);
  const minZoom = Math.min(.03, fitZoom), maxZoom = 4;
  const zoom = camera.zoom ?? fitZoom;
  const imagesLoaded = loaded.every(Boolean);
  const ready = !!result.beforeUrl && !!result.afterUrl && imagesLoaded && !loadError && !result.previewError && !result.previewPreparing && bounds.width > 1;
  useEffect(() => {
    if (suspended) return;
    if (ready) onPreviewState?.("shown", loadAttempt);
    else if (loadError) onPreviewState?.("failed", loadAttempt);
  }, [ready, loadError, suspended, loadAttempt, onPreviewState]);
  useEffect(() => {
    if (imagesLoaded || loadError || !result.beforeUrl || !result.afterUrl || result.previewPreparing || result.previewError) return;
    const attempt = loadAttempt;
    const timer = window.setTimeout(() => {
      if (loadGeneration.current === attempt) setLoadError(true);
    }, 30000);
    return () => window.clearTimeout(timer);
  }, [imagesLoaded, loadError, loadAttempt, result.beforeUrl, result.afterUrl, result.previewPreparing, result.previewError]);

  // One camera in image coordinates keeps both views aligned at every zoom level.
  const constrain = (value: Camera, scale: number) => {
    const halfWidth = bounds.width / (2 * scale), halfHeight = bounds.height / (2 * scale);
    return { ...value,
      x: halfWidth >= size.width / 2 ? size.width / 2 : Math.max(halfWidth, Math.min(size.width - halfWidth, value.x)),
      y: halfHeight >= size.height / 2 ? size.height / 2 : Math.max(halfHeight, Math.min(size.height - halfHeight, value.y)),
    };
  };
  const position = constrain(camera, zoom);
  const changeZoom = (factor: number | "actual", anchor?: { x: number; y: number }) => {
    if (busy || !ready) return;
    drag.current = null;
    setCamera(previous => {
      const oldZoom = previous.zoom ?? fitZoom;
      const nextZoom = Math.max(minZoom, Math.min(maxZoom, factor === "actual" ? 1 : oldZoom * factor));
      const current = constrain(previous, oldZoom);
      const dx = (anchor?.x ?? bounds.width / 2) - bounds.width / 2;
      const dy = (anchor?.y ?? bounds.height / 2) - bounds.height / 2;
      return constrain({ zoom: nextZoom, x: current.x + dx * (1 / oldZoom - 1 / nextZoom), y: current.y + dy * (1 / oldZoom - 1 / nextZoom) }, nextZoom);
    });
  };
  const fit = () => {
    drag.current = null;
    setCamera({ zoom: null, x: size.width / 2, y: size.height / 2 });
  };
  const focusRegion = () => {
    const region = result.region;
    if (!region || !ready || busy) return;
    // Context is for inspection only; it never expands the submitted Mask.
    const padding = Math.max(24, Math.max(region.width, region.height) * .2);
    const left = Math.max(0, region.x - padding), top = Math.max(0, region.y - padding);
    const right = Math.min(size.width, region.x + region.width + padding), bottom = Math.min(size.height, region.y + region.height + padding);
    const scale = Math.max(minZoom, Math.min(maxZoom, bounds.width / (right - left), bounds.height / (bottom - top)));
    drag.current = null;
    setCamera(constrain({ zoom: scale, x: (left + right) / 2, y: (top + bottom) / 2 }, scale));
  };

  useEffect(() => {
    if (!suspended && !dialog.current?.open) { dialog.current?.showModal(); if (example) closeButton.current?.focus(); }
  }, [suspended, example]);
  const dismissExample = () => { dialog.current?.close(); closeExample?.(); };
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      const elements = panes.current.filter((pane): pane is HTMLDivElement => !!pane);
      if (!elements.length) return;
      const width = Math.min(...elements.map(pane => pane.clientWidth));
      const height = Math.min(...elements.map(pane => pane.clientHeight));
      setBounds(previous => previous.width === width && previous.height === height ? previous : { width, height });
      drag.current = null;
    });
    panes.current.forEach(pane => { if (pane) observer.observe(pane); });
    const release = () => { drag.current = null; };
    window.addEventListener("blur", release);
    return () => { observer.disconnect(); window.removeEventListener("blur", release); };
  }, []);

  useEffect(() => {
    // Native non-passive listeners prevent wheel zoom from scrolling the dialog/page.
    const elements = panes.current.filter((pane): pane is HTMLDivElement => !!pane);
    const wheel = (event: WheelEvent) => {
      event.preventDefault(); event.stopPropagation();
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bounds.height : 1);
      changeZoom(Math.exp(-Math.max(-500, Math.min(500, delta)) * .002), { x: event.clientX - rect.left, y: event.clientY - rect.top });
    };
    elements.forEach(pane => pane.addEventListener("wheel", wheel, { passive: false }));
    return () => elements.forEach(pane => pane.removeEventListener("wheel", wheel));
  }, [bounds, size.width, size.height, ready, busy]);

  return <dialog ref={dialog} className="result-dialog" aria-labelledby="result-title"
    onKeyDown={event => {
      event.stopPropagation();
      const key = event.key.toLowerCase();
      if ((key !== "f" && key !== "1" && key !== "r") || (key === "r" && !result.region) || event.defaultPrevented || event.nativeEvent.isComposing || event.repeat ||
        event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || busy || !ready || suspended || drag.current) return;
      if (event.target instanceof Element && event.target.closest("input,textarea,select,[contenteditable],[role='menu'],[role='listbox'],[role='combobox'],[role='slider']")) return;
      if ([...document.querySelectorAll("dialog[open],[role='dialog'][aria-modal='true']")]
        .some(other => other !== dialog.current && other.getClientRects().length > 0 && !other.contains(dialog.current))) return;
      event.preventDefault();
      if (key === "f") fit(); else if (key === "r") focusRegion(); else changeZoom("actual");
    }} onKeyUp={event => event.stopPropagation()}
    onCancel={event => { event.preventDefault(); if (example) dismissExample(); }}>
    <h2 id="result-title">检查消除结果</h2>
    <p>{example ? "固定样例 · 效果示意，未调用消除服务。" : illustrative ? "固定样图流程演示 · 未调用消除服务。使用后更新当前编辑草稿，未保存到任务。"
      : simulatedReplacement ? "使用后更新当前编辑草稿；替换流程为模拟，不会保存到任务。"
      : replacementMode === "unavailable" ? "使用后可继续编辑；当前未接入任务保存。"
      : "使用后可继续编辑，点击右上角“替换图片”才会保存到任务。"}</p>
    <div className="result-view-tools">
      <span>滚轮缩放，拖动查看；两侧同步</span>
      <div role="group" aria-label="结果查看">
        <ActionButton aria-label="缩小对比图片" hint="缩小" disabled={busy || !ready || zoom <= minZoom} onClick={() => changeZoom(1 / 1.25)}><ZoomOut /></ActionButton>
        <output aria-label="对比缩放比例">{ready ? `${Math.round(zoom * 100)}%` : "—"}</output>
        <ActionButton aria-label="放大对比图片" hint="放大" disabled={busy || !ready || zoom >= maxZoom} onClick={() => changeZoom(1.25)}><ZoomIn /></ActionButton>
        <ActionButton className="actual-size" disabled={busy || !ready} aria-label="100% 查看对比图片" aria-keyshortcuts="1" hint="以 100% 比例查看图片细节（1）" onClick={() => changeZoom("actual")}>100%</ActionButton>
        <ActionButton disabled={busy || !ready} aria-label="适配对比图片" aria-keyshortcuts="F" hint="完整显示图片并居中（F）" onClick={fit}><ScanSquare /></ActionButton>
        <span className="result-region-divider" aria-hidden="true" />
        <ActionButton disabled={busy || !ready || !result.region} aria-label="查看本次消除区域" aria-keyshortcuts="R" hint={example ? "定位示例中标签的移除区域及周边，左右同步（R）" : "定位本轮选区及周边，左右同步（R）"} onClick={focusRegion}><Crosshair />消除区域</ActionButton>
      </div>
    </div>
    <div className="result-images">{[result.beforeUrl, result.afterUrl].map((url, index) => <figure key={index}>
      <figcaption>{index === 0 ? "消除前" : "消除后"}</figcaption>
      <div ref={element => { panes.current[index] = element; }} className="result-viewport" tabIndex={0}
        aria-label={index === 0 ? "消除前对比视图" : "消除后对比视图"}
        onPointerDown={event => {
          if (event.button !== 0 || drag.current || busy || !ready) return;
          event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
        }}
        onPointerMove={event => {
          const previous = drag.current;
          if (!previous || previous.id !== event.pointerId || busy) return;
          if (!(event.buttons & 1)) { drag.current = null; return; }
          const dx = event.clientX - previous.x, dy = event.clientY - previous.y;
          drag.current = { id: previous.id, x: event.clientX, y: event.clientY };
          setCamera(current => {
            const scale = current.zoom ?? fitZoom, center = constrain(current, scale);
            return constrain({ ...current, x: center.x - dx / scale, y: center.y - dy / scale }, scale);
          });
        }}
        onPointerUp={event => { if (drag.current?.id === event.pointerId && event.button === 0) drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}
        onKeyDown={event => {
          const offset = ({ ArrowLeft: [-40, 0], ArrowRight: [40, 0], ArrowUp: [0, -40], ArrowDown: [0, 40] } as Record<string, number[]>)[event.key];
          if (!offset || busy || !ready) return;
          event.preventDefault();
          setCamera(current => {
            const scale = current.zoom ?? fitZoom, center = constrain(current, scale);
            return constrain({ ...current, x: center.x + offset[0] / scale, y: center.y + offset[1] / scale }, scale);
          });
        }}>
        {url && <img key={`${url}-${loadAttempt}`} src={url} draggable={false} alt={example ? (index === 0 ? "含橙色标签的示意图" : "移除标签后的示意图") : (index === 0 ? "本次消除前的图片" : "待采用的消除结果")}
          style={{ width: size.width * zoom, height: size.height * zoom,
            transform: `translate(${bounds.width / 2 - position.x * zoom}px, ${bounds.height / 2 - position.y * zoom}px)` }}
          onLoad={() => { if (loadAttempt === loadGeneration.current) setLoaded(previous => previous.map((value, i) => i === index || value)); }}
          onError={() => { if (loadAttempt === loadGeneration.current) setLoadError(true); }} />}
      </div>
    </figure>)}</div>
    {result.previewError ? <div className="result-recovery">
      <p role={result.previewPreparing ? "status" : "alert"}>{result.previewPreparing ? "正在生成对比预览，消除结果已保留…" : result.previewError}</p>
      <button className="secondary-button" disabled={busy || result.previewPreparing} onClick={retryPreview}>重新生成预览</button>
    </div> : loadError ? <div className="result-recovery">
      <p role="alert">{example ? "示例图片加载失败，可重新加载或关闭示例。" : "对比图片加载失败，消除结果已保留。"}</p>
      <button className="secondary-button" disabled={busy} onClick={reloadPreview}>重新加载预览</button>
    </div> : !ready && <p role="status">正在加载对比图片…</p>}
    {result.acceptError && <p className="result-error" role="alert">{result.acceptError}</p>}
    <div className="result-footer">
      {example ? <><p>示例仅供查看，不会修改当前图片或选区。</p>
        <div className="dialog-actions"><button ref={closeButton} className="primary-button" onClick={dismissExample}>关闭示例</button></div></> : <>
      <p>使用后清空本轮选区；放弃则保留选区。</p>
      <div className="dialog-actions"><button className="secondary-button" disabled={busy} onClick={discard}>放弃结果</button>
        <button className="primary-button" disabled={busy || !ready} onClick={accept}>{busy ? "正在使用…" : result.acceptError ? "重试使用结果" : "使用消除结果"}</button></div>
      </>}
    </div>
  </dialog>;
}
