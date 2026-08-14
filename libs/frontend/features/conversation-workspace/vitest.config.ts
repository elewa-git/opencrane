import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

import { _PackageCacheDir } from "../../../../vitest.cache.js";

/**
 * Vitest configuration for the conversation workspace feature.
 *
 * `tsconfigPaths` is what resolves the `@opencrane/*` imports: this library has no build target of its
 * own (project.json defines only lint and test), so specs load its sources through the workspace
 * aliases.
 *
 * `environment: "jsdom"` because the specs here render the routed page component and read its DOM,
 * unlike the state packages, whose specs drive stores through Angular DI and run on node.
 */
export default defineConfig({ cacheDir: _PackageCacheDir(import.meta.url), plugins: [tsconfigPaths({ projects: ["../../../../tsconfig.vitest.json"] })], test: { globals: true, environment: "jsdom", setupFiles: ["../../vitest.frontend.setup.ts"], passWithNoTests: true } });
