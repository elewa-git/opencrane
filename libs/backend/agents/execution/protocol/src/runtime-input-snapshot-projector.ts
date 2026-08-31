import type { RunInputSnapshot, RunInputSnapshotIdentity } from "@opencrane/contracts";

/** JSON values returned by Prisma's persisted snapshot columns. */
type RuntimeSnapshotJsonValue = string | number | boolean | null | RuntimeSnapshotJsonObject | readonly RuntimeSnapshotJsonValue[];

/** JSON object returned by Prisma without widening persisted values to `unknown`. */
interface RuntimeSnapshotJsonObject
{
	readonly [key: string]: RuntimeSnapshotJsonValue | undefined;
}

/** Durable input-snapshot fields selected by runtime dispatch and external-action context queries. */
interface RuntimeInputSnapshotRow
{
	readonly runId: string;
	readonly siloId: string;
	readonly agentServiceId: string;
	readonly agentRevisionId: string;
	readonly snapshotVersion: number;
	readonly conversationId: string | null;
	readonly messageIds: readonly string[];
	readonly personaRevisionId: string | null;
	readonly preferenceFactIds: readonly string[];
	readonly artifactRevisionIds: readonly string[];
	readonly skillRevisionIds: readonly string[];
	readonly memoryQueryPolicy: RuntimeSnapshotJsonValue;
	readonly mcpTools: RuntimeSnapshotJsonValue;
	readonly modelRoute: RuntimeSnapshotJsonValue;
	readonly budgetPolicy: RuntimeSnapshotJsonValue;
	readonly identitySnapshot: RuntimeSnapshotJsonValue;
	readonly capabilitySetDigest: string;
	readonly effectiveContractDigest: string;
	readonly promptCompilerVersion: string;
	readonly digest: string;
	readonly compiledAt: Date;
}

/** Re-types JSON created by the admission compiler without widening this persistence boundary to `unknown`. */
function _ProjectSnapshotJson<Value>(value: RuntimeSnapshotJsonValue): Value
{
	return value as Value & RuntimeSnapshotJsonValue;
}

/**
 * Builds the wire snapshot that a runtime receives from its persisted input row.
 *
 * Dispatch and external-action context both need the same frozen inputs, while Prisma represents
 * `compiledAt` as a `Date` and the runtime contract carries an ISO string. This projection leaves
 * the already-persisted JSON fields unchanged so both paths see the identical admission snapshot.
 * Called by: `PrismaRuntimeDispatchAuthority` and `PrismaExternalActionContextRepository`.
 *
 * @param row - Persisted fields selected by either runtime query.
 * @returns The contract snapshot with `compiledAt` converted to its wire representation.
 */
export function __ProjectRuntimeInputSnapshot(row: RuntimeInputSnapshotRow): RunInputSnapshot
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
		memoryQueryPolicy: _ProjectSnapshotJson<RunInputSnapshot["memoryQueryPolicy"]>(row.memoryQueryPolicy),
		mcpTools: _ProjectSnapshotJson<RunInputSnapshot["mcpTools"]>(row.mcpTools),
		modelRoute: _ProjectSnapshotJson<RunInputSnapshot["modelRoute"]>(row.modelRoute),
		budgetPolicy: _ProjectSnapshotJson<RunInputSnapshot["budgetPolicy"]>(row.budgetPolicy),
		identitySnapshot: _ProjectSnapshotJson<RunInputSnapshotIdentity>(row.identitySnapshot),
		capabilitySetDigest: row.capabilitySetDigest,
		effectiveContractDigest: row.effectiveContractDigest,
		promptCompilerVersion: row.promptCompilerVersion,
		digest: row.digest,
		compiledAt: row.compiledAt.toISOString(),
	};
}
