import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

import { _PackageCacheDir } from "../../../../../../vitest.cache";

/** Runs the signed-in organization-members adapter tests. */
export default defineConfig({ cacheDir: _PackageCacheDir(import.meta.url), plugins: [tsconfigPaths()], test: { environment: "jsdom", setupFiles: ["../../../../vitest.frontend.setup.ts"], include: ["src/**/*.spec.ts"] } });
