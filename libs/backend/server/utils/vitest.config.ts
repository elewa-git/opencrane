import { defineConfig } from "vitest/config";

import { _PackageCacheDir } from "../../../../vitest.cache";

/** Run the server-only ZIP boundary tests in Node. */
export default defineConfig({ cacheDir: _PackageCacheDir(import.meta.url), test: { environment: "node" } });
