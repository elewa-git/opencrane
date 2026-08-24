import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

import { _PackageCacheDir } from "../../../../../../vitest.cache";

/** Configures Vitest for the workflow respawn-chain scheduler. */
export default defineConfig({
	cacheDir: _PackageCacheDir(import.meta.url),
	plugins: [tsconfigPaths({ projects: ["../../../../../../tsconfig.vitest.json"] })],
	test: { passWithNoTests: true },
});
