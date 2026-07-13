import { createRequire } from "node:module";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

const require = createRequire(import.meta.url);

/**
 * Vitest resolves the workspace aliases straight from tsconfig.base.json — libs have no build.
 *
 * The @opentelemetry/api alias pins every consumer (inlined source AND the externalized
 * SDK) to the single CJS build; without it Vite inlines the package's ESM build as a
 * second module instance, whose ProxyTracerProvider never receives the registered
 * delegate — spans silently stop recording (found via the observability lib tests).
 */
export default defineConfig({
  plugins: [tsconfigPaths({ projects: ["../../../../tsconfig.base.json"] })],
  resolve: { alias: { "@opentelemetry/api": require.resolve("@opentelemetry/api") } },
  test: { passWithNoTests: true },
});
