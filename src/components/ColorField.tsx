import { Pipette } from "lucide-react";
import type { EditorController } from "../editor/EditorController";

const COLORS = ["#ffffff", "#202124", "#e34432", "#e69a27", "#e8cf5b", "#60a75c", "#2574d8", "#915ac3"];
export function ColorField({ label, value, onChange, engine }: {
  label: string; value: string; onChange: (color: string) => void; engine: EditorController;
}) {
  return <div className="color-field">
    <div className="color-field-heading"><span>{label}</span><span className="color-value">{value.toUpperCase()}</span></div>
    <div className="color-palette">
      {COLORS.map(color => <button type="button" key={color} style={{ backgroundColor: color }} className={value.toLowerCase() === color ? "active" : ""}
        aria-label={`${label} ${color}`} aria-pressed={value.toLowerCase() === color} onClick={() => onChange(color)} />)}
      <label className="custom-color" title={`自定义${label}`}><input aria-label={`自定义${label}`} type="color" value={value} onChange={event => onChange(event.target.value)} /></label>
      <button type="button" className="eyedropper" aria-label={`${label}取色`} title="从图片取色" onClick={() => void engine.startColorPick(onChange)}><Pipette size={16} /></button>
    </div>
  </div>;
}
