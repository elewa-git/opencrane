import { AgentRevisionState, ArtifactRevisionState, IntegrationCustodyState, IntegrationState, ModelRoutingScope, SkillRevisionState, SkillState } from "@prisma/client";

import type { InitialRunAuthority, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import type { JsonValue } from "@opencrane/util";

import type { BudgetPolicyInput, BudgetPolicySource, SessionAssemblyCommand, SessionAssemblyLoad, ToolPolicyInput, ToolPolicySource } from "./session-assembly.types.js";

/** Revision-owned tool and budget policy frozen only after every referenced item remains live. */
export class PrismaRevisionToolPolicySource implements ToolPolicySource
{
	/** Resolves the secret-free model route, live integration allowances, and pinned skill artifacts. */
	async load(command: SessionAssemblyCommand, run: InitialRunAuthority, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<ToolPolicyInput>>
	{
		const revision = await transaction.prisma.agentRevision.findFirst({
			where: { id: run.agentRevisionId, agentServiceId: run.agentServiceId, state: AgentRevisionState.Published, agentService: { is: { id: run.agentServiceId, siloId: command.siloId, state: "Active", activeRevisionId: run.agentRevisionId } } },
			include: { modelDefinition: true, integrationAssignments: { include: { integration: true, custodyReference: true } }, skillAssignments: true },
		});
		if (revision === null || !this._isModelAvailable(revision.modelDefinition, command.siloId)) return { outcome: "denied", reason: "tool_policy_unavailable" };
		if (revision.integrationAssignments.some(assignment => assignment.siloId !== command.siloId || assignment.integration.state !== IntegrationState.Active || assignment.custodyReference.state !== IntegrationCustodyState.Ready || assignment.custodyReference.expiresAt.getTime() <= transaction.admittedAtEpochMs || assignment.allowedTools.length === 0 || assignment.allowedTools.some(tool => tool.trim().length === 0) || new Set(assignment.allowedTools).size !== assignment.allowedTools.length)) return { outcome: "denied", reason: "tool_policy_unavailable" };

		const skillRevisionIds = revision.skillAssignments.map(assignment => assignment.skillRevisionId);
		const skills = await transaction.prisma.skillRevision.findMany({ where: { id: { in: skillRevisionIds } }, include: { skill: true } });
		if (skills.length !== skillRevisionIds.length || skills.some(skill => skill.state !== SkillRevisionState.Published || skill.skill.state !== SkillState.Active || skill.skill.siloId !== command.siloId)) return { outcome: "denied", reason: "tool_policy_unavailable" };
		const artifactRevisionIds = [...new Set(skills.map(skill => skill.artifactRevisionId))];
		const artifacts = await transaction.prisma.artifactRevision.findMany({ where: { id: { in: artifactRevisionIds }, state: ArtifactRevisionState.Published, artifact: { is: { siloId: command.siloId, state: "Active" } } }, select: { id: true } });
		if (artifacts.length !== artifactRevisionIds.length) return { outcome: "denied", reason: "tool_policy_unavailable" };

		return { outcome: "loaded", value: { modelRoute: { alias: revision.modelDefinition.publicModelName, modelDefinitionId: revision.modelDefinition.id, litellmModelId: revision.modelDefinition.litellmModelId }, integrationAssignments: revision.integrationAssignments.map(assignment => ({ integrationId: assignment.integrationId, allowedTools: [...assignment.allowedTools] })), skillRevisionIds, artifactRevisionIds } };
	}

	/** Returns whether a model definition is global or belongs to the admission silo. */
	private _isModelAvailable(model: { scope: ModelRoutingScope; clusterTenant: string | null }, siloId: string): boolean
	{
		return model.scope === ModelRoutingScope.Global || (model.scope === ModelRoutingScope.ClusterTenant && model.clusterTenant === siloId);
	}

}

/** Reads immutable revision resource ceilings as compiler-readable per-run budget policy. */
export class PrismaRevisionBudgetPolicySource implements BudgetPolicySource
{
	/** Resolves budget only when the exact active published revision remains current. */
	async load(command: SessionAssemblyCommand, run: InitialRunAuthority, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<BudgetPolicyInput>>
	{
		const revision = await transaction.prisma.agentRevision.findFirst({ where: { id: run.agentRevisionId, agentServiceId: run.agentServiceId, state: AgentRevisionState.Published, agentService: { is: { id: run.agentServiceId, siloId: command.siloId, state: "Active", activeRevisionId: run.agentRevisionId } } }, select: { budget: true } });
		const budget = revision?.budget as Record<string, JsonValue> | undefined;
		if (budget === undefined || !_isPositiveInteger(budget.maxTurns) || !_isPositiveInteger(budget.maxTokens) || !_isPositiveInteger(budget.maxDurationMs)) return { outcome: "denied", reason: "budget_unavailable" };
		const deadline = transaction.admittedAtEpochMs + budget.maxDurationMs;
		if (!Number.isSafeInteger(deadline)) return { outcome: "denied", reason: "budget_unavailable" };
		return { outcome: "loaded", value: { budgetPolicy: { maxModelTurns: budget.maxTurns, maxTotalTokens: budget.maxTokens, wallClockDeadlineEpochMs: deadline } } };
	}
}

/** Returns whether a JSON value is a positive safe-integer resource ceiling. */
function _isPositiveInteger(value: JsonValue | undefined): value is number
{
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
