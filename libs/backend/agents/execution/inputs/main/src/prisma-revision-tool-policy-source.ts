import { AgentRevisionState, ArtifactRevisionState, McpApprovalStatus, McpServerRevisionState, McpServerStatus, ModelRoutingScope, Prisma, SkillRevisionState, SkillState } from "@prisma/client";

import type { InitialRunAuthority, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import { GeneratedOutputCapability } from "@opencrane/contracts";
import { ___CloneCanonicalJson, type JsonValue } from "@opencrane/util";

import type { BudgetPolicyInput, BudgetPolicySource, SessionAssemblyCommand, SessionAssemblyLoad, ToolPolicyInput, ToolPolicySource } from "./session-assembly.types";
import { __AreRunInputSnapshotMcpToolsValid } from "./mcp-tool-snapshot.validator";
import { PrismaMcpToolAdmissionClaimRepository } from "./prisma-mcp-tool-admission-claim-repository";

/**
 * Re-checks a published revision's model route, selected MCP tool revisions, skills, and artifacts.
 *
 * Updates the revision's MCP admission claim before reading. The surrounding Serializable admission
 * transaction makes a concurrent publication change conflict with this snapshot instead of requiring
 * handwritten row locks.
 *
 * The model route it returns names a LiteLLM model alias and carries no provider credentials,
 * because the compiled input reaches the runtime as opaque data.
 *
 * @implements ToolPolicySource
 * @see PrismaRevisionBudgetPolicyAuthority - reads the same revision in the admission transaction.
 */
export class PrismaRevisionToolPolicyAuthority implements ToolPolicySource
{
	/** Exact run-admission transaction that owns policy and claim reads. */
	private readonly prisma: Prisma.TransactionClient;

	/** Binds every policy read and claim write to one transaction. */
	constructor(prisma: Prisma.TransactionClient)
	{
		this.prisma = prisma;
	}

	/** Loads the revision's tool policy, keeping only same-silo rows that are still usable inside the admission transaction. */
	async load(command: SessionAssemblyCommand, run: InitialRunAuthority, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<ToolPolicyInput>>
	{
		// 1. Touch the claim in the same Serializable admission transaction as the immutable snapshot.
		const claim = new PrismaMcpToolAdmissionClaimRepository(this.prisma);
		await claim.touch(run.agentRevisionId, command.siloId, new Date(transaction.admittedAt));

		// 2. Read the model, MCP, and skill assignments after the claim has joined the transaction snapshot.
		const revision = await this.prisma.agentRevision.findFirst({
			where: {
				id: run.agentRevisionId,
				siloId: command.siloId,
				agentServiceId: run.agentServiceId,
				state: AgentRevisionState.Published,
				agentService: { is: { id: run.agentServiceId, siloId: command.siloId, state: "Active", activeRevisionId: run.agentRevisionId } },
			},
			include: { modelDefinition: true, mcpToolAssignments: { include: { toolRevision: { include: { serverRevision: { include: { server: true } } } } } }, skillAssignments: true },
		});
		if (revision === null || !_IsModelAvailable(revision.modelDefinition, command.siloId) || !_GeneratedOutputCapabilitiesValid(revision.modelDefinition.generatedOutputCapabilities))
			return { outcome: "denied", reason: "tool_policy_unavailable" };
		const mcpTools = revision.mcpToolAssignments.map(function _McpTool(assignment)
		{
			return {
				toolRevisionId: assignment.toolRevision.id,
				name: assignment.toolRevision.name,
				description: assignment.toolRevision.description,
				inputSchema: ___CloneCanonicalJson(assignment.toolRevision.inputSchema as unknown as JsonValue),
				inputSchemaDigest: assignment.toolRevision.inputSchemaDigest,
			};
		});
		if (revision.mcpToolAssignments.some(function _UnavailableMcpTool(assignment): boolean
		{
			return assignment.siloId !== command.siloId
				|| assignment.toolRevision.serverRevision.state !== McpServerRevisionState.Ready
				|| assignment.toolRevision.serverRevision.server.status !== McpServerStatus.Active
				|| assignment.toolRevision.serverRevision.server.approvalStatus !== McpApprovalStatus.Published;
		}) || !__AreRunInputSnapshotMcpToolsValid(mcpTools))
			return { outcome: "denied", reason: "tool_policy_unavailable" };

		// 3. Check every assigned skill and artifact is still in this silo and still published before the snapshot names it.
		const skillRevisionIds = revision.skillAssignments.map(function _SkillRevisionId(assignment): string { return assignment.skillRevisionId; });
		const skills = await this.prisma.skillRevision.findMany({ where: { id: { in: skillRevisionIds } }, include: { skill: true } });
		if (skills.length !== skillRevisionIds.length || skills.some(function _IsSkillUnavailable(skill): boolean { return skill.state !== SkillRevisionState.Published || skill.skill.state !== SkillState.Active || skill.skill.siloId !== command.siloId; }))
			return { outcome: "denied", reason: "tool_policy_unavailable" };
		const artifactRevisionIds = [...new Set(skills.map(function _ArtifactRevisionId(skill): string { return skill.artifactRevisionId; }))];
		const artifacts = await this.prisma.artifactRevision.findMany({ where: { id: { in: artifactRevisionIds }, state: ArtifactRevisionState.Published, artifact: { is: { siloId: command.siloId, state: "Active" } } }, select: { id: true } });
		if (artifacts.length !== artifactRevisionIds.length)
			return { outcome: "denied", reason: "tool_policy_unavailable" };
		return {
			outcome: "loaded",
			value: {
				modelDefinitionId: revision.modelDefinition.id,
				modelRoute: { alias: revision.modelDefinition.publicModelName, modelDefinitionId: revision.modelDefinition.id, litellmModelId: revision.modelDefinition.litellmModelId, generatedOutputCapabilities: [...revision.modelDefinition.generatedOutputCapabilities].sort() },
				mcpTools,
				skillRevisionIds,
				artifactRevisionIds,
			},
		};
	}
}

/**
 * Reads the revision's resource limits and turns them into the per-run budget the compiler reads.
 *
 * Reads the same revision as the tool-policy authority inside the surrounding
 * Serializable admission transaction, so a concurrent publication change cannot commit unnoticed.
 *
 * Applies no defaults. A budget with a missing or non-positive limit is refused, because a run
 * admitted without a real ceiling could consume tokens without bound. The wall-clock deadline is
 * computed from the server's admission time, so a caller cannot extend its own run.
 *
 * @implements BudgetPolicySource
 */
export class PrismaRevisionBudgetPolicyAuthority implements BudgetPolicySource
{
	/** Bind budget reads to the exact run-admission transaction. */
	constructor(private readonly prisma: Prisma.TransactionClient) {}

	/** Refuses a budget policy that is missing, out of date, malformed, or holds values it cannot represent. */
	async load(command: SessionAssemblyCommand, run: InitialRunAuthority, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<BudgetPolicyInput>>
	{
		// 1. Re-check that the exact revision is still published. Do not trust the revision id an earlier caller passed.
		const revision = await this.prisma.agentRevision.findFirst({
			where: { id: run.agentRevisionId, siloId: command.siloId, agentServiceId: run.agentServiceId, state: AgentRevisionState.Published, agentService: { is: { siloId: command.siloId, state: "Active", activeRevisionId: run.agentRevisionId } } },
			select: { budget: true },
		});
		if (revision === null)
			return { outcome: "denied", reason: "budget_unavailable" };

		// 2. Keep only limits that are all present and positive, plus the server's deadline. A caller can never supply a default.
		const budgetPolicy = _ParseBudget(revision.budget as unknown as JsonValue, transaction.admittedAtEpochMs);
		return budgetPolicy === null ? { outcome: "denied", reason: "budget_unavailable" } : { outcome: "loaded", value: { budgetPolicy } };
	}
}

/** Returns whether a model definition is global or belongs exactly to the admission silo. */
function _IsModelAvailable(model: { readonly siloId: string; readonly scope: ModelRoutingScope; readonly clusterTenant: string | null }, siloId: string): boolean
{
	return model.siloId === siloId && ((model.scope === ModelRoutingScope.Global && model.clusterTenant === null) || (model.scope === ModelRoutingScope.ClusterTenant && model.clusterTenant === siloId));
}

/** Reject model capabilities outside the closed compiled-runtime contract. */
function _GeneratedOutputCapabilitiesValid(values: readonly string[]): boolean
{
	return new Set(values).size === values.length && values.every(function _Known(value): boolean { return value === GeneratedOutputCapability.ImagePng || value === GeneratedOutputCapability.CodeExecutionFiles; });
}

/** Turns the stored JSON budget into the snapshot's budget fields, never filling in a default. */
function _ParseBudget(value: JsonValue, admittedAtEpochMs: number): BudgetPolicyInput["budgetPolicy"] | null
{
	if (value === null || typeof value !== "object" || Array.isArray(value) || !Number.isSafeInteger(admittedAtEpochMs))
		return null;
	const budget = value as Readonly<Record<string, unknown>>;
	if (!_IsPositiveSafeInteger(budget.maxTurns) || !_IsPositiveSafeInteger(budget.maxTokens) || !_IsPositiveSafeInteger(budget.maxDurationMs))
		return null;
	const deadline = admittedAtEpochMs + budget.maxDurationMs;
	if (!Number.isSafeInteger(deadline))
		return null;
	return { maxModelTurns: budget.maxTurns, maxCompletionTokens: budget.maxTokens, wallClockDeadlineEpochMs: deadline };
}

/** Returns whether a JSON value is a positive safe integer that can be used as a limit. */
function _IsPositiveSafeInteger(value: unknown): value is number
{
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
