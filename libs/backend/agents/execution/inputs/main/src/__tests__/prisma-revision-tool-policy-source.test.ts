import { AgentRevisionState, ArtifactRevisionState, IntegrationCustodyState, IntegrationState, McpApprovalStatus, McpServerRevisionState, McpServerStatus, ModelRoutingScope, SkillRevisionState, SkillState } from "@prisma/client";
import type { RunAdmissionCommand, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import { describe, expect, it, vi } from "vitest";
import { AgentServiceKinds } from "@opencrane/models/agents";
import { ___DigestCanonicalJson } from "@opencrane/util";

import { PrismaMcpToolAdmissionClaimRepository } from "../prisma-mcp-tool-admission-claim-repository";
import { PrismaRevisionBudgetPolicySource, PrismaRevisionToolPolicySource } from "../prisma-revision-tool-policy-source";

/** The active managed run facts these tests share. */
const _RUN = { agentServiceId: "service-1", agentRevisionId: "revision-1", agentKind: AgentServiceKinds.Managed, effectiveContractDigest: `sha256:${"a".repeat(64)}`, promptCompilerVersion: "v1", trigger: "managed_invocation", delegatedUserId: null, rootRunId: "run-1", parentRunId: null } as const;
/** Fixed session-assembly command scoped to the active managed service. */
const _COMMAND: RunAdmissionCommand = { runId: "run-1", siloId: "silo-1", agentServiceId: "service-1", conversationId: null, identityKind: "service", trigger: "managed_invocation", requestIdempotencyKey: "request-1" };

/** Reviewed tool definition returned by the revision authority. */
function _Tool(name = "calendar.read")
{
	const parametersSchema = { type: "object", additionalProperties: false } as const;
	return { name, description: "Read a calendar", parametersSchema, parametersSchemaDigest: ___DigestCanonicalJson(parametersSchema) };
}

/** Creates one exact MCP tool assignment with a Ready and published active server. */
function _McpToolAssignment(overrides: Record<string, unknown> = {})
{
	const inputSchema = { type: "object", additionalProperties: false } as const;
	return { siloId: "silo-1", toolRevision: { id: "mcp-tool-revision-1", name: "calendar.read", description: "Read a calendar", inputSchema, inputSchemaDigest: ___DigestCanonicalJson(inputSchema), serverRevision: { state: McpServerRevisionState.Ready, server: { status: McpServerStatus.Active, approvalStatus: McpApprovalStatus.Published } } }, ...overrides };
}

/** Creates a stand-in transaction holding one revision and the rows it points at. */
function _Transaction(revision: unknown, skills: unknown[] = [], artifacts: unknown[] = []): RunAdmissionTransaction
{
	return { prisma: { $queryRaw: vi.fn().mockResolvedValue([]), mcpToolAdmissionClaim: { upsert: vi.fn().mockResolvedValue({}) }, agentRevision: { findFirst: vi.fn().mockResolvedValue(revision) }, skillRevision: { findMany: vi.fn().mockResolvedValue(skills) }, artifactRevision: { findMany: vi.fn().mockResolvedValue(artifacts) } } as never, admittedAt: "2026-07-26T00:00:00.000Z", admittedAtEpochMs: Date.parse("2026-07-26T00:00:00.000Z") };
}

/** Binds the tool-policy source to the transaction-scoped claim repository used in production. */
function _ToolPolicySource(): PrismaRevisionToolPolicySource
{
	return new PrismaRevisionToolPolicySource(function _CreateClaim(transaction): PrismaMcpToolAdmissionClaimRepository { return new PrismaMcpToolAdmissionClaimRepository(transaction.prisma as never); });
}

/** Creates a current revision with one live integration and one published skill artifact. */
function _Revision(overrides: Record<string, unknown> = {})
{
	return { modelDefinition: { id: "model-definition-1", scope: ModelRoutingScope.ClusterTenant, clusterTenant: "silo-1", publicModelName: "tenant-model", litellmModelId: "litellm-deployment-1" }, integrationAssignments: [{ integrationId: "integration-1", siloId: "silo-1", toolDefinitions: [_Tool()], integration: { state: IntegrationState.Active }, custodyReference: { state: IntegrationCustodyState.Ready, expiresAt: new Date("2026-07-27T00:00:00.000Z") } }], mcpToolAssignments: [_McpToolAssignment()], skillAssignments: [{ skillRevisionId: "skill-revision-1" }], budget: { maxTurns: 4, maxTokens: 1024, maxDurationMs: 60_000 }, ...overrides };
}

/** Creates one same-silo active skill whose selected revision is published. */
function _Skill(overrides: Record<string, unknown> = {})
{
	return { id: "skill-revision-1", artifactRevisionId: "artifact-revision-1", state: SkillRevisionState.Published, skill: { state: SkillState.Active, siloId: "silo-1" }, ...overrides };
}

describe("PrismaRevisionToolPolicySource", function _DescribePrismaRevisionToolPolicySource()
{
	it("locks and freezes only live model, custody, skill, and artifact references", async function _LoadsLivePolicy()
	{
		const transaction = _Transaction(_Revision(), [_Skill()], [{ id: "artifact-revision-1", state: ArtifactRevisionState.Published }]);
		await expect(_ToolPolicySource().load(_COMMAND, _RUN, transaction)).resolves.toEqual({ outcome: "loaded", value: { modelRoute: { alias: "tenant-model", modelDefinitionId: "model-definition-1", litellmModelId: "litellm-deployment-1" }, integrationAssignments: [{ integrationId: "integration-1", toolDefinitions: [_Tool()] }], mcpTools: [{ toolRevisionId: "mcp-tool-revision-1", name: "calendar.read", description: "Read a calendar", inputSchema: { type: "object", additionalProperties: false }, inputSchemaDigest: ___DigestCanonicalJson({ type: "object", additionalProperties: false }) }], skillRevisionIds: ["skill-revision-1"], artifactRevisionIds: ["artifact-revision-1"] } });
		expect(transaction.prisma.$queryRaw).toHaveBeenCalledTimes(2);
		expect(transaction.prisma.mcpToolAdmissionClaim.upsert).toHaveBeenCalledWith({ where: { agentRevisionId_siloId: { agentRevisionId: "revision-1", siloId: "silo-1" } }, create: { agentRevisionId: "revision-1", siloId: "silo-1", touchedAt: new Date("2026-07-26T00:00:00.000Z") }, update: { touchedAt: new Date("2026-07-26T00:00:00.000Z") } });
	});

	it("denies MCP tools whose revision or catalogue is not execution eligible", async function _DeniesUnavailableMcpTool()
	{
		const discovering = _Revision({ mcpToolAssignments: [_McpToolAssignment({ toolRevision: { ..._McpToolAssignment().toolRevision, serverRevision: { state: McpServerRevisionState.Discovering, server: { status: McpServerStatus.Active, approvalStatus: McpApprovalStatus.Published } } } })] });
		const unpublished = _Revision({ mcpToolAssignments: [_McpToolAssignment({ toolRevision: { ..._McpToolAssignment().toolRevision, serverRevision: { state: McpServerRevisionState.Ready, server: { status: McpServerStatus.Active, approvalStatus: McpApprovalStatus.Approved } } } })] });

		await expect(_ToolPolicySource().load(_COMMAND, _RUN, _Transaction(discovering))).resolves.toEqual({ outcome: "denied", reason: "tool_policy_unavailable" });
		await expect(_ToolPolicySource().load(_COMMAND, _RUN, _Transaction(unpublished))).resolves.toEqual({ outcome: "denied", reason: "tool_policy_unavailable" });
	});

	it("denies expired custody, a foreign model, and an unpublished skill", async function _DeniesUnavailablePolicy()
	{
		const expired = _Revision({ integrationAssignments: [{ integrationId: "integration-1", siloId: "silo-1", toolDefinitions: [_Tool()], integration: { state: IntegrationState.Active }, custodyReference: { state: IntegrationCustodyState.Ready, expiresAt: new Date("2026-07-25T00:00:00.000Z") } }] });
		await expect(_ToolPolicySource().load(_COMMAND, _RUN, _Transaction(expired))).resolves.toEqual({ outcome: "denied", reason: "tool_policy_unavailable" });
		await expect(_ToolPolicySource().load(_COMMAND, _RUN, _Transaction(_Revision({ modelDefinition: { id: "model-definition-1", scope: ModelRoutingScope.ClusterTenant, clusterTenant: "silo-other", publicModelName: "tenant-model", litellmModelId: "litellm-deployment-1" } }), [_Skill()], [{ id: "artifact-revision-1" }]))).resolves.toEqual({ outcome: "denied", reason: "tool_policy_unavailable" });
		await expect(_ToolPolicySource().load(_COMMAND, _RUN, _Transaction(_Revision(), [_Skill({ state: SkillRevisionState.Draft })], [{ id: "artifact-revision-1" }]))).resolves.toEqual({ outcome: "denied", reason: "tool_policy_unavailable" });
	});
});

describe("PrismaRevisionBudgetPolicySource", function _DescribePrismaRevisionBudgetPolicySource()
{
	it("freezes complete positive ceilings into a server-time deadline", async function _LoadsBudget()
	{
		await expect(new PrismaRevisionBudgetPolicySource().load(_COMMAND, _RUN, _Transaction(_Revision()))).resolves.toEqual({ outcome: "loaded", value: { budgetPolicy: { maxModelTurns: 4, maxTotalTokens: 1024, wallClockDeadlineEpochMs: Date.parse("2026-07-26T00:01:00.000Z") } } });
	});

	it("denies malformed budget policy before it can enter an immutable snapshot", async function _DeniesMalformedBudget()
	{
		await expect(new PrismaRevisionBudgetPolicySource().load(_COMMAND, _RUN, _Transaction(_Revision({ budget: { maxTurns: 0, maxTokens: 1024, maxDurationMs: 60_000 } })))).resolves.toEqual({ outcome: "denied", reason: "budget_unavailable" });
	});
});
