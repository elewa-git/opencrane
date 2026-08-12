import { defineConfig } from "vitest/config";
import { _PackageCacheDir } from "../../../../vitest.cache.js";

/** Test configuration for the pure conversation-asset model. */
export default defineConfig({
  cacheDir: _PackageCacheDir(import.meta.url), test: { environment: "node" } });
