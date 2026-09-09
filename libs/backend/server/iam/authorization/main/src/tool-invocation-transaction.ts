import type { RunToolProgress } from "@opencrane/contracts";
import type { JsonValue } from "@opencrane/util";

import { PrismaRunToolProgressRepository } from "./prisma-run-tool-progress-repository";
import type { ReadRunToolProgressCommand } from "./run-tool-progress.types";
import { PrismaRunToolResultDeliveryRepository } from "./prisma-run-tool-result-delivery-repository";
import { PrismaToolInvocationRepository } from "./prisma-tool-invocation-repository";
import type { ConsumeRunToolResultCommand, ReadRunToolResultCommand, ReadRunToolResultResult } from "./run-tool-result-delivery.types";
import { TOOL_INVOCATION_PREPARATION_POLICY } from "./tool-invocation-lifecycle.types";
import type { ToolInvocationAdmissionResult, ToolInvocationIntent, ToolInvocationPreparationPolicy, ToolInvocationRecord } from "./tool-invocation.types";

/** Uses the repository constructor as the source for the package's Prisma transaction type. */
type ToolInvocationTransaction = ConstructorParameters<typeof PrismaToolInvocationRepository>[0];

/**
 * Records an accepted tool-call candidate in the transaction that accepted the runtime command.
 *
 * The function keeps runtime dispatch from importing the repository class while preserving the
 * same transaction for candidate acceptance and ToolInvocation admission. Replays with the same
 * candidate fingerprint are idempotent; conflicting reuse is rejected.
 * Called by: the transaction-bound tool dispatch authority.
 * @param transaction - Transaction already accepting the runtime candidate.
 * @param intent - Frozen candidate facts.
 * @param now - Trusted server time used to set the retry deadline.
 * @param policy - Must equal {@link TOOL_INVOCATION_PREPARATION_POLICY}.
 * @returns The admitted row, its idempotent winner, or a permanent conflict.
 */
export async function __AdmitPreparingToolInvocationInTransaction(transaction: ToolInvocationTransaction, intent: ToolInvocationIntent, now: Date, policy: ToolInvocationPreparationPolicy): Promise<ToolInvocationAdmissionResult>
{
	return PrismaToolInvocationRepository.admitInTransaction(transaction, intent, now, policy);
}

/**
 * Prepare the observed invocation in the transaction that also admits its executor work.
 * The lifecycle owner preserves approval requirements and leaves progressed revisions unchanged.
 * Called by: PrismaConversationToolProposalRepository after its current authority checks.
 */
export async function __PrepareToolInvocationInTransaction(transaction: ToolInvocationTransaction, invocationId: string, expectedRevision: number, now: Date): Promise<ToolInvocationRecord | null>
{
	return PrismaToolInvocationRepository.markPreparedInTransaction(transaction, invocationId, expectedRevision, now);
}

/**
 * Reads one tool call by database id using the transaction that is deciding an approval.
 * Called by: ./deferred-tool-approval.ts and ./prisma-tool-invocation-elicitation-repository.ts.
 * @param transaction - Transaction that owns the surrounding approval decision.
 * @param invocationId - Trusted ToolInvocation database id.
 * @returns The stored row, or null when it does not exist.
 */
export async function __FindToolInvocationInTransaction(transaction: ToolInvocationTransaction, invocationId: string): Promise<ToolInvocationRecord | null>
{
	return PrismaToolInvocationRepository.findByIdInTransaction(transaction, invocationId);
}

/**
 * Read the exact result of a saved run-owned proposal without acknowledging its delivery.
 * The caller derives every coordinate from admitted server state and must recheck current Pod,
 * lease, membership, tool permission and original deadline in this same transaction before using
 * Available content. The returned invocation supports that existing authority check; this read
 * grants no permission by itself. Consumed results remain readable for exact restart verification.
 * @param transaction - Existing transaction that owns the caller's current-authority checks.
 * @returns Pending, a detached validated result, or Unavailable without result content.
 * @throws Database errors remain errors; an uncertain read must not be reported as pending work.
 */
export async function __ReadRunToolResultInTransaction(transaction: ToolInvocationTransaction, command: ReadRunToolResultCommand): Promise<ReadRunToolResultResult>
{
	return PrismaRunToolResultDeliveryRepository.inTransaction(transaction).read(command);
}

/**
 * Acknowledge a result only after the caller proves that its exact continuation was saved durably.
 * The caller must verify that evidence and current permission before this call in the same
 * transaction, then roll back if its deadline or result changes before commit. IAM checks every
 * invocation coordinate and the full payload digest, and reads back the unchanged consumed result.
 * Repeated acknowledgement preserves the original timestamp. This API never grants model dispatch.
 * @param transaction - Transaction holding the caller's current-authority decision.
 * @param command - Saved invocation coordinates and the durably retained result digest.
 * @param now - Trusted server timestamp for the first acknowledgement.
 * @throws Database errors remain errors, including uncertainty after a write.
 */
export async function __ConsumeRunToolResultInTransaction(transaction: ToolInvocationTransaction, command: ConsumeRunToolResultCommand, now: Date): Promise<ReadRunToolResultResult>
{
	return PrismaRunToolResultDeliveryRepository.inTransaction(transaction).consume(command, now);
}

/**
 * Moves an approved tool call to `Ready` with the arguments the reviewer accepted.
 * Called by: ./deferred-tool-approval.ts and ./prisma-tool-invocation-elicitation-repository.ts.
 * @returns True when the stored invocation still matches the reviewed request and waiting run.
 */
export async function __MarkToolInvocationApprovedInTransaction(transaction: ToolInvocationTransaction, invocationId: string, expectedArguments: JsonValue, expectedArgumentsDigest: string, effectiveArguments: JsonValue, effectiveArgumentsDigest: string): Promise<boolean>
{
	return PrismaToolInvocationRepository.markApprovedInTransaction(transaction, invocationId, expectedArguments, expectedArgumentsDigest, effectiveArguments, effectiveArgumentsDigest);
}

/**
 * Fails a tool call whose approval was refused or expired and stores its result delivery.
 * Called by: ./deferred-tool-approval.ts, ./prisma-deferred-tool-approval-opener.ts, and
 * ./prisma-tool-invocation-elicitation-repository.ts.
 * @param failureCode - Short code recorded and delivered; an invalid value is replaced.
 * @returns True when the invocation was still waiting for approval and the failure committed.
 */
export async function __MarkToolInvocationApprovalRejectedInTransaction(transaction: ToolInvocationTransaction, invocationId: string, now: Date, failureCode: string): Promise<boolean>
{
	return PrismaToolInvocationRepository.markApprovalRejectedInTransaction(transaction, invocationId, now, failureCode);
}


/**
 * Reads phase-only tool progress after the caller authorizes the exact run in this transaction.
 * Called by: the personal run-status repository after owner and AgentRun Read filtering.
 * Null means no invocation in the current attempt; database and malformed-state errors propagate.
 * @see RunToolProgress for the deliberately limited public result.
 */
export async function __ReadRunToolProgressInTransaction(transaction: ToolInvocationTransaction, command: ReadRunToolProgressCommand): Promise<RunToolProgress | null>
{
	return PrismaRunToolProgressRepository.inTransaction(transaction).readLatest(command);
}
