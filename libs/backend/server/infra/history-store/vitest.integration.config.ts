import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import { _PackageCacheDir } from "../../../../../vitest.cache";

/** Resolve the repository root for the shared TypeScript aliases. */
const _REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");

/**
 * Runs only the live-KurrentDB proofs (`*.integration.ts`) and never the mocked unit tests.
 *
 * The default `test` target collects `*.test.ts` and therefore leaves these files alone. Every suite
 * skips itself with a clear title when `KURRENTDB_INTEGRATION_URL` is unset, so this config exits
 * cleanly on a machine without a server. Files run one at a time because they share one database.
 */
export default defineConfig({
	cacheDir: _PackageCacheDir(import.meta.url),
	plugins: [tsconfigPaths({ projects: [path.join(_REPO_ROOT, "tsconfig.vitest.json")] })],
	test: {
		environment: "node",
		dir: _REPO_ROOT,
		include: ["libs/backend/server/infra/history-store/src/__tests__/**/*.integration.ts"],
		passWithNoTests: true,
		fileParallelism: false,
		testTimeout: 60_000,
		hookTimeout: 60_000,
	},
});
