import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

import { _PackageCacheDir } from "../../../../../../vitest.cache";

/**
 * Vitest configuration for the conversation workspace API adapter.
 *
 * `tsconfigPaths` is what resolves the `@opencrane/*` imports: this library has no build target of its
 * own (project.json defines only lint and test), so specs load its sources through the workspace
 * aliases.
 *
 * `environment: "node"` even though this is frontend code. The specs here exercise the DTO mapping
 * functions directly and never touch the DOM.
 */
export default defineConfig({ cacheDir: _PackageCacheDir(import.meta.url), plugins: [tsconfigPaths({ projects: ["../../../../../../tsconfig.vitest.json"] })], test: { globals: true, environment: "node", setupFiles: ["../../../../vitest.frontend.setup.ts"], passWithNoTests: true } });
