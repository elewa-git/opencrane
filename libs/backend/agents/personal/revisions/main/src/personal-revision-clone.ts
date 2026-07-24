import { AgentRevisionState, Prisma } from "@prisma/client";
import { __DigestCanonicalJson } from "@opencrane/backend/server/iam/authorization";
import type { JsonValue } from "@opencrane/util";

import type { PersonalRevisionCloneSource } from "./personal-configuration-materializer.types.js";

/** Complete immutable assignment shape loaded before cloning one personal AgentRevision. */
export const _PERSONAL_REVISION_INCLUDE = { skillAssignments: true, integrationAssignments: true, scopeAttachments: true } as const;

/** Returns whether persisted JSON carries every positive, safe per-run ceiling required for publication. */
export function __IsValidPersonalRevisionBudget(value: Prisma.JsonValue): boolean
{
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	const budget = value as Record<string, unknown>;
	return _isPositiveSafeInteger(budget.maxTurns)
		&& _isPositiveSafeInteger(budget.maxTokens)
		&& _isPositiveSafeInteger(budget.maxCostUsdMicros)
		&& _isPositiveSafeInteger(budget.maxDurationMs);
}

/** Returns whether one persisted JSON value is a finite, positive safe integer. */
function _isPositiveSafeInteger(value: unknown): value is number
{
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** Builds a draft clone changing only the supplied immutable persona and model coordinates. */
export function __CreatePersonalRevisionCloneData(head: PersonalRevisionCloneSource, target: { readonly modelDefinitionId: string; readonly personaRevisionId: string; readonly authoredBy: string; readonly changeMessage: string; readonly createdAt: Date }): Prisma.AgentRevisionCreateInput
{
	const content = { agentServiceId: head.agentServiceId, revision: head.revision + 1, promptPolicyVersion: head.promptPolicyVersion, personaRevisionId: target.personaRevisionId, modelDefinitionId: target.modelDefinitionId, budget: head.budget, skills: head.skillAssignments.map(function _skill(assignment) { return { skillId: assignment.skillId, revisionId: assignment.skillRevisionId }; }), integrationAssignments: head.integrationAssignments.map(function _integration(assignment) { return { integrationId: assignment.integrationId, custodyReferenceId: assignment.custodyReferenceId, allowedTools: [...assignment.allowedTools] }; }), scopeAttachments: head.scopeAttachments.map(function _scope(attachment) { return { scope: attachment.scope, subjectType: attachment.subjectType, subjectId: attachment.subjectId }; }) } as unknown as JsonValue;
	return { agentService: { connect: { id: head.agentServiceId } }, revision: head.revision + 1, parentRevision: { connect: { id: head.id } }, changeMessage: target.changeMessage, state: AgentRevisionState.Draft, digest: __DigestCanonicalJson(content), promptPolicyVersion: head.promptPolicyVersion, personaRevisionId: target.personaRevisionId, modelDefinition: { connect: { id: target.modelDefinitionId } }, budget: head.budget as Prisma.InputJsonValue, authoredBy: target.authoredBy, createdAt: target.createdAt, skillAssignments: { create: head.skillAssignments.map(function _skillAssignment(assignment) { return { skillId: assignment.skillId, skillRevisionId: assignment.skillRevisionId }; }) }, integrationAssignments: { create: head.integrationAssignments.map(function _integrationAssignment(assignment) { return { integrationId: assignment.integrationId, siloId: assignment.siloId, custodyReferenceId: assignment.custodyReferenceId, allowedTools: [...assignment.allowedTools] }; }) }, scopeAttachments: { create: head.scopeAttachments.map(function _scopeAttachment(attachment) { return { scope: attachment.scope as never, subjectType: attachment.subjectType as never, subjectId: attachment.subjectId }; }) } };
}
