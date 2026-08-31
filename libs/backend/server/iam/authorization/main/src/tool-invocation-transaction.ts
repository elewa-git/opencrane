import type { JsonValue } from "@opencrane/util";

import { PrismaToolInvocationRepository } from "./prisma-tool-invocation-repository";
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
 * Called by: libs/backend/agents/execution/protocol/src/prisma-runtime-dispatch-authority.ts.
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
