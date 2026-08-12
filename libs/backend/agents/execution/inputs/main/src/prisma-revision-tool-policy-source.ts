import { AgentRevisionState, ArtifactRevisionState, IntegrationCustodyState, IntegrationState, ModelRoutingScope, Prisma, SkillRevisionState, SkillState } from "@prisma/client";

import type { InitialRunAuthority, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import { __AreReviewedIntegrationToolDefinitionsValid, type ReviewedIntegrationToolDefinition } from "@opencrane/models/agents";
import { ___CloneCanonicalJson, type JsonValue } from "@opencrane/util";

import type { BudgetPolicyInput, BudgetPolicySource, SessionAssemblyCommand, SessionAssemblyLoad, ToolPolicyInput, ToolPolicySource } from "./session-assembly.types.js";

/**
 * Re-checks a published revision's model route, integrations, skills, and artifacts.
 *
 * Takes row locks before reading, in the same order revocation takes them: revision first, then
 * integration custody. Matching that order is what guarantees a revocation happening at the same
 * moment either completes before this read (and is seen) or waits until the snapshot commits —
 * never lands half-way through and leaves a snapshot naming a revoked integration.
 *
 * The model route it returns names a LiteLLM model alias and carries no provider credentials,
 * because the compiled input reaches the runtime as opaque data.
 *
 * The custody reference it checks is the stored credential handle for an integration; an expired or
 * not-ready one refuses the run rather than letting the runtime attempt a call it cannot authorise.
 *
 * @implements ToolPolicySource
 * @see https://modelcontextprotocol.io/specification/2025-06-18 - MCP, revision 2025-06-18 as
 * pinned by `_MCP_PROTOCOL_VERSION` in server/infra/obot-custody. The `toolDefinitions` this
 * validates are MCP tools reaching the model.
 * @see PrismaRevisionBudgetPolicySource - locks the same revision row in the same order.
 */
export class PrismaRevisionToolPolicySource implements ToolPolicySource
{
	/** Loads the revision's tool policy, keeping only same-silo rows that are still usable inside the admission transaction. */
	async load(command: SessionAssemblyCommand, run: InitialRunAuthority, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<ToolPolicyInput>>
	{
		// 1. Lock the policy rows in the same order revocation locks them, so a custody or revision change lands first and this snapshot sees it.
		await transaction.prisma.$queryRaw(Prisma.sql`
			SELECT revision."id"
			FROM "agent_revisions" revision
			JOIN "agent_services" service ON service."id" = revision."agent_service_id"
			WHERE revision."id" = ${run.agentRevisionId}
				AND revision."agent_service_id" = ${run.agentServiceId}
				AND service."silo_id" = ${command.siloId}
			ORDER BY revision."id"
			FOR UPDATE OF revision
		`);
		await transaction.prisma.$queryRaw(Prisma.sql`
			SELECT custody."id"
			FROM "agent_revision_integration_assignments" assignment
			JOIN "integrations" integration ON integration."id" = assignment."integration_id" AND integration."silo_id" = assignment."silo_id"
			JOIN "integration_custody_references" custody ON custody."id" = assignment."custody_reference_id" AND custody."integration_id" = assignment."integration_id" AND custody."silo_id" = assignment."silo_id"
			WHERE assignment."agent_revision_id" = ${run.agentRevisionId}
			ORDER BY custody."id"
			FOR UPDATE OF assignment, integration, custody
		`);

		// 2. Re-read the model, custody, and skill assignments only after the rows above are locked.
		const revision = await transaction.prisma.agentRevision.findFirst({
			where: {
				id: run.agentRevisionId,
				agentServiceId: run.agentServiceId,
				state: AgentRevisionState.Published,
				agentService: { is: { id: run.agentServiceId, siloId: command.siloId, state: "Active", activeRevisionId: run.agentRevisionId } },
			},
			include: { modelDefinition: true, integrationAssignments: { include: { integration: true, custodyReference: true } }, skillAssignments: true },
		});
		if (revision === null || !_IsModelAvailable(revision.modelDefinition, command.siloId)) return { outcome: "denied", reason: "tool_policy_unavailable" };
		if (revision.integrationAssignments.some(function _IsIntegrationUnavailable(assignment): boolean
		{
			const toolDefinitions = assignment.toolDefinitions as unknown as readonly ReviewedIntegrationToolDefinition[];
			return assignment.siloId !== command.siloId
				|| assignment.integration.state !== IntegrationState.Active
				|| assignment.custodyReference.state !== IntegrationCustodyState.Ready
				|| assignment.custodyReference.expiresAt.getTime() <= transaction.admittedAtEpochMs
				|| !Array.isArray(toolDefinitions)
				|| !__AreReviewedIntegrationToolDefinitionsValid(toolDefinitions);
		})) return { outcome: "denied", reason: "tool_policy_unavailable" };

		// 3. Check every assigned skill and artifact is still in this silo and still published before the snapshot names it.
		const skillRevisionIds = revision.skillAssignments.map(function _SkillRevisionId(assignment): string { return assignment.skillRevisionId; });
		const skills = await transaction.prisma.skillRevision.findMany({ where: { id: { in: skillRevisionIds } }, include: { skill: true } });
		if (skills.length !== skillRevisionIds.length || skills.some(function _IsSkillUnavailable(skill): boolean { return skill.state !== SkillRevisionState.Published || skill.skill.state !== SkillState.Active || skill.skill.siloId !== command.siloId; })) return { outcome: "denied", reason: "tool_policy_unavailable" };
		const artifactRevisionIds = [...new Set(skills.map(function _ArtifactRevisionId(skill): string { return skill.artifactRevisionId; }))];
		const artifacts = await transaction.prisma.artifactRevision.findMany({ where: { id: { in: artifactRevisionIds }, state: ArtifactRevisionState.Published, artifact: { is: { siloId: command.siloId, state: "Active" } } }, select: { id: true } });
		if (artifacts.length !== artifactRevisionIds.length) return { outcome: "denied", reason: "tool_policy_unavailable" };
		return {
			outcome: "loaded",
			value: {
				modelRoute: { alias: revision.modelDefinition.publicModelName, modelDefinitionId: revision.modelDefinition.id, litellmModelId: revision.modelDefinition.litellmModelId },
				integrationAssignments: revision.integrationAssignments.map(function _IntegrationAssignment(assignment) { return { integrationId: assignment.integrationId, toolDefinitions: ___CloneCanonicalJson(assignment.toolDefinitions as unknown as JsonValue) as unknown as readonly ReviewedIntegrationToolDefinition[] }; }),
				skillRevisionIds,
				artifactRevisionIds,
			},
		};
	}
}

/**
 * Reads the revision's resource limits and turns them into the per-run budget the compiler reads.
 *
 * Locks the same revision row as {@link PrismaRevisionToolPolicySource}, in the same order, so the
 * two cannot deadlock and neither can read a revision the other is mid-publish on.
 *
 * Applies no defaults. A budget with a missing or non-positive limit is refused, because a run
 * admitted without a real ceiling could consume tokens without bound. The wall-clock deadline is
 * computed from the server's admission time, so a caller cannot extend its own run.
 *
 * @implements BudgetPolicySource
 */
export class PrismaRevisionBudgetPolicySource implements BudgetPolicySource
{
	/** Refuses a budget policy that is missing, out of date, malformed, or holds values it cannot represent. */
	async load(command: SessionAssemblyCommand, run: InitialRunAuthority, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<BudgetPolicyInput>>
	{
		// 1. Lock the exact revision, matching the tool-policy lock order so a publication change cannot race the budget read.
		await transaction.prisma.$queryRaw(Prisma.sql`
			SELECT revision."id"
			FROM "agent_revisions" revision
			JOIN "agent_services" service ON service."id" = revision."agent_service_id"
			WHERE revision."id" = ${run.agentRevisionId}
				AND revision."agent_service_id" = ${run.agentServiceId}
				AND service."silo_id" = ${command.siloId}
			ORDER BY revision."id"
			FOR UPDATE OF revision
		`);

		// 2. Under that lock, check the revision is still published. Do not trust the revision id an earlier caller passed.
		const revision = await transaction.prisma.agentRevision.findFirst({
			where: { id: run.agentRevisionId, agentServiceId: run.agentServiceId, state: AgentRevisionState.Published, agentService: { is: { siloId: command.siloId, state: "Active", activeRevisionId: run.agentRevisionId } } },
			select: { budget: true },
		});
		if (revision === null) return { outcome: "denied", reason: "budget_unavailable" };

		// 3. Keep only limits that are all present and positive, plus the server's deadline. A caller can never supply a default.
		const budgetPolicy = _ParseBudget(revision.budget as unknown as JsonValue, transaction.admittedAtEpochMs);
		return budgetPolicy === null ? { outcome: "denied", reason: "budget_unavailable" } : { outcome: "loaded", value: { budgetPolicy } };
	}
}

/** Returns whether a model definition is global or belongs exactly to the admission silo. */
function _IsModelAvailable(model: { readonly scope: ModelRoutingScope; readonly clusterTenant: string | null }, siloId: string): boolean
{
	return model.scope === ModelRoutingScope.Global || (model.scope === ModelRoutingScope.ClusterTenant && model.clusterTenant === siloId);
}

/** Turns the stored JSON budget into the snapshot's budget fields, never filling in a default. */
function _ParseBudget(value: JsonValue, admittedAtEpochMs: number): BudgetPolicyInput["budgetPolicy"] | null
{
	if (value === null || typeof value !== "object" || Array.isArray(value) || !Number.isSafeInteger(admittedAtEpochMs)) return null;
	const budget = value as Readonly<Record<string, unknown>>;
	if (!_IsPositiveSafeInteger(budget.maxTurns) || !_IsPositiveSafeInteger(budget.maxTokens) || !_IsPositiveSafeInteger(budget.maxDurationMs)) return null;
	const deadline = admittedAtEpochMs + budget.maxDurationMs;
	if (!Number.isSafeInteger(deadline)) return null;
	return { maxModelTurns: budget.maxTurns, maxTotalTokens: budget.maxTokens, wallClockDeadlineEpochMs: deadline };
}

/** Returns whether a JSON value is a positive safe integer that can be used as a limit. */
function _IsPositiveSafeInteger(value: unknown): value is number
{
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
