import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

import { _PackageCacheDir } from "../../../../../../vitest.cache";

/** Runs the real transaction proofs only through the explicit database test target. */
export default defineConfig({ cacheDir: _PackageCacheDir(import.meta.url), plugins: [tsconfigPaths({ projects: ["../../../../../../tsconfig.vitest.json"] })], test: { include: ["src/**/__tests__/*.sql.test.ts"] } });
