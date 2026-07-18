import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

import { _PackageCacheDir } from "../../../../vitest.cache.js";

/** Vitest configuration for the target agent workload controller domain. */
export default defineConfig({ cacheDir: _PackageCacheDir(import.meta.url), plugins: [tsconfigPaths({ projects: ["../../../../tsconfig.vitest.json"] })], test: { globals: true, environment: "node", include: ["src/**/*.test.ts"] } });
