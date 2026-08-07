import { defineConfig } from "vitest/config";
import { _PackageCacheDir } from "../../../../vitest.cache.js";

/** Vitest configuration for the pure authorization model. */
export default defineConfig({
  cacheDir: _PackageCacheDir(import.meta.url),
  test: { passWithNoTests: true },
});
