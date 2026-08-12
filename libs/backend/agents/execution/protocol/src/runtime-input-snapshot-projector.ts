import type { RunInputSnapshot, RunInputSnapshotIdentity } from "@opencrane/contracts";

/**
 * Turn one snapshot row from the database into the snapshot shape the runtime receives.
 *
 * Field by field on purpose: the row's JSON columns are cast to their contract types here and
 * nowhere else, so the wire shape cannot drift by accident as the Prisma model grows.
 *
 * Called by: `_loadContext` in prisma-runtime-dispatch-authority.ts, and
 * `PrismaExternalActionExecutionContextRepository.load`.
 *
 * @param row - The snapshot row, including its JSON columns.
 * @returns The snapshot as the runtime and the action worker see it.
 */
export function __ProjectRuntimeInputSnapshot(row: { runId: string; siloId: string; agentServiceId: string; agentRevisionId: string; snapshotVersion: number; conversationId: string | null; messageIds: string[]; personaRevisionId: string | null; preferenceFactIds: string[]; artifactRevisionIds: string[]; skillRevisionIds: string[]; memoryFacts: unknown; memoryQueryPolicy: unknown; integrationAssignments: unknown; modelRoute: unknown; budgetPolicy: unknown; identitySnapshot: unknown; capabilitySetDigest: string; effectiveContractDigest: string; promptCompilerVersion: string; digest: string; compiledAt: Date }): RunInputSnapshot
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
		memoryFacts: row.memoryFacts as RunInputSnapshot["memoryFacts"],
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
