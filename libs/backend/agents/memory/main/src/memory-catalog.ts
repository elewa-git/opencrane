import { ___IsSha256ContentAddress } from "@opencrane/models/artifacts";
import { MemoryFactProvenanceSourceKinds } from "@opencrane/contracts";

import { __MemoryCatalogCorrectionConflictError } from "./memory-catalog-errors";
import { MemoryCatalogAtomicStatuses } from "./memory-catalog.types";
import type { AtomicRecordMemoryFactResult, MemoryCatalogUnitOfWork, RecordMemoryFactCommand, RecordMemoryFactResult } from "./memory-catalog.types";

/**
 * Records one memory fact's metadata and provenance in Postgres, after Cognee has stored the
 * content itself.
 *
 * Validates the command before opening any transaction, then lets the unit of work write the
 * catalog row and its outbox event together. A repeat delivery of a fact that already
 * committed is reported as success, so a retrying caller cannot turn one fact into two.
 *
 * Called by: nothing outside this package yet — no file imports
 * `@opencrane/backend/agents/memory`, so its only callers are `__tests__/memory-catalog.test.ts`.
 *
 * @param unitOfWork - Opens the transaction and owns retries. See {@link MemoryCatalogUnitOfWork}.
 * @param command - The fact to record, already stored in Cognee.
 * @returns `{ outcome: "recorded", idempotent: false }` for a fresh write;
 * `{ outcome: "recorded", idempotent: true }` when an earlier identical delivery already
 * committed and nothing was written this time; `{ outcome: "denied", reason }` otherwise,
 * where the reason is never retryable as written. See {@link MemoryCatalogAtomicStatuses}.
 * @throws Error re-thrown from the unit of work for any failure other than a correction
 * conflict, so the caller fails closed instead of assuming the fact was stored.
 */
export async function __RecordMemoryFact(unitOfWork: MemoryCatalogUnitOfWork, command: RecordMemoryFactCommand): Promise<RecordMemoryFactResult>
{
	// 1. Require exactly one source and a content digest, never the fact content itself.
	if (!__IsValidMemoryFactCommand(command))
	{
		return { outcome: "denied", reason: MemoryCatalogAtomicStatuses.InvalidCommand };
	}

	// 2. Persist catalog metadata and the downstream event in one transaction.
	let result: AtomicRecordMemoryFactResult;
	try
	{
		result = await unitOfWork.run(command, async function _RecordFact(transaction)
		{
			return transaction.catalog.recordFactAtomically(command);
		});
	}
	catch (error)
	{
		if (error instanceof __MemoryCatalogCorrectionConflictError) return { outcome: "denied", reason: MemoryCatalogAtomicStatuses.CorrectionConflict };
		throw error;
	}

	// 3. Report a repeat write as success; a missing or retired dataset, or a bad correction, stays a denial.
	if (result.status === MemoryCatalogAtomicStatuses.Recorded) return { outcome: "recorded", idempotent: false };
	if (result.status === MemoryCatalogAtomicStatuses.Idempotent) return { outcome: "recorded", idempotent: true };
	return { outcome: "denied", reason: result.status };
}

/**
 * Returns whether a command may be recorded at all.
 *
 * Two rules matter beyond the blank-field checks. First, `source` must name exactly one origin
 * — an artifact revision, a message, or an explicit user statement — because a fact with two
 * origins cannot be explained or corrected later. Second, a fact the user stated themselves
 * must name that same user in `source.explicitUserId`, in `recordedBy`, and in the
 * `sourceUserId` and `sourceKind` provenance fields, so one user can never record a personal
 * fact against another user's name.
 *
 * Called by: {@link __RecordMemoryFact} before it opens a transaction, and again inside
 * {@link PrismaMemoryCatalogRepository.recordFactAtomically} so a repository used directly
 * cannot skip the check.
 *
 * @param command - The command to check.
 * @returns True when every rule holds; false means the command is refused as `InvalidCommand`.
 */
export function __IsValidMemoryFactCommand(command: RecordMemoryFactCommand): boolean
{
	const sourceCount = Number(command.source.artifactRevisionId !== null) + Number(command.source.messageId !== null) + Number(command.source.explicitUserStatement);
	if (!command.datasetId.trim() || !command.cogneeExternalId.trim() || !___IsSha256ContentAddress(command.contentDigest) || !command.sensitivity.trim() || !command.recordedBy.trim() || !command.idempotencyKey.trim() || sourceCount !== 1) return false;
	if (!command.source.explicitUserStatement) return command.source.explicitUserId === null && command.provenance["user_statement"] !== true;
	return command.source.explicitUserId !== null
		&& command.source.explicitUserId.trim().length > 0
		&& command.provenance["user_statement"] === true
		&& command.provenance["sourceKind"] === MemoryFactProvenanceSourceKinds.ExplicitUserFact
		&& command.provenance["sourceUserId"] === command.source.explicitUserId
		&& command.recordedBy === command.source.explicitUserId;
}
