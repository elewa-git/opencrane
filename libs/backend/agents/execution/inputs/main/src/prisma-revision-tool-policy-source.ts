import { AgentRevisionState, ArtifactRevisionState, IntegrationCustodyState, IntegrationState, ModelRoutingScope, Prisma, SkillRevisionState, SkillState } from "@prisma/client";

import type { InitialRunAuthority, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import type { JsonValue } from "@opencrane/util";

import type { BudgetPolicyInput, BudgetPolicySource, SessionAssemblyCommand, SessionAssemblyLoad, ToolPolicyInput, ToolPolicySource } from "./session-assembly.types.js";

/** Revalidates a published revision's secret-free model route, integration allowances, skills, and artifacts. */
export class PrismaRevisionToolPolicySource implements ToolPolicySource
{
	/** Loads only current same-silo policy references that remain executable at the final admission fence. */
	async load(command: SessionAssemblyCommand, run: InitialRunAuthority, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<ToolPolicyInput>>
	{
		// 1. Lock policy rows in revocation order, so a custody or revision change wins before a snapshot commits.
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

		// 2. Re-read current model, custody, and skill assignments only after their mutable authority rows are fenced.
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
			return assignment.siloId !== command.siloId
				|| assignment.integration.state !== IntegrationState.Active
				|| assignment.custodyReference.state !== IntegrationCustodyState.Ready
				|| assignment.custodyReference.expiresAt.getTime() <= transaction.admittedAtEpochMs
				|| assignment.allowedTools.length === 0
				|| assignment.allowedTools.some(function _IsBlankTool(tool): boolean { return tool.trim().length === 0; })
				|| new Set(assignment.allowedTools).size !== assignment.allowedTools.length;
		})) return { outcome: "denied", reason: "tool_policy_unavailable" };

		// 3. Verify every assigned skill and artifact remains same-silo and published before naming it in immutable input.
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
				integrationAssignments: revision.integrationAssignments.map(function _IntegrationAssignment(assignment) { return { integrationId: assignment.integrationId, allowedTools: [...assignment.allowedTools] }; }),
				skillRevisionIds,
				artifactRevisionIds,
			},
		};
	}
}

/** Reads immutable revision resource ceilings as compiler-readable per-run budget policy. */
export class PrismaRevisionBudgetPolicySource implements BudgetPolicySource
{
	/** Refuses absent, stale, malformed, or unrepresentable revision budget policy. */
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

		// 2. Revalidate published state beneath that lock, not merely the revision ID passed by an earlier caller.
		const revision = await transaction.prisma.agentRevision.findFirst({
			where: { id: run.agentRevisionId, agentServiceId: run.agentServiceId, state: AgentRevisionState.Published, agentService: { is: { siloId: command.siloId, state: "Active", activeRevisionId: run.agentRevisionId } } },
			select: { budget: true },
		});
		if (revision === null) return { outcome: "denied", reason: "budget_unavailable" };

		// 3. Project only complete positive limits and the server-owned deadline; callers cannot supply defaults.
		const budgetPolicy = _ParseBudget(revision.budget as unknown as JsonValue, transaction.admittedAtEpochMs);
		return budgetPolicy === null ? { outcome: "denied", reason: "budget_unavailable" } : { outcome: "loaded", value: { budgetPolicy } };
	}
}

/** Returns whether a model definition is global or belongs exactly to the admission silo. */
function _IsModelAvailable(model: { readonly scope: ModelRoutingScope; readonly clusterTenant: string | null }, siloId: string): boolean
{
	return model.scope === ModelRoutingScope.Global || (model.scope === ModelRoutingScope.ClusterTenant && model.clusterTenant === siloId);
}

/** Parses a persisted JSON budget into the snapshot policy vocabulary without applying implicit defaults. */
function _ParseBudget(value: JsonValue, admittedAtEpochMs: number): BudgetPolicyInput["budgetPolicy"] | null
{
	if (value === null || typeof value !== "object" || Array.isArray(value) || !Number.isSafeInteger(admittedAtEpochMs)) return null;
	const budget = value as Readonly<Record<string, unknown>>;
	if (!_IsPositiveSafeInteger(budget.maxTurns) || !_IsPositiveSafeInteger(budget.maxTokens) || !_IsPositiveSafeInteger(budget.maxDurationMs)) return null;
	const deadline = admittedAtEpochMs + budget.maxDurationMs;
	if (!Number.isSafeInteger(deadline)) return null;
	return { maxModelTurns: budget.maxTurns, maxTotalTokens: budget.maxTokens, wallClockDeadlineEpochMs: deadline };
}

/** Returns whether a JSON field is an explicit positive safe-integer resource ceiling. */
function _IsPositiveSafeInteger(value: unknown): value is number
{
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
