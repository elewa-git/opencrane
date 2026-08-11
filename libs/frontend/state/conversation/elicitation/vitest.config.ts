import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import { _PackageCacheDir } from "../../../../../vitest.cache.js";

/** Vitest configuration for conversation elicitation state. */
export default defineConfig({ cacheDir: _PackageCacheDir(import.meta.url), plugins: [tsconfigPaths({ projects: ["../../../../../tsconfig.vitest.json"] })], test: { environment: "node", globals: true, setupFiles: ["../../../vitest.frontend.setup.ts"], passWithNoTests: true } });
