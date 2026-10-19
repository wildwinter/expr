import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/archive.ts", "src/extensions.ts", "src/vcs.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
});
