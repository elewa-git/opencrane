import type { Prisma } from "@prisma/client";

import type { PrismaRunTreeRepository } from "../prisma-run-tree-repository";

/** Isolated identities and an original deadline shared by one SQL test's runs. */
export interface RunTreeSqlFixture
{
	/** Restricts every synthetic run and service to this test. */
	readonly siloId: string;
	/** Identifies the managed service used by the synthetic snapshots. */
	readonly serviceId: string;
	/** Identifies the service's published revision. */
	readonly revisionId: string;
	/** Identifies the model selected by the synthetic attempt credential. */
	readonly modelId: string;
	/** Identifies the original human whose synthetic Stop evidence is stored. */
	readonly requesterId: string;
	/** Records the original deadline without changing it between child fixtures. */
	readonly deadlineAt: Date;
	/** Lists the independently admitted, initially accepted runs. */
	readonly runIds: readonly string[];
}

/** A database-only command repeated in full after a proven Serializable rollback. */
export type RunTreeSqlOperation<Result> = (transaction: Prisma.TransactionClient, repository: PrismaRunTreeRepository) => Promise<Result>;

/** Coordinates two already-open transactions without a timing-based sleep. */
export interface RunTreeSqlSignal
{
	/** Resolves when the other transaction reached the required checkpoint. */
	readonly promise: Promise<void>;
	/** Releases the waiting transaction after its prerequisite is observed. */
	readonly resolve: () => void;
	/** Releases the waiting transaction with a setup failure instead of leaving it blocked. */
	readonly reject: (error: unknown) => void;
}
