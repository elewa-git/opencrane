import { AgentRevisionState, ArtifactRevisionState, McpApprovalStatus, McpServerRevisionState, McpServerStatus, ModelRoutingScope, Prisma, SkillRevisionState, SkillState } from "@prisma/client";
import { RunExecutionPersonalMemoryPolicies, RunExecutionPersonaPolicies, type RunAdmissionCommand, type RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import { describe, expect, it, vi } from "vitest";
import { ___DigestCanonicalJson } from "@opencrane/util";

import { PrismaRevisionBudgetPolicyAuthority, PrismaRevisionToolPolicyAuthority } from "../prisma-revision-tool-policy-source";

/** The active managed run facts these tests share. */
const _RUN = { agentServiceId: "service-1", agentRevisionId: "revision-1", executionPolicy: { persona: RunExecutionPersonaPolicies.None, personalMemory: RunExecutionPersonalMemoryPolicies.None }, promptCompilerVersion: "v1", trigger: "interactive" } as const;
/** Fixed session-assembly command scoped to the active managed service. */
const _COMMAND: RunAdmissionCommand = { runId: "run-1", siloId: "silo-1", agentServiceId: "service-1", conversationId: "conversation-1", trigger: "interactive", requestIdempotencyKey: "request-1", messageInput: null, requester: { subjectId: "subject-1", issuer: "issuer-1", authenticatedAt: "2026-09-01T00:00:00.000Z" } };

/** Creates one MCP tool assignment backed by a Ready revision on an active, published server. */
function _McpToolAssignment(overrides: Record<string, unknown> = {})
{
	const inputSchema = { type: "object", additionalProperties: false } as const;
	return { siloId: "silo-1", toolRevision: { id: "mcp-tool-revision-1", name: "calendar.read", description: "Read a calendar", inputSchema, inputSchemaDigest: ___DigestCanonicalJson(inputSchema), serverRevision: { state: McpServerRevisionState.Ready, server: { status: McpServerStatus.Active, approvalStatus: McpApprovalStatus.Published } } }, ...overrides };
}

/** Creates a stand-in transaction holding one revision and the rows it points at. */
function _Transaction(revision: unknown, skills: unknown[] = [], artifacts: unknown[] = []): RunAdmissionTransaction
{
	return { prisma: { mcpToolAdmissionClaim: { upsert: vi.fn().mockResolvedValue({}) }, agentRevision: { findFirst: vi.fn().mockResolvedValue(revision) }, skillRevision: { findMany: vi.fn().mockResolvedValue(skills) }, artifactRevision: { findMany: vi.fn().mockResolvedValue(artifacts) } } as never, admittedAt: "2026-07-26T00:00:00.000Z", admittedAtEpochMs: Date.parse("2026-07-26T00:00:00.000Z") };
}

/** Binds the tool-policy source to the transaction-scoped claim repository used in production. */
function _ToolPolicySource(transaction = _Transaction(_Revision())): PrismaRevisionToolPolicyAuthority
{
	return new PrismaRevisionToolPolicyAuthority(transaction.prisma as never);
}

/** Creates a current revision with one MCP tool and one published skill artifact. */
function _Revision(overrides: Record<string, unknown> = {})
{
	return { modelDefinition: { id: "model-definition-1", siloId: "silo-1", scope: ModelRoutingScope.ClusterTenant, clusterTenant: "silo-1", publicModelName: "tenant-model", litellmModelId: "litellm-deployment-1", generatedOutputCapabilities: [] }, mcpToolAssignments: [_McpToolAssignment()], skillAssignments: [{ skillRevisionId: "skill-revision-1" }], budget: { maxTurns: 4, maxTokens: 1024, maxDurationMs: 60_000 }, ...overrides };
}

/** Creates one same-silo active skill whose selected revision is published. */
function _Skill(overrides: Record<string, unknown> = {})
{
	return { id: "skill-revision-1", artifactRevisionId: "artifact-revision-1", state: SkillRevisionState.Published, skill: { state: SkillState.Active, siloId: "silo-1" }, ...overrides };
}

describe("PrismaRevisionToolPolicyAuthority", function _DescribePrismaRevisionToolPolicyAuthority()
{
	it("freezes the text-response limit with live model, MCP, skill, and artifact references", async function _LoadsLivePolicy()
	{
		const transaction = _Transaction(_Revision(), [_Skill()], [{ id: "artifact-revision-1", state: ArtifactRevisionState.Published }]);
		await expect(_ToolPolicySource(transaction).load(_COMMAND, _RUN, transaction)).resolves.toEqual({ outcome: "loaded", value: { modelDefinitionId: "model-definition-1", modelRoute: { alias: "tenant-model", modelDefinitionId: "model-definition-1", litellmModelId: "litellm-deployment-1", maxOutputTokens: 4096, generatedOutputCapabilities: [] }, mcpTools: [{ toolRevisionId: "mcp-tool-revision-1", name: "calendar.read", description: "Read a calendar", inputSchema: { type: "object", additionalProperties: false }, inputSchemaDigest: ___DigestCanonicalJson({ type: "object", additionalProperties: false }) }], skillRevisionIds: ["skill-revision-1"], artifactRevisionIds: ["artifact-revision-1"] } });
		expect((transaction.prisma as Prisma.TransactionClient).mcpToolAdmissionClaim.upsert).toHaveBeenCalledWith({ where: { agentRevisionId_siloId: { agentRevisionId: "revision-1", siloId: "silo-1" } }, create: { agentRevisionId: "revision-1", siloId: "silo-1", touchedAt: new Date("2026-07-26T00:00:00.000Z") }, update: { touchedAt: new Date("2026-07-26T00:00:00.000Z") } });
	});

	it("denies MCP tools whose revision or catalogue is not execution eligible", async function _DeniesUnavailableMcpTool()
	{
		const discovering = _Revision({ mcpToolAssignments: [_McpToolAssignment({ toolRevision: { ..._McpToolAssignment().toolRevision, serverRevision: { state: McpServerRevisionState.Discovering, server: { status: McpServerStatus.Active, approvalStatus: McpApprovalStatus.Published } } } })] });
		const unpublished = _Revision({ mcpToolAssignments: [_McpToolAssignment({ toolRevision: { ..._McpToolAssignment().toolRevision, serverRevision: { state: McpServerRevisionState.Ready, server: { status: McpServerStatus.Active, approvalStatus: McpApprovalStatus.Approved } } } })] });

		const discoveringTransaction = _Transaction(discovering);
		const unpublishedTransaction = _Transaction(unpublished);
		await expect(_ToolPolicySource(discoveringTransaction).load(_COMMAND, _RUN, discoveringTransaction)).resolves.toEqual({ outcome: "denied", reason: "tool_policy_unavailable" });
		await expect(_ToolPolicySource(unpublishedTransaction).load(_COMMAND, _RUN, unpublishedTransaction)).resolves.toEqual({ outcome: "denied", reason: "tool_policy_unavailable" });
	});

	it("denies a foreign model and an unpublished skill", async function _DeniesUnavailablePolicy()
	{
		const foreign = _Transaction(_Revision({ modelDefinition: { id: "model-definition-1", siloId: "silo-other", scope: ModelRoutingScope.Global, clusterTenant: null, publicModelName: "tenant-model", litellmModelId: "litellm-deployment-1", generatedOutputCapabilities: [] } }), [_Skill()], [{ id: "artifact-revision-1" }]);
		const unpublished = _Transaction(_Revision(), [_Skill({ state: SkillRevisionState.Draft })], [{ id: "artifact-revision-1" }]);
		await expect(_ToolPolicySource(foreign).load(_COMMAND, _RUN, foreign)).resolves.toEqual({ outcome: "denied", reason: "tool_policy_unavailable" });
		await expect(_ToolPolicySource(unpublished).load(_COMMAND, _RUN, unpublished)).resolves.toEqual({ outcome: "denied", reason: "tool_policy_unavailable" });
	});
});

describe("PrismaRevisionBudgetPolicyAuthority", function _DescribePrismaRevisionBudgetPolicyAuthority()
{
	it("preserves the total run ceiling independently of the text-response limit", async function _LoadsBudget()
	{
		const transaction = _Transaction(_Revision({ budget: { maxTurns: 4, maxTokens: 256000, maxDurationMs: 60_000 } }));
		await expect(new PrismaRevisionBudgetPolicyAuthority(transaction.prisma as never).load(_COMMAND, _RUN, transaction)).resolves.toEqual({ outcome: "loaded", value: { budgetPolicy: { maxModelTurns: 4, maxCompletionTokens: 256000, wallClockDeadlineEpochMs: Date.parse("2026-07-26T00:01:00.000Z") } } });
	});

	it("denies malformed budget policy before it can enter an immutable snapshot", async function _DeniesMalformedBudget()
	{
		const transaction = _Transaction(_Revision({ budget: { maxTurns: 0, maxTokens: 1024, maxDurationMs: 60_000 } }));
		await expect(new PrismaRevisionBudgetPolicyAuthority(transaction.prisma as never).load(_COMMAND, _RUN, transaction)).resolves.toEqual({ outcome: "denied", reason: "budget_unavailable" });
	});
});
