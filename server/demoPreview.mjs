import { createServer } from "vite";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { port: { type: "string" } } });
const port = values.port === undefined ? undefined : Number(values.port);
if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) {
  throw new Error("端口号须为 1–65535 的整数");
}

// Keep standalone demos independent of locally configured real services.
// Process-only overrides preserve the user's existing environment files.
process.env.VITE_ERASER_API_URL = "";
process.env.VITE_DEFAULT_IMAGE_URL = "";

const server = await createServer({ mode: "demo", ...(port === undefined ? {} : { server: { port } }) });
await server.listen();
server.printUrls();
