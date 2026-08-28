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
                "scope:conversations",
                "scope:conversation-assets",
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
                "scope:conversations",
                "scope:conversation-assets",
                "scope:execution-protocol",
                "scope:execution-admission",
                "scope:execution-runs",
                "scope:execution-elicitation",
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
				"scope:skills-workflow-contract",
                "scope:spend",
                "scope:user-onboarding",
              ],
            },
            { sourceTag: "scope:audit", onlyDependOnLibsWithTags: ["scope:audit", "scope:shared"] },
            { sourceTag: "scope:authorization", onlyDependOnLibsWithTags: ["scope:audit", "scope:auth", "scope:authorization", "scope:shared"] },
            { sourceTag: "scope:auth", onlyDependOnLibsWithTags: ["scope:auth", "scope:k8s-api", "scope:shared"] },
            { sourceTag: "scope:channel-proxy", onlyDependOnLibsWithTags: ["scope:channel-proxy", "scope:shared"] },
            { sourceTag: "scope:agent-runtime-stream", onlyDependOnLibsWithTags: ["scope:agent-runtime-stream", "scope:workload-identity", "scope:shared"] },
            { sourceTag: "scope:agent-runtime-continuation", onlyDependOnLibsWithTags: ["scope:agent-runtime-continuation", "scope:shared"] },
            { sourceTag: "scope:workload-identity", onlyDependOnLibsWithTags: ["scope:workload-identity", "scope:shared"] },
            { sourceTag: "scope:workflows", onlyDependOnLibsWithTags: ["scope:shared", "scope:workflows"] },
            { sourceTag: "scope:runtime-workloads", onlyDependOnLibsWithTags: ["scope:runtime-workloads", "scope:shared"] },
            { sourceTag: "scope:mcp-runtime", onlyDependOnLibsWithTags: ["scope:mcp-runtime", "scope:runtime-workloads", "scope:shared"] },
            { sourceTag: "scope:agent-runtime-launcher", onlyDependOnLibsWithTags: ["scope:agent-runtime-launcher", "scope:shared"] },
			{ sourceTag: "scope:artifact-preprocessor-launcher", onlyDependOnLibsWithTags: ["scope:artifact-preprocessor-launcher", "scope:shared"] },
			{ sourceTag: "scope:artifact-preprocessor-controller", onlyDependOnLibsWithTags: ["scope:artifact-preprocessor-controller", "scope:artifact-preprocessor-launcher", "scope:artifacts-workflow-contract", "scope:runtime-workloads", "scope:shared", "scope:workflows"] },
            { sourceTag: "scope:skills-launcher", onlyDependOnLibsWithTags: ["scope:skills-launcher", "scope:shared"] },
            { sourceTag: "scope:skills-controller", onlyDependOnLibsWithTags: ["scope:skills-controller", "scope:skills-launcher", "scope:skills-workflow-contract", "scope:runtime-workloads", "scope:shared", "scope:workflows"] },
            { sourceTag: "scope:agent-runtime-controller", onlyDependOnLibsWithTags: ["scope:agent-runtime-controller", "scope:agent-runtime-launcher", "scope:shared"] },
            { sourceTag: "scope:agent-controller", onlyDependOnLibsWithTags: ["scope:agent-controller", "scope:agent-runtime-controller", "scope:agent-runtime-launcher", "scope:artifact-preprocessor-controller", "scope:artifact-preprocessor-launcher", "scope:artifacts-workflow-contract", "scope:execution-runs", "scope:execution-runs-workflow-contract", "scope:runtime-workloads", "scope:skills-controller", "scope:skills-workflow-contract", "scope:mcp-runtime", "scope:shared", "scope:workflows"] },
            { sourceTag: "scope:cluster-tenants", onlyDependOnLibsWithTags: ["scope:auth", "scope:cluster-tenants", "scope:k8s-api", "scope:shared"] },
			{ sourceTag: "scope:conversation-projection", onlyDependOnLibsWithTags: ["scope:conversation-agent-threads", "scope:conversation-projection", "scope:shared"] },
			{ sourceTag: "scope:conversation-agent-threads", onlyDependOnLibsWithTags: ["scope:conversation-agent-threads", "scope:shared"] },
			{ sourceTag: "scope:conversations", onlyDependOnLibsWithTags: ["scope:agents", "scope:auth", "scope:channel-targets", "scope:conversation-agent-threads", "scope:conversation-projection", "scope:conversations", "scope:execution-admission", "scope:execution-runs", "scope:shared", "scope:workflows"] },
			{ sourceTag: "scope:conversation-assets", onlyDependOnLibsWithTags: ["scope:artifacts", "scope:auth", "scope:conversations", "scope:conversation-assets", "scope:execution-runs", "scope:shared", "scope:web"] },
			{ sourceTag: "scope:personal-configuration", onlyDependOnLibsWithTags: ["scope:agent-services", "scope:agents", "scope:auth", "scope:personal-configuration", "scope:shared"] },
			{ sourceTag: "scope:user-onboarding", onlyDependOnLibsWithTags: ["scope:user-onboarding", "scope:shared"] },
            { sourceTag: "scope:grants", onlyDependOnLibsWithTags: ["scope:auth", "scope:authorization", "scope:grants", "scope:shared"] },
            { sourceTag: "scope:groups", onlyDependOnLibsWithTags: ["scope:auth", "scope:groups", "scope:http", "scope:shared"] },
            { sourceTag: "scope:http", onlyDependOnLibsWithTags: ["scope:http", "scope:shared"] },
            { sourceTag: "scope:channel-targets", onlyDependOnLibsWithTags: ["scope:auth", "scope:authorization", "scope:channel-targets", "scope:membership", "scope:shared"] },
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
            { sourceTag: "scope:mcp", onlyDependOnLibsWithTags: ["scope:auth", "scope:authorization", "scope:identity", "scope:mcp", "scope:mcp-runtime", "scope:runtime-workloads", "scope:shared", "scope:workload-identity", "scope:workflows"] },
            { sourceTag: "scope:membership", onlyDependOnLibsWithTags: ["scope:audit", "scope:auth", "scope:authorization", "scope:membership", "scope:shared"] },
            { sourceTag: "scope:memory", onlyDependOnLibsWithTags: ["scope:artifacts", "scope:memory", "scope:shared"] },
            { sourceTag: "scope:personal-memory", onlyDependOnLibsWithTags: ["scope:personal-memory", "scope:shared"] },
            { sourceTag: "scope:sandbox-execution", onlyDependOnLibsWithTags: ["scope:sandbox-execution", "scope:shared"] },
            { sourceTag: "scope:memory-gateway-client", onlyDependOnLibsWithTags: ["scope:memory-gateway-client", "scope:shared"] },
            { sourceTag: "scope:organization-membership-gateway", onlyDependOnLibsWithTags: ["scope:organization-membership-gateway", "scope:shared"] },
            { sourceTag: "scope:memory-gateway", onlyDependOnLibsWithTags: ["scope:memory-gateway", "scope:shared", "scope:workload-identity"] },
            { sourceTag: "scope:model-routing", onlyDependOnLibsWithTags: ["scope:auth", "scope:cluster-tenants", "scope:http", "scope:model-routing", "scope:shared"] },
			{ sourceTag: "scope:personal-personas", onlyDependOnLibsWithTags: ["scope:auth", "scope:personal-configuration", "scope:personal-personas", "scope:shared"] },
			{ sourceTag: "scope:persona-onboarding", onlyDependOnLibsWithTags: ["scope:persona-onboarding", "scope:shared", "scope:user-onboarding"] },
            { sourceTag: "scope:execution-inputs", onlyDependOnLibsWithTags: ["scope:agent-services", "scope:agents", "scope:artifacts", "scope:authorization", "scope:conversations", "scope:membership", "scope:execution-runs", "scope:execution-inputs", "scope:personal-memory", "scope:shared"] },
            { sourceTag: "scope:execution-admission", onlyDependOnLibsWithTags: ["scope:agent-services", "scope:conversations", "scope:execution-admission", "scope:execution-inputs", "scope:execution-runs", "scope:membership", "scope:shared", "scope:workflows"] },
            { sourceTag: "scope:providers", onlyDependOnLibsWithTags: ["scope:auth", "scope:cluster-tenants", "scope:model-routing", "scope:providers", "scope:shared"] },
            { sourceTag: "scope:retrieval", onlyDependOnLibsWithTags: ["scope:retrieval", "scope:shared"] },
			{ sourceTag: "scope:execution-runs", onlyDependOnLibsWithTags: ["scope:agent-runtime-controller", "scope:agent-runtime-launcher", "scope:agents", "scope:auth", "scope:authorization", "scope:conversations", "scope:execution-runs", "scope:execution-runs-workflow-contract", "scope:shared", "scope:workflows"] },
            { sourceTag: "scope:execution-runs-workflow-contract", onlyDependOnLibsWithTags: ["scope:execution-runs-workflow-contract", "scope:workflows"] },
            { sourceTag: "scope:execution-elicitation", onlyDependOnLibsWithTags: ["scope:agents", "scope:auth", "scope:authorization", "scope:conversations", "scope:execution-elicitation", "scope:execution-runs", "scope:shared"] },
			{ sourceTag: "scope:execution-protocol", onlyDependOnLibsWithTags: ["scope:agent-runtime-continuation", "scope:agent-runtime-stream", "scope:execution-protocol", "scope:execution-inputs", "scope:execution-runs", "scope:execution-elicitation", "scope:personal-configuration", "scope:agents", "scope:auth", "scope:authorization", "scope:sandbox-execution", "scope:memory-gateway-client", "scope:shared"] },
            { sourceTag: "scope:agent-runtime", onlyDependOnLibsWithTags: ["scope:agent-runtime", "scope:agents", "scope:authorization", "scope:execution-protocol", "scope:sandbox-execution", "scope:memory-gateway-client", "scope:shared"] },
			{ sourceTag: "scope:skills", onlyDependOnLibsWithTags: ["scope:artifacts", "scope:auth", "scope:cluster-tenants", "scope:grants", "scope:runtime-workloads", "scope:shared", "scope:skills", "scope:skills-workflow-contract", "scope:workflows"] },
			{ sourceTag: "scope:skills-workflow-contract", onlyDependOnLibsWithTags: ["scope:runtime-workloads", "scope:skills-workflow-contract", "scope:workflows"] },
			{ sourceTag: "scope:artifacts-workflow-contract", onlyDependOnLibsWithTags: ["scope:artifacts-workflow-contract", "scope:runtime-workloads", "scope:shared", "scope:workflows"] },
			{ sourceTag: "scope:spend", onlyDependOnLibsWithTags: ["scope:shared", "scope:spend"] },
			{ sourceTag: "scope:conversation-elicitation", onlyDependOnLibsWithTags: ["scope:conversation-elicitation", "scope:shared", "scope:web"] },
			{ sourceTag: "scope:agent-threads", onlyDependOnLibsWithTags: ["scope:agent-threads", "scope:conversation-assets", "scope:conversation-elicitation", "scope:conversations", "scope:shared", "scope:web"] },
			{ sourceTag: "scope:conversation-workspace", onlyDependOnLibsWithTags: ["scope:agent-threads", "scope:conversation-assets", "scope:conversation-elicitation", "scope:conversation-workspace", "scope:conversations", "scope:shared", "scope:user-onboarding", "scope:web"] },
			{ sourceTag: "scope:web", onlyDependOnLibsWithTags: ["scope:web", "scope:shared"] },
			{ sourceTag: "scope:opencrane-ui", onlyDependOnLibsWithTags: ["scope:agent-threads", "scope:conversation-assets", "scope:conversation-workspace", "scope:organization-members", "scope:persona-onboarding", "scope:shared", "scope:web"] },
            {
              sourceTag: "scope:opencrane",
              onlyDependOnLibsWithTags: [
                "scope:agent-runtime-stream",
                "scope:agent-runtime-continuation",
                "scope:agent-services",
                "scope:api-spec",
                "scope:artifacts",
				"scope:artifacts-workflow-contract",
                "scope:audit",
                "scope:auth",
                "scope:authorization",
                "scope:channel-targets",
                "scope:conversations",
				"scope:conversation-agent-threads",
                "scope:conversation-projection",
                "scope:conversation-assets",
                "scope:execution-admission",
                "scope:execution-protocol",
                "scope:execution-runs",
				"scope:execution-runs-workflow-contract",
                "scope:execution-elicitation",
                "scope:grants",
                "scope:groups",
                "scope:http",
                "scope:identity",
                "scope:mcp",
                "scope:memory-gateway-client",
                "scope:model-routing",
                "scope:membership",
                "scope:organization-members",
                "scope:organization-membership-gateway",
                "scope:personal-configuration",
                "scope:personal-personas",
                "scope:providers",
                "scope:retrieval",
                "scope:sandbox-execution",
                "scope:shared",
                "scope:skills",
				"scope:skills-workflow-contract",
                "scope:spend",
                "scope:user-onboarding",
                "scope:workload-identity",
                "scope:workflows",
              ],
            },
            { sourceTag: "scope:app", onlyDependOnLibsWithTags: ["*"] },
            { sourceTag: "scope:agents", onlyDependOnLibsWithTags: ["scope:agents", "scope:conversations", "scope:shared"] },
			{ sourceTag: "scope:artifacts", onlyDependOnLibsWithTags: ["scope:artifacts", "scope:artifacts-workflow-contract", "scope:auth", "scope:runtime-workloads", "scope:shared", "scope:workflows"] },
            { sourceTag: "type:app", notDependOnLibsWithTags: ["type:app"] },
			{ sourceTag: "type:lib", notDependOnLibsWithTags: ["type:app"] },
			{ sourceTag: "frontend-role:feature", onlyDependOnLibsWithTags: ["frontend-role:elements", "frontend-role:state"] },
			{ sourceTag: "frontend-role:feature-shell", onlyDependOnLibsWithTags: ["frontend-role:core", "frontend-role:elements", "frontend-role:elements-composite", "frontend-role:feature", "frontend-role:state", "frontend-role:state-composite", "layer:contract", "layer:model", "type:platform"] },
			{ sourceTag: "frontend-role:adapter", onlyDependOnLibsWithTags: ["frontend-role:core", "frontend-role:state", "frontend-role:state-composite", "layer:contract", "layer:model"] },
			{ sourceTag: "frontend-role:state", onlyDependOnLibsWithTags: ["frontend-role:core", "layer:contract", "layer:model", "layer:util"] },
			{ sourceTag: "frontend-role:state-composite", onlyDependOnLibsWithTags: ["frontend-role:core", "frontend-role:state", "layer:contract", "layer:model", "layer:util"] },
			{ sourceTag: "frontend-role:elements", onlyDependOnLibsWithTags: ["frontend-role:core", "layer:contract"] },
			{ sourceTag: "frontend-role:elements-composite", onlyDependOnLibsWithTags: ["frontend-role:core", "frontend-role:elements"] },
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
