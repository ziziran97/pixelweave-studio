import { useEffect, useRef, useState } from "react";
import { Crosshair, Images } from "lucide-react";
import { ActionButton } from "./ActionButton";
import { ResultPreview } from "./ResultPreview";
import { fetchImageBlob } from "../lib/imageLoading";

// The static build-time guard removes the module and both images from production.
const loadExample = import.meta.env.DEV || import.meta.env.MODE === "demo" ? () => import("../demo/eraseExample") : undefined;
type Example = typeof import("../demo/eraseExample")["default"];

export function EraseExampleEntry({ disabled, selectRegion }: { disabled: boolean; selectRegion?: () => void }) {
  const [sample, setSample] = useState<Example>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0), trigger = useRef<HTMLButtonElement | null>(null);
  const download = useRef<AbortController | undefined>(undefined);
  const imageUrls = useRef<string[]>([]);
  const release = () => {
    download.current?.abort(); download.current = undefined;
    imageUrls.current.forEach(url => URL.revokeObjectURL(url)); imageUrls.current = [];
  };
  const disabledRef = useRef(disabled); disabledRef.current = disabled;
  useEffect(() => () => { generation.current++; release(); }, []);
  useEffect(() => {
    if (disabled) { generation.current++; release(); setLoading(false); setSample(undefined); }
  }, [disabled]);

  const open = async (button: HTMLButtonElement) => {
    if (!loadExample || disabled || loading || sample) return;
    trigger.current = button;
    const attempt = ++generation.current;
    const request = new AbortController(); download.current = request;
    const current = () => attempt === generation.current && !disabledRef.current;
    setLoading(true); setError("");
    try {
      const loaded = await loadExample();
      if (!current()) return;
      const options = { signal: request.signal, cache: import.meta.env.DEV ? "default" as const : "force-cache" as const,
        failureMessage: "示例加载失败，请再次点击重试。", timeoutMessage: "示例加载超时，请检查网络后重试。" };
      const blobs = await Promise.all([fetchImageBlob(loaded.default.result.beforeUrl, options), fetchImageBlob(loaded.default.result.afterUrl, options)]);
      if (current()) {
        imageUrls.current = blobs.map(blob => URL.createObjectURL(blob));
        setSample({ ...loaded.default, result: { ...loaded.default.result, beforeUrl: imageUrls.current[0], afterUrl: imageUrls.current[1] } });
      }
    } catch (reason) {
      if (current()) { release(); setError(reason instanceof Error && reason.message.includes("示例加载超时") ? "示例加载超时，请检查网络后重试。" : "示例加载失败，请再次点击重试。"); }
    } finally { if (current()) setLoading(false); }
  };
  const close = () => { generation.current++; release(); setSample(undefined); trigger.current?.focus({ preventScroll: true }); };

  if (!loadExample) return null;
  return <div className="erase-base-hint">
    {selectRegion && <>
      <ActionButton floating dismissHintOnClick className="secondary-button full" disabled={disabled || loading || !!sample}
        hint="选择固定标签区域，再点击开始消除；不调用算法" onClick={selectRegion}><Crosshair size={16} />选择示例标签区域</ActionButton>
      <p className="field-help">固定样图流程演示 · 选择标签后点击开始消除，结果为预置样图。</p>
    </>}
    <ActionButton floating dismissHintOnClick hintSuspended={loading || !!sample} className="secondary-button full"
      aria-label="查看消除结果示例" hint="固定样图，仅演示对比、缩放和区域定位，无需密钥" disabled={disabled || loading}
      onClick={event => void open(event.currentTarget)}><Images size={16} />{loading ? "正在加载示例…" : "查看消除结果示例"}</ActionButton>
    <p className="field-help">固定样图 · 仅演示查看交互</p>
    {error && <p className="field-help" role="alert">{error}</p>}
    {sample && !disabled && <ResultPreview result={sample.result} size={sample.size} busy={false} example closeExample={close} />}
  </div>;
}
