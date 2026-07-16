import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

const require = createRequire(import.meta.url);

// Resolve the shared tsconfig ABSOLUTELY from this file's location. A bare relative
// glob is resolved against the Vite root (the cwd), which points outside the tree
// when tests run from a git worktree — the workspace path aliases then fail to load
// and cross-package runtime imports (e.g. @opencrane/backend/mcp) cannot resolve.
const _vitestTsconfig = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../tsconfig.vitest.json");

/**
 * Vitest resolves the workspace aliases straight from tsconfig.json — libs have no build.
 *
 * The @opentelemetry/api alias pins every consumer (inlined source AND the externalized
 * SDK) to the single CJS build; without it Vite inlines the package's ESM build as a
 * second module instance, whose ProxyTracerProvider never receives the registered
 * delegate — spans silently stop recording (found via the observability lib tests).
 */
export default defineConfig({
  plugins: [tsconfigPaths({ projects: [_vitestTsconfig] })],
  resolve: { alias: { "@opentelemetry/api": require.resolve("@opentelemetry/api") } },
  test: { passWithNoTests: true },
});
