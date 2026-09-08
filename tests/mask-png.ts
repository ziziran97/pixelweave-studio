import { exportMask } from "../src/editor/mask";
import { checkGrayMasks, compareMasks, legacyMask, pngHeader, representativeMask } from "./mask-png-checks";

const reports: string[] = [];
function check(value: boolean, label: string) { if (!value) throw new Error(label); reports.push(`PASS ${label}`); }
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const results: object[] = [];
const capture = new URLSearchParams(location.search).has("capture");
async function artifact(name: string, blob: Blob) {
  const link = document.createElement("a"); link.download = name; link.href = URL.createObjectURL(blob); link.textContent = `${name} (${blob.size} B)`;
  const row = document.createElement("p"); row.append(link); document.querySelector("#downloads")!.append(row);
  if (capture) {
    const response = await fetch(`/capture/${name}`, { method: "POST", body: blob });
    if (!response.ok) throw new Error("本地验证产物保存失败");
  }
}
async function timed(run: () => Promise<Blob>) {
  // This measures event-loop responsiveness separately from total wall time.
  let previous = performance.now(), maxGap = 0, ticks = 0;
  const timer = setInterval(() => { const now = performance.now(); maxGap = Math.max(maxGap, now - previous); previous = now; ticks++; }, 4);
  const start = performance.now();
  try {
    const blob = await run(), end = performance.now();
    maxGap = Math.max(maxGap, end - previous);
    return { blob, ms: end - start, maxGap, ticks };
  } finally { clearInterval(timer); }
}
try {
  await checkGrayMasks(check);
  for (const size of [{ width: 1024, height: 1024 }, { width: 2048, height: 2048 }, { width: 3840, height: 2160 }]) {
    const strokes = representativeMask(size), label = `${size.width}x${size.height}`;
    // Warm the modules/browser code once, then alternate five old/new exports.
    await legacyMask(strokes, size); await exportMask(strokes, size);
    const oldRuns = [], newRuns = [];
    for (let i = 0; i < 5; i++) {
      await new Promise(resolve => setTimeout(resolve, 0));
      if (i % 2) {
        newRuns.push(await timed(() => exportMask(strokes, size))); oldRuns.push(await timed(() => legacyMask(strokes, size)));
      } else {
        oldRuns.push(await timed(() => legacyMask(strokes, size))); newRuns.push(await timed(() => exportMask(strokes, size)));
      }
    }
    const oldBlob = oldRuns[0].blob, newBlob = newRuns[0].blob;
    await compareMasks(oldBlob, newBlob, size, check, label);
    results.push({ size: label, oldBytes: oldBlob.size, newBytes: newBlob.size, reductionPercent: (1 - newBlob.size / oldBlob.size) * 100,
      oldMedianMs: median(oldRuns.map(r => r.ms)), newMedianMs: median(newRuns.map(r => r.ms)),
      oldRuns: oldRuns.map(({ ms, maxGap, ticks }) => ({ ms, maxGap, ticks })), newRuns: newRuns.map(({ ms, maxGap, ticks }) => ({ ms, maxGap, ticks })),
      oldHeader: await pngHeader(oldBlob), newHeader: await pngHeader(newBlob) });
    await artifact(`${label}-rgba.png`, oldBlob); await artifact(`${label}-gray.png`, newBlob);
  }
  const report = { userAgent: navigator.userAgent, date: new Date().toISOString(), iterations: 5, warmup: 1, results };
  document.querySelector("#benchmark")!.textContent = JSON.stringify(report, null, 2);
  await artifact("benchmark.json", new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
  reports.push("DONE");
} catch (error) { reports.push(`FAIL ${(error as Error).message}`); }
finally { document.querySelector("#results")!.textContent = reports.join("\n"); }
