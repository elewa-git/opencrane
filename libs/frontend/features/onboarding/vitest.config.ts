import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import { _PackageCacheDir } from "../../../../vitest.cache";

/** Vitest configuration for the routed persona onboarding feature. */
export default defineConfig({
	cacheDir: _PackageCacheDir(import.meta.url),
	plugins: [tsconfigPaths({ projects: ["../../../../tsconfig.vitest.json"] })],
	test: { environment: "jsdom", globals: true, setupFiles: ["../../vitest.frontend.setup.ts"], passWithNoTests: true }
});
