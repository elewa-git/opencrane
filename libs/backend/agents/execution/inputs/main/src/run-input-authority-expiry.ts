import { __SameMembershipBinding } from "@opencrane/backend/server/iam/membership";
import type { CompiledRunInput, RunInputSnapshot } from "@opencrane/contracts";
import type { ExecutionSubject } from "@opencrane/models/agents";

/**
 * Intersects original and currently verified authority deadlines for a conversation model credential.
 *
 * Called by: conversation run admission after compilation, including recovered snapshot retries.
 * The original execution and requester evidence and absolute budget deadline remain ceilings even
 * when a later request passes current authorization again. A shorter current membership deadline
 * narrows that ceiling; a later deadline never extends it. This function never reads the clock.
 * @see PrismaRevisionBudgetPolicyAuthority for the once-computed absolute run deadline.
 */
export function __RunInputAuthorityExpiresAt(snapshot: RunInputSnapshot, compiled: CompiledRunInput, current: ExecutionSubject): string
{
	const subject = snapshot.executionSubject;
	if (!snapshot.runId.trim() || compiled.runId !== snapshot.runId || compiled.attempt !== snapshot.attempt
		|| !Number.isSafeInteger(snapshot.attempt) || snapshot.attempt <= 0
		|| subject.runScope.runId !== snapshot.runId || subject.runScope.attempt !== snapshot.attempt
		|| subject.siloId !== snapshot.siloId || subject.runScope.siloId !== snapshot.siloId)
		throw new Error("Conversation credential authority requires the original bound run attempt");
	if (current.siloId !== subject.siloId || current.principalId !== subject.principalId
		|| current.agentIdentityId !== subject.agentIdentityId || current.runScope.runId !== snapshot.runId
		|| current.runScope.attempt !== snapshot.attempt || current.runScope.agentRevisionId !== subject.runScope.agentRevisionId
		|| current.computerScope.computerId !== subject.computerScope.computerId
		|| current.computerScope.leaseId !== subject.computerScope.leaseId || current.computerScope.leaseGeneration !== subject.computerScope.leaseGeneration
		|| current.requester.requesterPrincipalId !== subject.requester.requesterPrincipalId
		|| !__SameMembershipBinding(subject.membership, current.membership)
		|| !__SameMembershipBinding(subject.requester.membership, current.requester.membership))
		throw new Error("Conversation credential authority requires the same currently verified subject");
	const budget = compiled.budget;
	const deadline = budget.wallClockDeadlineEpochMs;
	if (!_PositiveInteger(deadline) || !_PositiveInteger(budget.maxModelTurns) || !_PositiveInteger(budget.maxCompletionTokens)
		|| !Number.isFinite(new Date(deadline).getTime()))
		throw new Error("Conversation credential authority requires a bounded compiled budget");
	const policy = snapshot.budgetPolicy;
	if (policy === null || typeof policy !== "object" || !("wallClockDeadlineEpochMs" in policy) || policy.wallClockDeadlineEpochMs !== deadline)
		throw new Error("Conversation credential authority cannot replace the original budget deadline");
	return new Date(Math.min(_EvidenceExpiry(subject.membership.trustedUntil), _EvidenceExpiry(subject.requester.membership.trustedUntil), _EvidenceExpiry(current.membership.trustedUntil), _EvidenceExpiry(current.requester.membership.trustedUntil), deadline)).toISOString();
}

/** Refuses malformed evidence dates instead of turning them into an unbounded credential lifetime. */
function _EvidenceExpiry(value: string): number
{
	const epoch = Date.parse(value);
	if (!_PositiveInteger(epoch) || new Date(epoch).toISOString() !== value)
		throw new Error("Conversation credential authority requires a canonical evidence expiry");
	return epoch;
}

/** Recognizes the positive integer limits accepted by the production computer budget policy. */
function _PositiveInteger(value: unknown): value is number
{
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
