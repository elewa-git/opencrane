import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import { _PackageCacheDir } from "../../../vitest.cache.js";

/**
 * Vitest resolves the `@opencrane/*` workspace aliases straight from
 * tsconfig.frontend.json — this lib has no build step of its own.
 *
 * `environment: "node"` + the shared Angular-compiler setup file keeps specs
 * that reach into Angular DI (TestBed, router, etc.) working without jsdom.
 */
export default defineConfig({
	cacheDir: _PackageCacheDir(import.meta.url),
	plugins: [tsconfigPaths({ projects: ["../../../tsconfig.vitest.json"] })],
	test: {
		globals: true,
		environment: "node",
		setupFiles: ["../vitest.frontend.setup.ts"],
		passWithNoTests: true
	}
});
