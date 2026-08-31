import { createRequire } from "node:module";

import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

import { _PackageCacheDir } from "../../../../../../vitest.cache";

/** Keeps the shared OpenTelemetry API instance while this package runs tests. */
const require = createRequire(import.meta.url);

/** Configures focused MCP executor controller tests. */
export default defineConfig({ cacheDir: _PackageCacheDir(import.meta.url), plugins: [tsconfigPaths({ projects: ["../../../../../../tsconfig.vitest.json"] })], resolve: { alias: { "@opentelemetry/api": require.resolve("@opentelemetry/api") } } });
