import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// During dev and test, resolve the kernel the extensions entry uses to its TS
// source in the sibling workspace packages, so no build step is needed.
export default defineConfig({
  resolve: {
    alias: {
      "@wildwinter/expr": fileURLToPath(new URL("../expr/src/index.ts", import.meta.url)),
      "@wildwinter/scoperegistry": fileURLToPath(new URL("../scoperegistry/src/index.ts", import.meta.url)),
    },
  },
});
