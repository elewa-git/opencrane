import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

import { _PackageCacheDir } from "../../vitest.cache.js";

/** Test configuration for the Angular application composition layer. */
export default defineConfig({ cacheDir: _PackageCacheDir(import.meta.url), plugins: [tsconfigPaths({ projects: ["../../tsconfig.vitest.json"] })], test: { globals: true, environment: "node", setupFiles: ["../../libs/frontend/vitest.frontend.setup.ts"] } });
