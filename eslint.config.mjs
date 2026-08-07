/**
 * Root ESLint flat config — module-boundary enforcement only.
 *
 * Mechanical TypeScript style stays in `scripts/agent-style-check.sh` and per-package
 * `tsc --noEmit`; this config exists solely so the NX project graph can enforce the
 * capability scopes and dimensional tags declared in each project:
 *
 *   - `scope:<capability>` backend packages may use only their explicit graph edges.
 *   - `scope:shared` dependency-light packages may use approved shared/model contracts.
 *   - `scope:web` frontend packages may depend on web and shared packages.
 *   - `scope:app` entrypoints may compose libraries but cannot import another app.
 *
 * Phase B started dimensional tags on every new or touched project. Untagged legacy targets are
 * direct-deletion/refactor debt, while newly tagged projects are prevented from introducing
 * app-to-app, lib-to-app, or upward layer dependencies now.
 *
 * Run via `npm run lint:boundaries`.
 */
import nx from "@nx/eslint-plugin";
import tsEslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

/** Enforces the package test-layout convention independently of Vitest discovery. */
const testLayout = {
  rules: {
    "require-tests-directory": {
      meta: {
        type: "problem",
        docs: { description: "require TypeScript tests to live below __tests__" },
        schema: [],
        messages: { misplacedTest: "Move this test below a __tests__ directory." },
      },
      create(context) {
        const filename = context.filename.replaceAll("\\", "/");

        if (filename.includes("/__tests__/")) {
          return {};
        }

        return {
          Program(node) {
            context.report({ node, messageId: "misplacedTest" });
          },
        };
      },
    },
  },
};

