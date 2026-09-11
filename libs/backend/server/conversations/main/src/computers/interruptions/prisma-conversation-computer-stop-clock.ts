import type { Prisma } from "@prisma/client";
import type { ConversationComputerStopClockRepository } from "./conversation-computer-stop.types";

/** Reads the runs-owned database clock used by Stop admission and cleanup fences. */
export class PrismaConversationComputerStopClockRepository implements ConversationComputerStopClockRepository
{
	/** Binds the clock read to the caller's existing transaction. */
	public constructor(private readonly transaction: Prisma.TransactionClient) {}

	/** Returns the database transaction's current authority time. */
	public async now(): Promise<Date>
	{
		const clock = await this.transaction.agentRunAuthorityClock.findUniqueOrThrow({ where: { singleton: 1 }, select: { now: true } });
		return clock.now;
	}
}
