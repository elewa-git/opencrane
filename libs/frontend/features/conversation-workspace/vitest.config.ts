import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

import { _PackageCacheDir } from "../../../../vitest.cache.js";

/** Vitest configuration for the conversation workspace feature. */
export default defineConfig({ cacheDir: _PackageCacheDir(import.meta.url), plugins: [tsconfigPaths({ projects: ["../../../../tsconfig.vitest.json"] })], test: { globals: true, environment: "jsdom", setupFiles: ["../../vitest.frontend.setup.ts"], passWithNoTests: true } });
