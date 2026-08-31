import type { PrismaClient } from "@prisma/client";

import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";

import type { ScheduleTickerTransaction, ScheduleTickerUnitOfWork, ScheduleTickerWork } from "./schedule-ticker-unit-of-work.types";
import { PrismaActiveScheduledRunRepository, PrismaEnabledScheduleSnapshotRepository, PrismaScheduleCursorRepository } from "./prisma-schedule-tick-repositories";

/** Prisma implementation of the scheduler-specific opaque unit of work. */
export class PrismaScheduleTickerUnitOfWork implements ScheduleTickerUnitOfWork
{
	/** Canonical product-authority client owned only by this transaction boundary. */
	private readonly prisma: PrismaClient;

	/** Creates the scheduler unit of work over canonical Postgres. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/** Runs one deliberately short persistence operation before or after external run admission. */
	async run<Result>(work: ScheduleTickerWork<Result>): Promise<Result>
	{
		return ___RunInPrismaUnitOfWork(this.prisma, async function _RunTransaction(transaction): Promise<Result>
		{
			const repositories: ScheduleTickerTransaction = {
				schedules: new PrismaEnabledScheduleSnapshotRepository(transaction),
				activeScheduledRuns: new PrismaActiveScheduledRunRepository(transaction),
				cursors: new PrismaScheduleCursorRepository(transaction),
			};
			return work(repositories);
		}, { isolationLevel: "ReadCommitted", operation: "schedule tick" });
	}
}