export default [
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      ".claude/**",
      ".nx/**",
      "website/**",
      "libs/contracts/src/generated/**",
    ],
  },
  {
    files: ["**/*.ts", "**/*.mts"],
    languageOptions: { parser: tsParser },
    linterOptions: { reportUnusedDisableDirectives: "off" },
    // typescript-eslint is registered ONLY so pre-existing inline
    // `eslint-disable @typescript-eslint/*` directives resolve; no rules enabled.
    plugins: { "@nx": nx, "@typescript-eslint": tsEslint },
    rules: {
      "@nx/enforce-module-boundaries": [
        "error",
        {
          enforceBuildableLibDependency: false,
          allow: [],
          depConstraints: [
            {
              sourceTag: "scope:shared",
              onlyDependOnLibsWithTags: [
                "scope:shared",
                "scope:agents",
                "scope:artifacts",
                "scope:authorization",
                "scope:auth",
                "scope:channel-proxy",
                "scope:http",
              ],
            },
            {
              sourceTag: "scope:agent-services",
              onlyDependOnLibsWithTags: ["scope:agent-services", "scope:agents", "scope:audit", "scope:auth", "scope:authorization", "scope:membership", "scope:shared"],
            },
            {
              sourceTag: "scope:api-spec",
              onlyDependOnLibsWithTags: [
                "scope:agent-services",
                "scope:api-spec",
                "scope:artifacts",
                "scope:audit",
                "scope:authorization",
                "scope:conversation-replay",
                "scope:execution-protocol",
                "scope:execution-admission",
                "scope:execution-runs",
                "scope:grants",
                "scope:groups",
                "scope:mcp",
                "scope:model-routing",
                "scope:membership",
                "scope:personal-configuration",
                "scope:personal-personas",
                "scope:providers",
                "scope:retrieval",
                "scope:shared",
                "scope:skills",
                "scope:spend",
              ],
            },
            { sourceTag: "scope:audit", onlyDependOnLibsWithTags: ["scope:audit", "scope:shared"] },
            { sourceTag: "scope:authorization", onlyDependOnLibsWithTags: ["scope:audit", "scope:auth", "scope:authorization", "scope:shared"] },
            { sourceTag: "scope:auth", onlyDependOnLibsWithTags: ["scope:auth", "scope:k8s-api", "scope:shared"] },
            { sourceTag: "scope:channel-proxy", onlyDependOnLibsWithTags: ["scope:channel-proxy", "scope:shared"] },
            { sourceTag: "scope:agent-runtime-stream", onlyDependOnLibsWithTags: ["scope:agent-runtime-stream", "scope:workload-identity", "scope:shared"] },
            { sourceTag: "scope:workload-identity", onlyDependOnLibsWithTags: ["scope:workload-identity", "scope:shared"] },
            { sourceTag: "scope:agent-runtime-launcher", onlyDependOnLibsWithTags: ["scope:agent-runtime-launcher", "scope:shared"] },
            { sourceTag: "scope:agent-runtime-cleanup", onlyDependOnLibsWithTags: ["scope:agent-runtime-cleanup", "scope:agent-runtime-launcher", "scope:shared"] },
            { sourceTag: "scope:skills-launcher", onlyDependOnLibsWithTags: ["scope:skills-launcher", "scope:shared"] },
            { sourceTag: "scope:skills-controller", onlyDependOnLibsWithTags: ["scope:skills-controller", "scope:skills-launcher", "scope:shared"] },
            { sourceTag: "scope:agent-runtime-controller", onlyDependOnLibsWithTags: ["scope:agent-runtime-controller", "scope:agent-runtime-launcher", "scope:shared"] },
            { sourceTag: "scope:agent-controller", onlyDependOnLibsWithTags: ["scope:agent-controller", "scope:agent-runtime-controller", "scope:skills-controller", "scope:shared"] },
            { sourceTag: "scope:cluster-tenants", onlyDependOnLibsWithTags: ["scope:auth", "scope:cluster-tenants", "scope:k8s-api", "scope:shared"] },
			{ sourceTag: "scope:conversation-replay", onlyDependOnLibsWithTags: ["scope:auth", "scope:channel-targets", "scope:conversation-replay", "scope:shared"] },
			{ sourceTag: "scope:personal-configuration", onlyDependOnLibsWithTags: ["scope:agent-services", "scope:agents", "scope:auth", "scope:personal-configuration", "scope:shared"] },
            { sourceTag: "scope:grants", onlyDependOnLibsWithTags: ["scope:auth", "scope:authorization", "scope:grants", "scope:shared"] },
            { sourceTag: "scope:groups", onlyDependOnLibsWithTags: ["scope:groups", "scope:shared"] },
            { sourceTag: "scope:http", onlyDependOnLibsWithTags: ["scope:http", "scope:shared"] },
            { sourceTag: "scope:integrations", onlyDependOnLibsWithTags: ["scope:auth", "scope:integrations", "scope:obot-custody", "scope:shared"] },
            { sourceTag: "scope:k8s-api", onlyDependOnLibsWithTags: ["scope:k8s-api", "scope:shared"] },
            {
              sourceTag: "scope:identity",
              onlyDependOnLibsWithTags: [
                "scope:auth",
                "scope:cluster-tenants",
                "scope:identity",
                "scope:shared",
              ],
            },
            { sourceTag: "scope:mcp", onlyDependOnLibsWithTags: ["scope:auth", "scope:mcp", "scope:shared"] },
            { sourceTag: "scope:membership", onlyDependOnLibsWithTags: ["scope:audit", "scope:auth", "scope:authorization", "scope:membership", "scope:shared"] },
            { sourceTag: "scope:memory", onlyDependOnLibsWithTags: ["scope:artifacts", "scope:memory", "scope:shared"] },
            { sourceTag: "scope:personal-memory", onlyDependOnLibsWithTags: ["scope:personal-memory", "scope:shared"] },
            { sourceTag: "scope:obot-custody", onlyDependOnLibsWithTags: ["scope:obot-custody", "scope:shared"] },
            { sourceTag: "scope:sandbox-execution", onlyDependOnLibsWithTags: ["scope:sandbox-execution", "scope:shared"] },
            { sourceTag: "scope:memory-gateway-client", onlyDependOnLibsWithTags: ["scope:memory-gateway-client", "scope:shared"] },
            { sourceTag: "scope:memory-gateway", onlyDependOnLibsWithTags: ["scope:memory-gateway", "scope:shared", "scope:workload-identity"] },
            { sourceTag: "scope:model-routing", onlyDependOnLibsWithTags: ["scope:auth", "scope:cluster-tenants", "scope:http", "scope:model-routing", "scope:shared"] },
            { sourceTag: "scope:personal-personas", onlyDependOnLibsWithTags: ["scope:auth", "scope:personal-configuration", "scope:personal-personas", "scope:shared"] },
            { sourceTag: "scope:execution-inputs", onlyDependOnLibsWithTags: ["scope:agent-services", "scope:agents", "scope:artifacts", "scope:authorization", "scope:membership", "scope:execution-runs", "scope:execution-inputs", "scope:personal-memory", "scope:shared"] },
            { sourceTag: "scope:execution-admission", onlyDependOnLibsWithTags: ["scope:agent-services", "scope:execution-admission", "scope:execution-inputs", "scope:execution-runs", "scope:membership", "scope:shared"] },
            { sourceTag: "scope:providers", onlyDependOnLibsWithTags: ["scope:auth", "scope:cluster-tenants", "scope:model-routing", "scope:providers", "scope:shared"] },
            { sourceTag: "scope:retrieval", onlyDependOnLibsWithTags: ["scope:retrieval", "scope:shared"] },
            { sourceTag: "scope:execution-runs", onlyDependOnLibsWithTags: ["scope:agents", "scope:auth", "scope:authorization", "scope:execution-runs", "scope:shared"] },
            { sourceTag: "scope:execution-protocol", onlyDependOnLibsWithTags: ["scope:execution-protocol", "scope:execution-inputs", "scope:execution-runs", "scope:personal-configuration", "scope:agents", "scope:auth", "scope:authorization", "scope:integrations", "scope:obot-custody", "scope:sandbox-execution", "scope:memory-gateway-client", "scope:shared"] },
            { sourceTag: "scope:agent-runtime", onlyDependOnLibsWithTags: ["scope:agent-runtime", "scope:agents", "scope:authorization", "scope:execution-protocol", "scope:obot-custody", "scope:sandbox-execution", "scope:memory-gateway-client", "scope:shared"] },
            { sourceTag: "scope:skills", onlyDependOnLibsWithTags: ["scope:artifacts", "scope:auth", "scope:cluster-tenants", "scope:grants", "scope:shared", "scope:skills"] },
            { sourceTag: "scope:spend", onlyDependOnLibsWithTags: ["scope:shared", "scope:spend"] },
            { sourceTag: "scope:web", onlyDependOnLibsWithTags: ["scope:web", "scope:shared"] },
            {
              sourceTag: "scope:opencrane",
              onlyDependOnLibsWithTags: [
                "scope:agent-runtime-cleanup",
                "scope:agent-runtime-stream",
                "scope:agent-services",
                "scope:api-spec",
                "scope:artifacts",
                "scope:audit",
                "scope:auth",
                "scope:authorization",
                "scope:channel-targets",
                "scope:conversation-replay",
                "scope:execution-admission",
                "scope:execution-protocol",
                "scope:execution-runs",
                "scope:grants",
                "scope:groups",
                "scope:http",
                "scope:identity",
                "scope:integrations",
                "scope:mcp",
                "scope:memory-gateway-client",
                "scope:model-routing",
                "scope:membership",
                "scope:obot-custody",
                "scope:personal-configuration",
                "scope:personal-personas",
                "scope:providers",
                "scope:retrieval",
                "scope:shared",
                "scope:skills",
                "scope:spend",
                "scope:workload-identity",
              ],
            },
            { sourceTag: "scope:app", onlyDependOnLibsWithTags: ["*"] },
            { sourceTag: "scope:agents", onlyDependOnLibsWithTags: ["scope:agents", "scope:shared"] },
            { sourceTag: "scope:artifacts", onlyDependOnLibsWithTags: ["scope:artifacts", "scope:auth", "scope:shared"] },
            { sourceTag: "type:app", notDependOnLibsWithTags: ["type:app"] },
            { sourceTag: "type:lib", notDependOnLibsWithTags: ["type:app"] },
            {
              sourceTag: "layer:backend",
              notDependOnLibsWithTags: ["layer:entrypoint", "layer:frontend"],
            },
            {
              sourceTag: "layer:infra",
              notDependOnLibsWithTags: ["layer:entrypoint", "layer:backend", "layer:frontend"],
            },
            {
              sourceTag: "layer:frontend",
              notDependOnLibsWithTags: ["layer:entrypoint", "layer:backend", "layer:infra"],
            },
            {
              sourceTag: "layer:contract",
              notDependOnLibsWithTags: [
                "layer:entrypoint",
                "layer:backend",
                "layer:frontend",
                "layer:infra",
              ],
            },
            {
              sourceTag: "layer:model",
              notDependOnLibsWithTags: [
                "layer:entrypoint",
                "layer:backend",
                "layer:contract",
                "layer:frontend",
                "layer:infra",
              ],
            },
            {
              sourceTag: "layer:util",
              notDependOnLibsWithTags: [
                "layer:entrypoint",
                "layer:backend",
                "layer:contract",
                "layer:frontend",
                "layer:infra",
              ],
            },
          ],
        },
      ],
    },
  },
  {
    // Vitest configs are build tooling, not product modules: every one imports the
    // root vitest.cache.js helper by relative path (the ROOT-CACHE style rule requires
    // it), which the boundaries rule would misread as an unregistered external import.
    files: ["**/vitest.config.ts"],
    rules: { "@nx/enforce-module-boundaries": "off" },
  },
  {
    files: ["**/*.test.ts"],
    plugins: { "test-layout": testLayout },
    rules: { "test-layout/require-tests-directory": "error" },
  },
];
