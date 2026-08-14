import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

import { _PackageCacheDir } from "../../vitest.cache";

/** Focused Vitest configuration for application composition contracts. */
export default defineConfig({ cacheDir: _PackageCacheDir(import.meta.url), plugins: [tsconfigPaths({ projects: ["../../tsconfig.vitest.json"] })], test: { globals: true, environment: "node", setupFiles: ["../../libs/frontend/vitest.frontend.setup.ts"], passWithNoTests: true } });
