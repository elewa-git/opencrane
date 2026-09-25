import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthenticationV1Api } from "@kubernetes/client-node";
import type { PrismaClient } from "@prisma/client";
import { Router, type Express } from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { ProviderEffectCommandExecutor } from "@opencrane/backend/server/gateways/providers";
import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";
import type { IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";
import type { MemoryGatewayClient } from "@opencrane/backend/server/infra/memory-gateway-client";

import { _RegisterInternalRoutes, _RegisterRoutes } from "../routes";
import type { InternalRouteDependencies, ProductRouteDependencies } from "../routes.types";
import type { AgentSandboxReleaseProfileConfig, InternalRuntimeConfig } from "../../configuration/config.types";
import type { McpRuntimeComposition } from "../../workflows/mcp-runtime-composition.types";
import type { McpWorkflowComposition } from "../../workflows/mcp-workflow-composition.types";

/** Keep route construction independent from mounted ArtifactStore credentials. */
vi.mock("@opencrane/backend/server/agents/artifacts", async function _MockArtifactServiceFactories(importOriginal)
{
	const actual = await importOriginal<typeof import("@opencrane/backend/server/agents/artifacts")>();
	return {
		...actual,
		_CreateArtifactPreprocessOutputBroker: function _CreateArtifactPreprocessOutputBroker() { return {}; },
		_CreateArtifactPreprocessSourceBroker: function _CreateArtifactPreprocessSourceBroker() { return {}; },
		_CreateArtifactScanSourceBroker: function _CreateArtifactScanSourceBroker() { return {}; },
		_CreatePublishedArtifactReader: function _CreatePublishedArtifactReader() { return {}; },
	};
});

/** Keep the conversation asset routes independent from ArtifactStore settings and mounted keys. */
vi.mock("@opencrane/backend/server/conversation-assets", async function _MockConversationAssetAuthority(importOriginal)
{
	const actual = await importOriginal<typeof import("@opencrane/backend/server/conversation-assets")>();
	return { ...actual, _CreateConversationAssetAuthority: function _CreateConversationAssetAuthority() { return {}; } };
});

/** Temporary directory holding the keyring file that conversation routes read at construction. */
const _keyringDirectory = mkdtempSync(join(tmpdir(), "opencrane-routes-"));

beforeAll(function _SetDeploymentEnvironment()
{
	vi.stubEnv("OPENCRANE_MEMBERSHIP_MODE", "standalone");
	vi.stubEnv("OPENCRANE_MEMBERSHIP_MAX_STALENESS_MS", "60000");
	vi.stubEnv("OPENCRANE_SILO_ID", "silo-1");
	vi.stubEnv("OIDC_ISSUER_URL", "https://issuer.route-test.example");
});

afterAll(function _RemoveTestState()
{
	vi.unstubAllEnvs();
	rmSync(_keyringDirectory, { recursive: true, force: true });
});

/** One observed mount, written as "<method> <path>". */
type RecordedMount = string;

/** Build an Express stand-in that records each mount in the order routes.ts registers it. */
function _RecordingApp(): { readonly app: Express; readonly mounts: RecordedMount[] }
{
	const mounts: RecordedMount[] = [];
	const app = {
		use: function _RecordUse(path: string) { mounts.push(`use ${path}`); },
		get: function _RecordGet(path: string) { mounts.push(`get ${path}`); },
	};
	return { app: app as unknown as Express, mounts };
}

/** Write a valid one-key keyring so the conversation routes can derive their ciphers. */
function _WriteKeyring(): string
{
	const path = join(_keyringDirectory, "keyring.json");
	writeFileSync(path, JSON.stringify({ currentKeyId: "route-test", keys: { "route-test": randomBytes(32).toString("base64url") } }));
	return path;
}

/** Workflow engine stand-in; building the routes only registers tasks on it. */
function _WorkflowEngine(): IWorkflowEngine
{
	return {
		declare: vi.fn(),
		register: vi.fn(),
		spawn: vi.fn(),
		emitEvent: vi.fn(),
		emitEventInTransaction: vi.fn(),
		cancel: vi.fn(),
	} as unknown as IWorkflowEngine;
}

/** MCP job authorities; route construction only keeps references to them. */
function _McpWorkflows(): McpWorkflowComposition
{
	return { remoteClient: {}, execution: _WorkflowEngine(), unitOfWork: {}, runtime: {}, eraProbeWorkflow: {}, ociImageValidationWorkflow: {}, ociImageArtifacts: {} } as unknown as McpWorkflowComposition;
}

/** Inert tool runtime whose routers only need to exist. */
function _McpRuntime(): McpRuntimeComposition
{
	return { connections: { connect: vi.fn(), revoke: vi.fn(), uninstall: vi.fn() }, toolDispatch: { tryExecute: vi.fn(), settleExhausted: vi.fn() }, authority: {} as McpRuntimeComposition["authority"], invocationParticipants: {} as McpRuntimeComposition["invocationParticipants"], admitToolInvocationInTransaction: vi.fn(), promotion: Router(), controller: Router(), companion: Router(), taskWorkflow: {} as McpRuntimeComposition["taskWorkflow"] };
}

/** Release profile values used only as labels during construction. */
function _SandboxProfile(): AgentSandboxReleaseProfileConfig
{
	return { profileRevisionId: "sha256:route-test", profileName: "route-test", warmPoolName: "route-test-pool", namespace: "route-test-sandboxes", serviceAccountName: "route-test-computer", leaseTtlMilliseconds: 60_000, maximumTurnCostUsdMicros: 1_000_000 };
}

/** Workload configuration with every optional worker switched on, so every optional route mounts. */
function _InternalConfig(): InternalRuntimeConfig
{
	return {
		artifactScannerEnabled: true,
		artifactScannerClaimLeaseMilliseconds: 300_000,
		artifactScannerNamespace: "artifact-scanners",
		artifactPreprocessorEnabled: true,
		artifactPreprocessorMaximumOutputBytes: 1_024,
		artifactPreprocessorNamespace: "artifact-preprocessors",
		mcpCompanionClaimLeaseMilliseconds: 30_000,
		mcpControllerClaimLeaseMilliseconds: 30_000,
		mcpExecutorNamespace: "mcp-executors",
		memoryGatewayTimeoutMilliseconds: 30_000,
		memoryGatewayTokenPath: "/var/run/opencrane/memory-gateway/token",
		memoryGatewayUrl: "http://opencrane-memory-gateway.default.svc.cluster.local:8080",
		serverNamespace: "opencrane-server",
		skillAuthoringNamespace: "skill-authoring",
		siloId: "silo-1",
	};
}

/** Product services with a real keyring file and inert everything else. */
function _ProductDependencies(): ProductRouteDependencies
{
	return {
		prisma: {} as PrismaClient,
		conversations: { history: {} as HistoryStore, keyringPath: _WriteKeyring(), sandboxProfile: _SandboxProfile(), memoryWorkflow: { siloId: "silo-1", gateway: {} as MemoryGatewayClient }, artifactScannerEnabled: false },
		tools: { workflows: _McpWorkflows(), runtime: _McpRuntime() },
		providerEffects: {} as ProviderEffectCommandExecutor,
	};
}

/** Workload services with every optional worker switched on. */
function _InternalDependencies(): InternalRouteDependencies
{
	return { prisma: {} as PrismaClient, authApi: {} as AuthenticationV1Api, config: _InternalConfig(), mcpRuntime: _McpRuntime(), generatedFiles: { scanAssets: vi.fn() }, workflowExecution: _WorkflowEngine() };
}

describe("route catalogue", function _Suite()
{
	it("mounts the product routes in their fixed order", function _ProductRouteOrder()
	{
		const { app, mounts } = _RecordingApp();
		_RegisterRoutes(app, Router(), _ProductDependencies());

		expect(mounts).toEqual([
			"use /api/v1/audit",
			"use /api/v1/groups",
			"use /api/v1/organization/members",
			"use /api/v1/resource-shares",
			"use /api/v1/organization/company-assistant",
			"use /api/v1/skills",
			"use /api/v1/skills",
			"use /api/v1/me/onboarding",
			"use /api/v1/me/assets",
			"use /api/v1/me/persona",
			"use /api/v1/me/configuration",
			"use /api/v1/me/agent/tools",
			"use /api/v1/me/runs",
			"use /api/v1/me/conversations",
			"use /api/v1/me/conversations",
			"use /api/v1/me/memory",
			"use /api/v1/me/conversations",
			"use /api/v1/me/conversations",
			"use /api/v1/me/activity",
			"use /api/v1/mcp",
			"use /api/v1/mcp",
			"use /api/v1/mcp",
			"use /api/v1/mcp",
			"use /api/v1/model-routing/defaults",
			"use /api/v1/providers/byok",
			"use /api/v1/models",
			"use /api/v1/third-party-sources",
			"use /api/v1/ai-budget",
			"use /api/v1/token-usage",
			"use /api/v1/openapi.json",
		]);
	});

	it("mounts the workload routes in their fixed order", function _InternalRouteOrder()
	{
		const { app, mounts } = _RecordingApp();
		_RegisterInternalRoutes(app, _InternalDependencies());

		expect(mounts).toEqual([
			"use /api/internal/agent-controller",
			"use /api/internal/agent-controller",
			"use /api/internal/agent-controller",
			"use /api/internal/skill-authoring",
			"use /api/internal/mcp-executor",
			"use /api/internal/artifact-preprocessor",
			"use /api/internal/artifact-scanner",
		]);
	});
});
