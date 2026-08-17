import { createRequire } from "node:module";

import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

import { _PackageCacheDir } from "../../../../../../vitest.cache";

/** Resolves one OpenTelemetry API instance for traced gateway tests. */
const require = createRequire(import.meta.url);

/** Runs the organisation-member authority tests with workspace aliases. */
export default defineConfig({
	cacheDir: _PackageCacheDir(import.meta.url),
	plugins: [tsconfigPaths({ projects: ["../../../../../../tsconfig.vitest.json"] })],
	resolve: { alias: { "@opentelemetry/api": require.resolve("@opentelemetry/api") } },
});
