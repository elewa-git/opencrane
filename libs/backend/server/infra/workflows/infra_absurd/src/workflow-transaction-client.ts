/**
 * Narrows the opaque workflow transaction at the only adapter boundary allowed to know Prisma.
 *
 * A root Prisma client exposes `$transaction`, unlike the transaction client handed to this
 * function. Rejecting the root keeps task admission and event delivery inside the product write
 * that owns the commit decision.
 *
 * Called by: `WorkflowTaskAdmission` and `WorkflowTaskEventAdmission`.
 */
export function _RequireWorkflowTransactionClient(client: unknown): asserts client is object
{
	if (typeof client !== "object" || client === null || typeof Reflect.get(client, "$queryRaw") !== "function" || typeof Reflect.get(client, "$transaction") === "function")
	{
		throw new Error("Workflow persistence requires a caller-owned Prisma TransactionClient.");
	}
}
