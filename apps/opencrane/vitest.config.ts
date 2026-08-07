import { createRequire } from "node:module";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import { _PackageCacheDir } from "../../vitest.cache.js";

const require = createRequire(import.meta.url);

/**
 * Vitest resolves the workspace aliases straight from tsconfig.json — libs have no build.
 *
 * The @opentelemetry/api alias pins every consumer (inlined source AND the externalized
 * SDK) to the single CJS build; without it Vite inlines the package's ESM build as a
 * second module instance, whose ProxyTracerProvider never receives the registered
 * delegate — spans silently stop recording (found via the observability lib tests).
 */
export default defineConfig({
  cacheDir: _PackageCacheDir(import.meta.url),
  plugins: [tsconfigPaths({ projects: ["../../tsconfig.vitest.json"] })],
  resolve: { alias: { "@opentelemetry/api": require.resolve("@opentelemetry/api") } },
  // 43 supertest-heavy files: full file-parallelism intermittently drops sockets
  // ("socket hang up") on loaded machines — cap the worker pool for determinism.
  test: { passWithNoTests: true, poolOptions: { threads: { maxThreads: 4 } }, retry: 1 },
});
