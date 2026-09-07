import { Pipette, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ColorChannel, ColorEdit, EditorController } from "../editor/EditorController";
import { ColorPicker } from "./ColorPicker";
import type { ColorFormat } from "./colorValues";

const COLORS = ["#ffffff", "#202124", "#e34432", "#e69a27", "#e8cf5b", "#60a75c", "#2574d8", "#915ac3"];
export function ColorField({ label, value, channel, engine }: {
  label: string; value: string; channel: ColorChannel; engine: EditorController;
}) {
  const [open, setOpen] = useState(false), [sampling, setSampling] = useState(false);
  const [draft, setDraft] = useState(value);
  const [sample, setSample] = useState<{ color: string }>();
  const [format, setFormat] = useState<ColorFormat>("HEX");
  const original = useRef(value), edit = useRef<ColorEdit | undefined>(undefined);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = (apply: boolean) => { edit.current?.finish(apply); edit.current = undefined; setOpen(false); requestAnimationFrame(() => trigger.current?.focus()); };
  useEffect(() => () => { if (edit.current) { engine.cancelColorPick(); edit.current?.finish(false); } }, [engine]);
  const preview = (color: string) => { setDraft(color); edit.current?.preview(color); };
  const pick = (inside: boolean) => {
    if (!inside) { edit.current = engine.beginColorEdit(channel); if (!edit.current) return; }
    setSampling(true);
    void engine.startColorPick(color => {
      setSampling(false);
      if (inside) { setSample({ color }); preview(color); } else { edit.current?.preview(color); edit.current?.finish(true); edit.current = undefined; requestAnimationFrame(() => trigger.current?.focus()); }
    }, () => { setSampling(false); if (!inside) { edit.current?.finish(false); edit.current = undefined; requestAnimationFrame(() => trigger.current?.focus()); } });
  };
  return <div className="color-field">
    <div className="color-field-heading"><span>{label}</span><span className="color-value">{value.toUpperCase()}</span></div>
    <div className="color-palette">
      {COLORS.map(color => <button type="button" key={color} style={{ backgroundColor: color }} className={value.toLowerCase() === color ? "active" : ""}
        aria-label={`${label} ${color}`} aria-pressed={value.toLowerCase() === color} onClick={() => engine.setFieldColor(channel, color)} />)}
      <button ref={trigger} type="button" className="custom-color" aria-label={`自定义${label}`} title={`自定义${label}：${value.toUpperCase()}`} aria-expanded={open} onClick={() => {
        edit.current = engine.beginColorEdit(channel); if (!edit.current) return;
        original.current = value; setDraft(value); setSample(undefined); setFormat("HEX"); setOpen(true);
      }}><span className="current-color-swatch" style={{ backgroundColor: value }} aria-hidden="true" /><ChevronDown size={10} /></button>
      <button type="button" className="eyedropper" aria-label={`${label}取色`} title="从图片取色" onClick={() => pick(false)}><Pipette size={16} /></button>
    </div>
    {open && createPortal(<ColorPicker label={label} original={original.current} value={draft} anchor={trigger.current} sampling={sampling} sample={sample}
      format={format} changeFormat={setFormat} preview={preview} close={close} pick={() => pick(true)} />, document.body)}
  </div>;
}
