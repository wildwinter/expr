import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// During dev/test, resolve @wildwinter/expr to its TS source in the sibling
// workspace package (no build step needed for co-development). The pure-logic
// suites (ast / tree / ops / schema / validate) run in the default node env; the
// DOM UI is verified in a host app's browser preview.
export default defineConfig({
  resolve: {
    alias: {
      "@wildwinter/expr": fileURLToPath(new URL("../expr/src/index.ts", import.meta.url)),
    },
  },
});
