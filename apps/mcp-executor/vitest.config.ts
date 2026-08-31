import { createRequire } from "node:module";

import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

import { _PackageCacheDir } from "../../vitest.cache";

/** Node resolver that keeps one OpenTelemetry API instance in app tests. */
const require = createRequire(import.meta.url);

/** Vitest configuration for the MCP companion composition root. */
export default defineConfig({ cacheDir: _PackageCacheDir(import.meta.url), plugins: [tsconfigPaths({ projects: ["../../tsconfig.vitest.json"] })], resolve: { alias: { "@opentelemetry/api": require.resolve("@opentelemetry/api") } } });
