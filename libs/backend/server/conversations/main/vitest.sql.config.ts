import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

import { _PackageCacheDir } from "../../../../../vitest.cache";

/** Exercises the authorized catalog transaction against the checked-in PostgreSQL baseline. */
export default defineConfig({ cacheDir: _PackageCacheDir(import.meta.url), plugins: [tsconfigPaths({ projects: ["../../../../../tsconfig.vitest.json"] })], test: { include: ["src/memory/workflow/__tests__/*.sql.test.ts"] } });
