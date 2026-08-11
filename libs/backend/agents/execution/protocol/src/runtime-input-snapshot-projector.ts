import type { RunInputSnapshot, RunInputSnapshotIdentity } from "@opencrane/contracts";

/** Map one durable snapshot row into the immutable wire snapshot the runtime receives. */
export function __ProjectRuntimeInputSnapshot(row: { runId: string; siloId: string; agentServiceId: string; agentRevisionId: string; snapshotVersion: number; conversationId: string | null; messageIds: string[]; personaRevisionId: string | null; preferenceFactIds: string[]; artifactRevisionIds: string[]; skillRevisionIds: string[]; memoryQueryPolicy: unknown; integrationAssignments: unknown; modelRoute: unknown; budgetPolicy: unknown; identitySnapshot: unknown; capabilitySetDigest: string; effectiveContractDigest: string; promptCompilerVersion: string; digest: string; compiledAt: Date }): RunInputSnapshot
{
	return {
		runId: row.runId,
		siloId: row.siloId,
		agentServiceId: row.agentServiceId,
		agentRevisionId: row.agentRevisionId,
		snapshotVersion: row.snapshotVersion,
		conversationId: row.conversationId,
		messageIds: row.messageIds,
		personaRevisionId: row.personaRevisionId,
		preferenceFactIds: row.preferenceFactIds,
		artifactRevisionIds: row.artifactRevisionIds,
		skillRevisionIds: row.skillRevisionIds,
		memoryQueryPolicy: row.memoryQueryPolicy as RunInputSnapshot["memoryQueryPolicy"],
		integrationAssignments: row.integrationAssignments as RunInputSnapshot["integrationAssignments"],
		modelRoute: row.modelRoute as RunInputSnapshot["modelRoute"],
		budgetPolicy: row.budgetPolicy as RunInputSnapshot["budgetPolicy"],
		identitySnapshot: row.identitySnapshot as RunInputSnapshotIdentity,
		capabilitySetDigest: row.capabilitySetDigest,
		effectiveContractDigest: row.effectiveContractDigest,
		promptCompilerVersion: row.promptCompilerVersion,
		digest: row.digest,
		compiledAt: row.compiledAt.toISOString(),
	};
}
