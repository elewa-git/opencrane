import type { AgentRevisionContent } from "@opencrane/models/agents";

/** Complete immutable evidence required to append one agent revision within an existing transaction. */
export interface CreateAgentRevisionWithinTransactionCommand
{
	/** Silo copied onto nested integration assignments for the owning service. */
	readonly siloId: string;
	/** Stable service that owns the revision lineage. */
	readonly agentServiceId: string;
	/** Monotonic revision number within the service. */
	readonly revision: number;
	/** Current lineage head from which the new revision derives. */
	readonly parentRevisionId: string | null;
	/** Historical revision cloned by a restore, otherwise null. */
	readonly sourceRevisionId: string | null;
	/** Complete executable content used for both persistence and digest calculation. */
	readonly content: AgentRevisionContent;
	/** Human-readable explanation of why the revision was created. */
	readonly changeMessage: string;
	/** Trusted subject that authored the revision. */
	readonly authoredBy: string;
	/** Trusted creation instant. */
	readonly createdAt: Date;
}

/**
 * Writes one new agent revision inside a transaction the caller owns.
 *
 * `Row` is left generic so a caller can get back whatever include shape it needs without this
 * package depending on the caller's query.
 *
 * Implemented by: `PrismaAgentRevisionWriterRepository` in `prisma-agent-revision-writer.ts`.
 */
export interface AgentRevisionWriterRepository<Row = unknown>
{
	/** Creates one draft revision and every immutable assignment inside the current transaction. */
	createDraft(command: CreateAgentRevisionWithinTransactionCommand): Promise<Row>;
}
