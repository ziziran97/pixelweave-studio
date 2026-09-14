import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

// Run against the actual regular production output, after `npm run build`.
const root = path.resolve(process.argv[2] ?? "dist");
async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory()
    ? filesIn(path.join(directory, entry.name)) : path.join(directory, entry.name)))).flat();
}
const files = await filesIn(root);
if (!files.includes(path.join(root, "index.html")) || !files.some(file => file.endsWith(".js"))) {
  throw new Error("Production output missing; run npm run build first.");
}
const violations = [];
for (const file of files) {
  const relative = path.relative(root, file).replaceAll("\\", "/");
  if (/(^|\/)(tests|demo)(\/|$)|(?:before|after)-970x600|eraseExample|previewReplacement|previewTextValidation/i.test(relative)) violations.push(relative);
  if (/\.(js|html)$/.test(file)) {
    const source = await readFile(file, "utf8");
    // Inspect shared components too, not just the modules which implement demo scenarios.
    const found = source.match(/演示|模拟|示例|真实消除测试|开发预览|replacement-demo|\bdurable\b|\bsupreme\b/g);
    if (found) violations.push(`${relative}: ${[...new Set(found)].join(", ")}`);
  }
}
if (violations.length) throw new Error(`Demo content in production output:\n${violations.join("\n")}`);
console.log("Production isolation passed: no demo copy, scenarios, test words, entries or sample assets.");
