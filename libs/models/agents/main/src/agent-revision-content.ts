import { ___DigestCanonicalJson, type CanonicalJsonSha256Digest, type JsonValue } from "@opencrane/util";

import type { AgentRevisionContent } from "./agent-revision.types";

/**
 * Compute the content digest for one numbered agent revision.
 *
 * Every code path that creates an `AgentRevision` must call this with exactly the content it is
 * about to store. Keeping it in one function is what stops the personal and managed revision paths
 * from hashing different fields, or the same fields in a different order, for the same revision —
 * which would make two identical revisions look different and break drift detection.
 *
 * The digest is taken over RFC 8785 canonical JSON, so key order and number formatting cannot
 * change the result.
 *
 * Called by: `libs/backend/server/agents/agent-services/main/src/agent-publication.ts`,
 * `libs/backend/server/agents/agent-services/main/src/prisma-agent-revision-writer.ts`.
 * @param agentServiceId - Service that owns the revision.
 * @param revision - Revision number within that service.
 * @param content - The exact content being stored on the revision.
 * @returns Lowercase `sha256:<hex>` digest over the service id, revision number, and content.
 * @see {@link AgentRevisionContent}
 * @see https://www.rfc-editor.org/rfc/rfc8785
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
			maxCostUsdMicros: content.budget.maxCostUsdMicros,
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
