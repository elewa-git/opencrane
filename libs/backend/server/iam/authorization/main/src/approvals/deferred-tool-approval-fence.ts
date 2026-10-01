import { Prisma } from "@prisma/client";

/** Messages the approval_requests trigger raises when a write fails its run, invocation, or computer-lease fence. */
const _APPROVAL_REQUEST_FENCE_MESSAGES: readonly string[] = [
	"ApprovalRequest requires its exact active conversation computer lease",
	"ApprovalRequest requires the current waiting run and its exact computer-lease invocation",
];

/**
 * Returns whether PostgreSQL's approval_requests trigger rejected a write because the run, its
 * awaiting invocation, or its active conversation computer lease no longer matches.
 *
 * That trigger is the only lease fence: it locks the lease row and compares it for every writer.
 * It raises inside the statement, so the whole transaction attempt rolled back and nothing
 * committed. The transaction owner maps this to its unavailable outcome instead of treating the
 * failure as ambiguous.
 *
 * Called by: __OpenDeferredToolApproval.
 */
export function _IsApprovalRequestFenceRejection(error: unknown): boolean
{
	return error instanceof Prisma.PrismaClientUnknownRequestError && _APPROVAL_REQUEST_FENCE_MESSAGES.some(function _Matches(message) { return error.message.includes(message); });
}
