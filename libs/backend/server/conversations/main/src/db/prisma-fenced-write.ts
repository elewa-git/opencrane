/**
 * Throws unless a fenced Prisma write touched exactly the expected number of rows.
 *
 * Every conversation-computer write names its fence in the `where` clause: the current active lease,
 * the claim fence a caller holds, or the state a row must still be in. When the write touches a
 * different number of rows the fence moved underneath the caller (another transaction won, the lease
 * was cleared, or the row was already promoted) and the operation must stop instead of continuing on
 * state it no longer owns. Reporting the count is the only signal Prisma gives for that, so every
 * guard goes through this one check.
 *
 * Called by: `PrismaConversationComputerCredentialRepository`.
 * @param result - The `updateMany` or `deleteMany` result whose `count` proves how many rows matched the fence.
 * @param expected - Rows the fence must have matched; one for a single fenced row.
 * @param reason - Short operator-facing sentence used as the error message when the fence did not hold.
 * @throws {Error} With `reason` as its message when `result.count` differs from `expected`.
 */
export function _AssertFencedRowCount(result: { readonly count: number }, expected: number, reason: string): void
{
	if (result.count !== expected)
		throw new Error(reason);
}
