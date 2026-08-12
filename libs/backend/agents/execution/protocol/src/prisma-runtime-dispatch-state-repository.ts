import { ToolResultDeliveryState, type Prisma } from "@prisma/client";

import type { RuntimeDispatchStateRepository, RuntimeDispatchStateUnitOfWork, RuntimeDispatchToolInvocation } from "./runtime-dispatch-state.types.js";

/** Prisma repository for saved-result consumption and invocation replay evidence. */
export class PrismaRuntimeDispatchStateRepository implements RuntimeDispatchStateRepository
{
	/** Exact runtime dispatch transaction. */
	private readonly transaction: Prisma.TransactionClient;

	/** Bind every read and write to the caller-owned command or candidate transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Consume every exact delivery or abort the command transaction on a lost marker fence. */
	async consumeToolResultDeliveries(deliveryIds: readonly string[], consumedAt: Date): Promise<void>
	{
		const consumed = await this.transaction.toolResultDelivery.updateMany({ where: { id: { in: [...deliveryIds] }, state: ToolResultDeliveryState.Pending }, data: { state: ToolResultDeliveryState.Consumed, consumedAt } });
		if (consumed.count !== deliveryIds.length) throw new Error("runtime dispatch lost a saved-result delivery fence");
	}

	/** Load only the immutable fields needed to prove an idempotent candidate replay. */
	findToolInvocation(runId: string, attempt: number, candidateId: string): Promise<RuntimeDispatchToolInvocation | null>
	{
		return this.transaction.toolInvocation.findUnique({ where: { runId_attempt_candidateId: { runId, attempt, candidateId } }, select: { runtimeInstanceId: true, commandId: true, toolRevisionId: true, toolInvocationId: true, argumentsDigest: true, requestFingerprint: true } });
	}
}

/** Transaction unit that owns construction of the runtime dispatch state repository. */
export class PrismaRuntimeDispatchStateUnitOfWork implements RuntimeDispatchStateUnitOfWork
{
	/** Exact caller-owned command or candidate transaction. */
	private readonly transaction: Prisma.TransactionClient;

	/** Construct one repository over the command or candidate transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Consume the exact deliveries carried by the newly durable command. */
	consumeToolResultDeliveries(deliveryIds: readonly string[], consumedAt: Date): Promise<void>
	{
		return this._repository().consumeToolResultDeliveries(deliveryIds, consumedAt);
	}

	/** Load immutable invocation evidence without exposing Prisma to candidate admission. */
	findToolInvocation(runId: string, attempt: number, candidateId: string): Promise<RuntimeDispatchToolInvocation | null>
	{
		return this._repository().findToolInvocation(runId, attempt, candidateId);
	}

	/** Construct the repository only over the unit's exact transaction binding. */
	private _repository(): PrismaRuntimeDispatchStateRepository
	{
		return new PrismaRuntimeDispatchStateRepository(this.transaction);
	}
}
