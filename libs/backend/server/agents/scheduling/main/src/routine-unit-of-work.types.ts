import type { Prisma } from "@prisma/client";

import type { RoutineAuthorizationFactory, RoutineManagedGrantRepositoryFactory } from "./routine-authority.types";
import type { RoutineTaskAdmissionPort } from "./routine-workflow.types";

/** Transaction-bound collaborators required by the Prisma routine unit of work. */
export interface PrismaRoutineUnitOfWorkDependencies
{
	/** Builds central authorization over the exact transaction callback client. */
	readonly authorization: RoutineAuthorizationFactory<Prisma.TransactionClient>;
	/** Builds product-owned managed-grant projection over the same transaction. */
	readonly managedGrants: RoutineManagedGrantRepositoryFactory<Prisma.TransactionClient>;
	/** Admits schedule and occurrence tasks through the same product transaction. */
	readonly taskAdmission: RoutineTaskAdmissionPort<Prisma.TransactionClient>;
}
