import type { Prisma } from "@prisma/client";

import type { RoutineAuthorizationFactory, RoutineManagedGrantRepositoryFactory } from "./routine-authority.types";
import type { RoutineTaskAdmissionPort } from "./routine-workflow.types";
import type { RoutineConversationDirectoryFactory, RoutineManagedServiceDirectoryFactory, RoutineRunHistoryRepositoryFactory } from "./routine-read.types";

/** Transaction-bound collaborators required by the Prisma routine unit of work. */
export interface PrismaRoutineUnitOfWorkDependencies
{
	/** Builds central authorization over the exact transaction callback client. */
	readonly authorization: RoutineAuthorizationFactory<Prisma.TransactionClient>;
	/** Builds product-owned managed-grant projection over the same transaction. */
	readonly managedGrants: RoutineManagedGrantRepositoryFactory<Prisma.TransactionClient>;
	/** Admits schedule and occurrence tasks through the same product transaction. */
	readonly taskAdmission: RoutineTaskAdmissionPort<Prisma.TransactionClient>;
	/** Builds the conversation-owned audience resolver over the same transaction. */
	readonly conversations: RoutineConversationDirectoryFactory<Prisma.TransactionClient>;
	/** Builds the agent-service-owned eligibility reader over the same transaction. */
	readonly managedServices: RoutineManagedServiceDirectoryFactory<Prisma.TransactionClient>;
	/** Builds the execution-owned run history reader over the same transaction. */
	readonly runHistory: RoutineRunHistoryRepositoryFactory<Prisma.TransactionClient>;
}
