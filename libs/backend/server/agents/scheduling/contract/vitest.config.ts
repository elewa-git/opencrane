import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

import { _PackageCacheDir } from "../../../../../../vitest.cache";

/** Checks the occurrence contracts without loading runtime or database adapters. */
export default defineConfig({
	cacheDir: _PackageCacheDir(import.meta.url),
	plugins: [tsconfigPaths({ projects: ["../../../../../../tsconfig.vitest.json"] })],
});
