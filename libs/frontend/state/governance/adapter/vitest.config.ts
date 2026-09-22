import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

import { _PackageCacheDir } from "../../../../../vitest.cache";

/** Tests governance reads and presentation with Angular's browser-like environment. */
export default defineConfig({ cacheDir: _PackageCacheDir(import.meta.url), plugins: [tsconfigPaths()], test: { environment: "jsdom", setupFiles: ["../../../vitest.frontend.setup.ts"], include: ["src/**/*.spec.ts"] } });
