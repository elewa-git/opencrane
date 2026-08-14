import type { Prisma } from "@prisma/client";

import { RunCancellationConflictReasons, RunCancellationResultStatuses, type RequestRunCancellationResult, type RunCancellationRepository } from "./run-cancellation.types";
import { SelfRunCancellationOutcomes, type SelfRunCancellationCommand, type SelfRunCancellationRepository, type SelfRunCancellationResult } from "./self-run-cancellation.types";

/** Prisma owner check in front of the shared durable run-cancellation authority. */
export class PrismaSelfRunCancellationRepository implements SelfRunCancellationRepository
{
	/** Canonical transaction-compatible product-authority database client. */
	private readonly _prisma: Prisma.TransactionClient;
	/** Shared attempt-fenced cancellation authority also used by cleanup workers. */
	private readonly _cancellation: RunCancellationRepository;

	/** Construct the owner-bound cancellation repository. */
	constructor(prisma: Prisma.TransactionClient, cancellation: RunCancellationRepository)
	{
		this._prisma = prisma;
		this._cancellation = cancellation;
	}

	/** Hide absent or foreign runs, then cancel only the exact owner-observed attempt. */
	async requestOwned(command: SelfRunCancellationCommand): Promise<SelfRunCancellationResult>
	{
		// Run ownership and silo are immutable after admission, so this check remains true while the
		// cancellation repository independently fences the exact mutable attempt inside its transaction.
		const owned = await this._prisma.agentRun.findFirst({ where: { id: command.runId, siloId: command.siloId, delegatedUserId: command.subjectId }, select: { id: true } });
		if (owned === null) return { outcome: SelfRunCancellationOutcomes.NotFound };
		const result = await this._cancellation.requestCancellationAtomically({ runId: owned.id, expectedAttempt: command.expectedAttempt, requestedBy: command.subjectId });
		return _MapCancellationResult(result);
	}
}

/** Translate the package-private cleanup result into the smaller owner-facing vocabulary. */
function _MapCancellationResult(result: RequestRunCancellationResult): SelfRunCancellationResult
{
	if (result.status === RunCancellationResultStatuses.Cancelling) return { outcome: SelfRunCancellationOutcomes.Cancelling, runId: result.runId, attempt: result.attempt };
	if (result.status === RunCancellationResultStatuses.Cancelled) return { outcome: SelfRunCancellationOutcomes.Cancelled, runId: result.runId, attempt: result.attempt };
	if (result.status === RunCancellationResultStatuses.Idempotent)
	{
		const outcome = result.state === SelfRunCancellationOutcomes.Cancelling ? SelfRunCancellationOutcomes.Cancelling : SelfRunCancellationOutcomes.Cancelled;
		return { outcome, runId: result.runId, attempt: result.attempt };
	}
	if (result.status === RunCancellationResultStatuses.NotFound) return { outcome: SelfRunCancellationOutcomes.NotFound };
	if (result.reason === RunCancellationConflictReasons.AttemptConflict) return { outcome: SelfRunCancellationOutcomes.AttemptConflict };
	if (result.reason === RunCancellationConflictReasons.TerminalRun) return { outcome: SelfRunCancellationOutcomes.TerminalRun };
	if (result.reason === RunCancellationConflictReasons.InvalidRequest) return { outcome: SelfRunCancellationOutcomes.InvalidRequest };
	return { outcome: SelfRunCancellationOutcomes.AuthorityConflict };
}
