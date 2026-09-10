import { useEffect, useRef, useState } from "react";
import { Crosshair, Images } from "lucide-react";
import { ActionButton } from "./ActionButton";
import { ResultPreview } from "./ResultPreview";

// The static build-time guard removes the module and both images from production.
const loadExample = import.meta.env.DEV || import.meta.env.MODE === "demo" ? () => import("../demo/eraseExample") : undefined;
type Example = typeof import("../demo/eraseExample")["default"];

export function EraseExampleEntry({ disabled, selectRegion }: { disabled: boolean; selectRegion?: () => void }) {
  const [sample, setSample] = useState<Example>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0), trigger = useRef<HTMLButtonElement | null>(null);
  const disabledRef = useRef(disabled); disabledRef.current = disabled;
  useEffect(() => () => { generation.current++; }, []);
  useEffect(() => {
    if (disabled) { generation.current++; setLoading(false); setSample(undefined); }
  }, [disabled]);

  const open = async (button: HTMLButtonElement) => {
    if (!loadExample || disabled || loading || sample) return;
    trigger.current = button;
    const attempt = ++generation.current;
    const current = () => attempt === generation.current && !disabledRef.current;
    setLoading(true); setError("");
    try {
      const loaded = await loadExample();
      if (current()) setSample(loaded.default);
    } catch {
      if (current()) setError("示例加载失败，请再次点击重试。");
    } finally { if (current()) setLoading(false); }
  };
  const close = () => { setSample(undefined); trigger.current?.focus({ preventScroll: true }); };

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
