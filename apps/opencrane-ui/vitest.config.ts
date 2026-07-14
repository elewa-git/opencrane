import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

/** Vitest configuration for app-local mock, facade, route, and shared-component tests. */
export default defineConfig({
	plugins: [tsconfigPaths({ projects: ["./tsconfig.frontend.json"] })],
	test:
	{
		globals: true,
		environment: "jsdom",
		include: ["apps/opencrane-ui/src/**/*.spec.ts"],
		setupFiles: ["apps/opencrane-ui/vitest.setup.ts"],
		passWithNoTests: false
	}
});
