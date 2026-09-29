import type { AgentRun, Prisma, RunInputSnapshot as PrismaRunInputSnapshot } from "@prisma/client";

import type { RunInputSnapshot } from "@opencrane/contracts";

import { _MatchesRoutineFiring, _MatchesRun, _MatchesSnapshot, _RunInputSnapshot } from "./prisma-run-admission-unit-of-work";
import type { RoutineRunSnapshotRecovery } from "./routine-run-snapshot-recovery.types";
import type { RoutineRunAdmissionCommand } from "./run-admission.types";
import { __DigestRunInputSnapshot } from "./run-input-snapshot-digest";

/**
 * Recovers one immutable attempt-one routine snapshot through a caller-owned transaction.
 *
 * Called by: routine compilation after admission has already committed.
 * @implements RoutineRunSnapshotRecovery
 */
export class PrismaRoutineRunSnapshotRecoveryRepository implements RoutineRunSnapshotRecovery
{
	/** Transaction shared with the caller's current authority and receipt reads. */
	private readonly _transaction: Prisma.TransactionClient;

	/** Bind read-only recovery to the caller's exact transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this._transaction = transaction;
	}

	/** Recover an exact admitted routine snapshot without invoking admission or persistence. */
	async recover(command: RoutineRunAdmissionCommand, expectedAttempt: 1): Promise<RunInputSnapshot | null>
	{
		if (expectedAttempt !== 1)
			throw new Error("Routine run recovery only supports the admitted first attempt");
		const run = await this._transaction.agentRun.findUnique({ where: { id: command.runId } });
		if (run === null)
			return null;
		if (!_MatchesRecoveredRun(run, command, expectedAttempt))
			throw new Error("Stored routine run does not match the expected admission");

		const firing = await this._transaction.agentRoutineFiring.findUnique({ where: { id: command.routineInput.firingId } });
		if (!_MatchesRoutineFiring(firing, run.id, command))
			throw new Error("Stored routine firing does not match the expected admission");

		const row = await this._transaction.runInputSnapshot.findUnique({ where: { runId_attempt_digest: { runId: run.id, attempt: expectedAttempt, digest: run.inputSnapshotDigest } } });
		if (row === null || !_MatchesRecoveredRow(row, run, command, expectedAttempt))
			throw new Error("Stored routine snapshot does not match the expected admission");
		const snapshot = _RunInputSnapshot(row);
		if (!_MatchesRecoveredSnapshot(snapshot, run, command, expectedAttempt))
			throw new Error("Recovered routine snapshot does not match the expected admission");
		const { digest, ...content } = snapshot;
		if (__DigestRunInputSnapshot(content) !== digest)
			throw new Error("Recovered routine snapshot digest is invalid");
		return snapshot;
	}
}

/** Check the current run row before it selects any linked occurrence or snapshot. */
function _MatchesRecoveredRun(run: AgentRun, command: RoutineRunAdmissionCommand, expectedAttempt: 1): boolean
{
	return run.id === command.runId
		&& run.attempt === expectedAttempt
		&& run.requestIdempotencyKey === command.requestIdempotencyKey
		&& _MatchesRun(run, command);
}

/** Bind the stored snapshot row to the run's current identity and digest coordinates. */
function _MatchesRecoveredRow(row: PrismaRunInputSnapshot, run: AgentRun, command: RoutineRunAdmissionCommand, expectedAttempt: 1): boolean
{
	return row.runId === run.id
		&& row.attempt === expectedAttempt
		&& row.digest === run.inputSnapshotDigest
		&& row.agentRevisionId === run.agentRevisionId
		&& row.agentIdentityId === run.agentIdentityId
		&& row.principalId === run.principalId
		&& _MatchesSnapshot(row, run.id, command);
}

/** Require the validated execution subject to describe the same exact first attempt and requester. */
function _MatchesRecoveredSnapshot(snapshot: RunInputSnapshot, run: AgentRun, command: RoutineRunAdmissionCommand, expectedAttempt: 1): boolean
{
	const subject = snapshot.executionSubject;
	return snapshot.runId === command.runId
		&& snapshot.attempt === expectedAttempt
		&& snapshot.digest === run.inputSnapshotDigest
		&& subject.siloId === command.siloId
		&& subject.runScope.runId === command.runId
		&& subject.runScope.attempt === expectedAttempt
		&& subject.runScope.siloId === command.siloId
		&& subject.runScope.agentServiceId === command.agentServiceId
		&& subject.runScope.agentRevisionId === run.agentRevisionId
		&& subject.computerScope.siloId === command.siloId
		&& subject.requester.siloId === command.siloId
		&& subject.requester.requesterPrincipalId === command.routineInput.requesterPrincipalId
		&& subject.requester.requestIdempotencyKey === command.requestIdempotencyKey
		&& subject.requester.authenticatedAt === command.routineInput.requesterAuthenticatedAt;
}
