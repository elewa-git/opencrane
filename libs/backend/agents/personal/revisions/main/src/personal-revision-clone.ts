import { AgentRevisionState, Prisma } from "@prisma/client";
import { __DigestCanonicalJson } from "@opencrane/backend/server/iam/authorization";
import type { JsonValue } from "@opencrane/util";

import type { PersonalRevisionCloneSource } from "./personal-configuration-materializer.types.js";

/** Complete immutable assignment shape loaded before cloning one personal AgentRevision. */
export const _PERSONAL_REVISION_INCLUDE = { skillAssignments: true, integrationAssignments: true, scopeAttachments: true } as const;

/** Builds a draft clone changing only the supplied immutable persona and model coordinates. */
export function __CreatePersonalRevisionCloneData(head: PersonalRevisionCloneSource, target: { readonly modelDefinitionId: string; readonly personaRevisionId: string; readonly authoredBy: string; readonly changeMessage: string; readonly createdAt: Date }): Prisma.AgentRevisionCreateInput
{
	const content = { agentServiceId: head.agentServiceId, revision: head.revision + 1, promptPolicyVersion: head.promptPolicyVersion, personaRevisionId: target.personaRevisionId, modelDefinitionId: target.modelDefinitionId, budget: head.budget, skills: head.skillAssignments.map(function _skill(assignment) { return { skillId: assignment.skillId, revisionId: assignment.skillRevisionId }; }), integrationAssignments: head.integrationAssignments.map(function _integration(assignment) { return { integrationId: assignment.integrationId, custodyReferenceId: assignment.custodyReferenceId, allowedTools: [...assignment.allowedTools] }; }), scopeAttachments: head.scopeAttachments.map(function _scope(attachment) { return { scope: attachment.scope, subjectType: attachment.subjectType, subjectId: attachment.subjectId }; }) } as unknown as JsonValue;
	return { agentService: { connect: { id: head.agentServiceId } }, revision: head.revision + 1, parentRevision: { connect: { id: head.id } }, changeMessage: target.changeMessage, state: AgentRevisionState.Draft, digest: __DigestCanonicalJson(content), promptPolicyVersion: head.promptPolicyVersion, personaRevisionId: target.personaRevisionId, modelDefinition: { connect: { id: target.modelDefinitionId } }, budget: head.budget as Prisma.InputJsonValue, authoredBy: target.authoredBy, createdAt: target.createdAt, skillAssignments: { create: head.skillAssignments.map(function _skillAssignment(assignment) { return { skillId: assignment.skillId, skillRevisionId: assignment.skillRevisionId }; }) }, integrationAssignments: { create: head.integrationAssignments.map(function _integrationAssignment(assignment) { return { integrationId: assignment.integrationId, siloId: assignment.siloId, custodyReferenceId: assignment.custodyReferenceId, allowedTools: [...assignment.allowedTools] }; }) }, scopeAttachments: { create: head.scopeAttachments.map(function _scopeAttachment(attachment) { return { scope: attachment.scope as never, subjectType: attachment.subjectType as never, subjectId: attachment.subjectId }; }) } };
}
