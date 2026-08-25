import { Prisma } from "@prisma/client";

import type { RunCancellationEventDeferralCommand, RunCancellationEventDeferralRepository, RunCancellationEventDeferralUnitOfWork } from "./run-cancellation-event-deferral.types";

/** Prisma repository for one exact cleanup-event deferral compare-and-set. */
export class PrismaRunCancellationEventDeferralRepository implements RunCancellationEventDeferralRepository
{
	/** Exact caller-owned cancellation transaction. */
	private readonly transaction: Prisma.TransactionClient;

	/** Bind the deferral write to the cancellation or confirmation transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Release only the exact unpublished and non-failed claim generation. */
	async defer(command: RunCancellationEventDeferralCommand): Promise<boolean>
	{
		const common = { claimedAt: null, availableAt: command.availableAt };
		const data = command.payload === undefined ? common : { ...common, payload: command.payload as Prisma.InputJsonValue };
		const deferred = await this.transaction.outboxEvent.updateMany({ where: { id: command.eventId, claimedAt: command.claimedAt, deliveryCount: command.deliveryCount, publishedAt: null, failedAt: null }, data });
		return deferred.count === 1;
	}
}

/** Transaction unit that owns cleanup-event deferral repository construction. */
export class PrismaRunCancellationEventDeferralUnitOfWork implements RunCancellationEventDeferralUnitOfWork
{
	/** Exact caller-owned cancellation transaction. */
	private readonly transaction: Prisma.TransactionClient;

	/** Bind repository construction to one transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Release one exact cleanup-event claim. */
	defer(command: RunCancellationEventDeferralCommand): Promise<boolean>
	{
		const repository = new PrismaRunCancellationEventDeferralRepository(this.transaction);
		return repository.defer(command);
	}
}
