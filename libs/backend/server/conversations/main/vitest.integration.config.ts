import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import { _PackageCacheDir } from "../../../../../vitest.cache";

/** Resolve the repository root for the shared TypeScript aliases. */
const _REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");

/** Run conversation-owned history proofs against the explicitly configured KurrentDB server. */
export default defineConfig({
	cacheDir: _PackageCacheDir(import.meta.url),
	plugins: [tsconfigPaths({ projects: [path.join(_REPO_ROOT, "tsconfig.vitest.json")] })],
	test: {
		environment: "node",
		dir: _REPO_ROOT,
		include: [
			"libs/backend/server/conversations/main/src/**/*.integration.ts",
			"apps/opencrane/src/bootstrap/conversations/__tests__/conversation-message-admission.integration.ts",
		],
		fileParallelism: false,
		testTimeout: 60_000,
		hookTimeout: 60_000,
	},
});
