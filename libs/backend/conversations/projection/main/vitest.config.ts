import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import { _PackageCacheDir } from "../../../../../vitest.cache.js";

/** Runs the pure projection tests with workspace aliases. */
export default defineConfig({ cacheDir: _PackageCacheDir(import.meta.url), plugins: [tsconfigPaths({ projects: ["../../../../../tsconfig.vitest.json"] })], test: { environment: "node" } });
