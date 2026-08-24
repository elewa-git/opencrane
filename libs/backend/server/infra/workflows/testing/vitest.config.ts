import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

import { _PackageCacheDir } from "../../../../../../vitest.cache";

/** Vitest configuration for workflow engine test doubles and adapter contracts. */
export default defineConfig({ cacheDir: _PackageCacheDir(import.meta.url), plugins: [tsconfigPaths({ projects: ["../../../../../../tsconfig.vitest.json"] })] });
