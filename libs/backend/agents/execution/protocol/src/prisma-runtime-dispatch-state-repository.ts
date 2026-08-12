import { ToolResultDeliveryState, type Prisma } from "@prisma/client";

import type { RuntimeDispatchStateRepository, RuntimeDispatchStateUnitOfWork, RuntimeDispatchToolInvocation } from "./runtime-dispatch-state.types.js";

/**
 * Marks tool-result rows consumed, and loads the fields needed to recognise a repeated candidate.
 *
 * Both jobs must run on the transaction that owns the surrounding command or candidate decision,
 * which is why the transaction is a constructor argument rather than a per-call one.
 *
 * Called by: `_nextCommand` and `_admitCandidate` in prisma-runtime-dispatch-authority.ts, through
 * {@link PrismaRuntimeDispatchStateUnitOfWork}.
 *
 * @implements RuntimeDispatchStateRepository
 */
export class PrismaRuntimeDispatchStateRepository implements RuntimeDispatchStateRepository
{
	/** Exact runtime dispatch transaction. */
	private readonly transaction: Prisma.TransactionClient;

	/** Read and write only on the caller's command or candidate transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/**
	 * Mark every listed delivery consumed.
	 *
	 * @param deliveryIds - The deliveries carried by the resume command that was just saved.
	 * @param consumedAt - Trusted server time.
	 * @throws {Error} When fewer rows changed than were listed, meaning another writer had already
	 * taken one. The throw rolls the whole command back, so a resume command can never be sent while
	 * its results are recorded as belonging to a different command.
	 */
	async consumeToolResultDeliveries(deliveryIds: readonly string[], consumedAt: Date): Promise<void>
	{
		const consumed = await this.transaction.toolResultDelivery.updateMany({ where: { id: { in: [...deliveryIds] }, state: ToolResultDeliveryState.Pending }, data: { state: ToolResultDeliveryState.Consumed, consumedAt } });
		if (consumed.count !== deliveryIds.length) throw new Error("runtime dispatch lost a saved-result delivery fence");
	}

	/**
	 * Load just the fields needed to check that a repeated candidate is identical to the first one.
	 *
	 * @param runId - Run that owns the invocation.
	 * @param attempt - Attempt the candidate was admitted under.
	 * @param candidateId - The candidate id the runtime is offering again.
	 * @returns The saved fields, or null when no invocation was ever recorded for that candidate.
	 * Either way the caller must refuse a repeat that does not match, with
	 * `external_action_replay_conflict`.
	 */
	findToolInvocation(runId: string, attempt: number, candidateId: string): Promise<RuntimeDispatchToolInvocation | null>
	{
		return this.transaction.toolInvocation.findUnique({ where: { runId_attempt_candidateId: { runId, attempt, candidateId } }, select: { runtimeInstanceId: true, commandId: true, toolRevisionId: true, toolInvocationId: true, argumentsDigest: true, requestFingerprint: true } });
	}
}

/**
 * Creates the dispatch-state repository on the caller's transaction, and forwards to it.
 *
 * Exists so candidate admission and command dispatch never construct a Prisma-facing repository
 * themselves; they hold one of these and call it.
 *
 * Called by: `_nextCommand` and `_admitCandidate` in prisma-runtime-dispatch-authority.ts.
 *
 * @implements RuntimeDispatchStateUnitOfWork
 */
export class PrismaRuntimeDispatchStateUnitOfWork implements RuntimeDispatchStateUnitOfWork
{
	/** Exact caller-owned command or candidate transaction. */
	private readonly transaction: Prisma.TransactionClient;

	/** Construct one repository over the command or candidate transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Mark consumed the deliveries carried by the command that was just saved. */
	consumeToolResultDeliveries(deliveryIds: readonly string[], consumedAt: Date): Promise<void>
	{
		return this._repository().consumeToolResultDeliveries(deliveryIds, consumedAt);
	}

	/** Load the saved invocation fields, so candidate admission never touches Prisma itself. */
	findToolInvocation(runId: string, attempt: number, candidateId: string): Promise<RuntimeDispatchToolInvocation | null>
	{
		return this._repository().findToolInvocation(runId, attempt, candidateId);
	}

	/** Build the repository on this unit's transaction. */
	private _repository(): PrismaRuntimeDispatchStateRepository
	{
		return new PrismaRuntimeDispatchStateRepository(this.transaction);
	}
}
