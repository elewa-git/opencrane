import { defineConfig } from "vitest/config";
import { _PackageCacheDir } from "../../../../vitest.cache";

/** Test configuration for the pure artifact model. */
export default defineConfig({
  cacheDir: _PackageCacheDir(import.meta.url), test: { environment: "node" } });
