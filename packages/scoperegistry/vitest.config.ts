import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// During dev/test, resolve @wildwinter/expr to its TS source in the sibling
// workspace package (no build step needed for co-development).
export default defineConfig({
  resolve: {
    alias: {
      "@wildwinter/expr": fileURLToPath(new URL("../expr/src/index.ts", import.meta.url)),
    },
  },
});
