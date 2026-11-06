import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The app's "@/…" imports, for tests too.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
});
