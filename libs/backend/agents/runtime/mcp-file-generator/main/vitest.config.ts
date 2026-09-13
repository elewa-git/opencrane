import { createRequire } from "node:module";

import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

import { _PackageCacheDir } from "../../../../../../vitest.cache";

/** Resolves one OpenTelemetry API instance for the HTTP adapter tests. */
const require = createRequire(import.meta.url);

/** Configures focused tests for CSV generation and its loopback MCP server. */
export default defineConfig({ cacheDir: _PackageCacheDir(import.meta.url), plugins: [tsconfigPaths({ projects: ["../../../../../../tsconfig.vitest.json"] })], resolve: { alias: { "@opentelemetry/api": require.resolve("@opentelemetry/api") } } });
