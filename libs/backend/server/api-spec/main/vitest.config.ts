import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import { _PackageCacheDir } from "../../../../../vitest.cache.js";

/** Vitest configuration for the composed control-plane API specification. */
export default defineConfig({
  cacheDir: _PackageCacheDir(import.meta.url),
  plugins: [tsconfigPaths({ projects: ["../../../../../tsconfig.vitest.json"] })],
  test: { passWithNoTests: true },
});
