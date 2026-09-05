import { defineConfig } from "vitest/config";
import { _PackageCacheDir } from "../../../../../vitest.cache";

export default defineConfig({
	cacheDir: _PackageCacheDir(import.meta.url),
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
	},
});
