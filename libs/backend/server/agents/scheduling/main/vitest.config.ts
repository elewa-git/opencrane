import { createRequire } from "node:module";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import { _PackageCacheDir } from "../../../../../../vitest.cache.js";

/** Node resolver used to keep one OpenTelemetry API instance in tests. */
const require = createRequire(import.meta.url);

/** Vitest configuration for the managed-agent scheduling semantics. */
export default defineConfig({
	cacheDir: _PackageCacheDir(import.meta.url),
	plugins: [tsconfigPaths({ projects: ["../../../../../../tsconfig.vitest.json"] })],
	resolve: { alias: { "@opentelemetry/api": require.resolve("@opentelemetry/api") } },
});
