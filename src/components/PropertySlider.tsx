import { useEffect, useRef } from "react";

/** Preview continuously, then finish once on release, keyboard completion or focus loss. */
export function PropertySlider({ label, value, min, max, className, change, commit }: {
  label: string; value: number; min: number; max: number; className?: string;
  change: (value: number) => void; commit: () => void;
}) {
  const pending = useRef(false), commitRef = useRef(commit);
  commitRef.current = commit;
  const finish = () => { if (pending.current) { pending.current = false; commitRef.current(); } };
  useEffect(() => {
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    window.addEventListener("blur", finish);
    return () => {
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("blur", finish);
      finish();
    };
  }, []);
  return <input type="range" className={className} aria-label={label} min={min} max={max} value={value}
    onChange={event => { pending.current = true; change(Number(event.target.value)); }}
    onPointerUp={finish} onPointerCancel={finish} onKeyUp={finish} onBlur={finish} />;
}
