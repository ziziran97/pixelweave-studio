import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { createLamaProxy } from "./server/lamaProxy.mjs";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "LAMA_");
  const install = (server) => {
    server.middlewares.use(createLamaProxy({ apiUrl: env.LAMA_API_URL,
      username: env.LAMA_USERNAME, apiKey: env.LAMA_API_KEY, timeoutMs: Number(env.LAMA_TIMEOUT_MS) }));
  };
  return {
    plugins: [react(), ...(mode === "production-test" ? [{ name: "local-lama-production-test",
      configureServer: install, configurePreviewServer: install }] : [])],
    server: { host: "127.0.0.1", port: 4180, strictPort: true },
    preview: { host: "127.0.0.1", port: 4180, strictPort: true },
  };
});
