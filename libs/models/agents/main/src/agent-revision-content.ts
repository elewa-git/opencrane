import { ___DigestCanonicalJson, type CanonicalJsonSha256Digest, type JsonValue } from "@opencrane/util";

import type { AgentRevisionContent } from "./agent-revision.types.js";

/**
 * Computes the canonical digest for one numbered agent revision.
 *
 * Every authority that creates an `AgentRevision` must call this function with the same executable
 * content it persists. Centralising the canonical projection prevents personal and managed revision
 * paths from silently hashing different fields or spellings for the same business fact.
 *
 * @param agentServiceId - Stable service that owns the revision lineage.
 * @param revision - Monotonic revision number within the service.
 * @param content - Complete immutable executable content persisted on the revision.
 * @returns Canonical SHA-256 digest covering the service, number, and executable content.
 */
export function __DigestAgentRevisionContent(agentServiceId: string, revision: number, content: AgentRevisionContent): CanonicalJsonSha256Digest
{
	const canonical: JsonValue = {
		agentServiceId,
		revision,
		promptPolicyVersion: content.promptPolicyVersion,
		personaRevisionId: content.personaRevisionId,
		modelDefinitionId: content.modelDefinitionId,
		budget: {
			maxTurns: content.budget.maxTurns,
			maxTokens: content.budget.maxTokens,
			maxDurationMs: content.budget.maxDurationMs,
		},
		skills: content.skills.map(function _MapSkill(skill)
		{
			return { skillId: skill.skillId, revisionId: skill.revisionId };
		}),
		integrationAssignments: content.integrationAssignments.map(function _MapIntegration(assignment)
		{
			return {
				integrationId: assignment.integrationId,
				custodyReferenceId: assignment.custodyReferenceId,
				toolDefinitions: assignment.toolDefinitions.map(function _MapTool(definition): JsonValue
				{
					return {
						name: definition.name,
						description: definition.description,
						parametersSchema: definition.parametersSchema,
						parametersSchemaDigest: definition.parametersSchemaDigest,
					};
				}),
			};
		}),
		scopeAttachments: content.scopeAttachments.map(function _MapScope(attachment)
		{
			return {
				scope: attachment.scope,
				subjectType: attachment.subjectType,
				subjectId: attachment.subjectId,
			};
		}),
	};

	return ___DigestCanonicalJson(canonical);
}
