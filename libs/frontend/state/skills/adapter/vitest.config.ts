import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

import { _PackageCacheDir } from "../../../../../vitest.cache";

/** Vitest configuration for the browser-state adapter package. */
export default defineConfig({
	cacheDir: _PackageCacheDir(import.meta.url),
	plugins: [tsconfigPaths({ projects: ["../../../../../tsconfig.vitest.json"] })],
	test: {
		globals: true,
		environment: "node",
		setupFiles: ["../../../vitest.frontend.setup.ts"],
		passWithNoTests: true
	}
});
