import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

import { _PackageCacheDir } from "../../../../../vitest.cache";

/**
 * Runs the suites separately because their Serializable transactions share database tables.
 * Each test still runs its explicit concurrent requests to prove admission and replay races.
 */
export default defineConfig({ cacheDir: _PackageCacheDir(import.meta.url), plugins: [tsconfigPaths({ projects: ["../../../../../tsconfig.vitest.json"] })], test: { fileParallelism: false, include: ["src/memory/workflow/__tests__/*.sql.test.ts", "src/memory/commands/__tests__/*.sql.test.ts"] } });
