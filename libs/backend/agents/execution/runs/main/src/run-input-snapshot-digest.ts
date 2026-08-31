import { __DigestCanonicalJson } from "@opencrane/backend/server/iam/authorization";
import type { RunInputSnapshot } from "@opencrane/contracts";
import type { JsonValue } from "@opencrane/util";

/**
 * Hashes every saved runtime input except the digest field itself. Callers must sort lists that
 * represent sets first. Message history and source records keep their order because that order
 * changes their meaning.
 */
export function __DigestRunInputSnapshot(snapshot: Omit<RunInputSnapshot, "digest">): string
{
	return __DigestCanonicalJson({
		runId: snapshot.runId,
		siloId: snapshot.siloId,
		agentServiceId: snapshot.agentServiceId,
		agentRevisionId: snapshot.agentRevisionId,
		snapshotVersion: snapshot.snapshotVersion,
		conversationId: snapshot.conversationId,
		messageIds: snapshot.messageIds,
		personaRevisionId: snapshot.personaRevisionId,
		preferenceFactIds: snapshot.preferenceFactIds,
		artifactRevisionIds: snapshot.artifactRevisionIds,
		skillRevisionIds: snapshot.skillRevisionIds,
		memoryQueryPolicy: snapshot.memoryQueryPolicy,
		mcpTools: snapshot.mcpTools.map(function _McpTool(tool): JsonValue
		{
			return { toolRevisionId: tool.toolRevisionId, name: tool.name, description: tool.description, inputSchema: tool.inputSchema, inputSchemaDigest: tool.inputSchemaDigest };
		}),
		modelRoute: snapshot.modelRoute,
		budgetPolicy: snapshot.budgetPolicy,
		identitySnapshot: snapshot.identitySnapshot,
		capabilitySetDigest: snapshot.capabilitySetDigest,
		effectiveContractDigest: snapshot.effectiveContractDigest,
		promptCompilerVersion: snapshot.promptCompilerVersion,
		compiledAt: snapshot.compiledAt,
	} as unknown as JsonValue);
}
