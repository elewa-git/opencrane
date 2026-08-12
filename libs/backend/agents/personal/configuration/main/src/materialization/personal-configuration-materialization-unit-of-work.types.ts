import type { AgentRevisionModelSelectionRepository } from "@opencrane/backend/server/agents/agent-services";

import type { MaterializePersonalConfigurationChangeCommand, PersonalConfigurationMaterializationPersistenceResult } from "./personal-configuration-materialization.types.js";
import type { PersonalConfigurationMaterializationResolution } from "./personal-configuration-materialization-state.types.js";

/**
 * Reads a proposal for materialisation and, at the very end, marks it applied.
 *
 * Split into two methods on purpose. {@link PersonalConfigurationMaterializationRepository.resolve}
 * runs first and touches nothing; {@link PersonalConfigurationMaterializationRepository.apply}
 * runs last, after agent-services has already created the revision, so that if the proposal
 * turns out to be no longer accepted, the revision rolls back with it.
 *
 * Called by: {@link _PersonalConfigurationMaterializer.materializeAtomically}, through
 * {@link PersonalConfigurationMaterializationTransaction}.
 */
export interface PersonalConfigurationMaterializationRepository
{
	/**
	 * Reads the proposal and decides whether it can be materialised. Writes nothing.
	 *
	 * @param command - Server-derived owner, proposal id and time.
	 * @returns `Ready` with the fields agent-services needs, or `Terminal` with a final result
	 * the caller must return as-is without writing anything.
	 */
	resolve(command: MaterializePersonalConfigurationChangeCommand): Promise<PersonalConfigurationMaterializationResolution>;
	/**
	 * Moves the proposal to Applied, only while it is still Accepted. Must be the last write.
	 *
	 * @param command - Server-derived owner, proposal id and time.
	 * @param agentRevisionId - The revision agent-services just created.
	 * @returns `Applied` with that revision id.
	 * @throws Error when the compare-and-set matches no row, or the database trigger rejects the
	 * transition because the persona revision moved on. Throwing is deliberate: it rolls the
	 * agent-service writes back too, so a revision can never outlive its proposal.
	 */
	apply(command: MaterializePersonalConfigurationChangeCommand, agentRevisionId: string): Promise<PersonalConfigurationMaterializationPersistenceResult>;
}

/**
 * The two repositories that share one materialisation transaction: this package's proposal rows,
 * and agent-services' revision rows.
 *
 * Both are built fresh for each attempt, so nothing from a rolled-back attempt is reused.
 */
export interface PersonalConfigurationMaterializationTransaction
{
	/** Reads and updates the personal configuration proposal row. */
	readonly proposals: PersonalConfigurationMaterializationRepository;
	/** Agent-revision repository owned by agent-services. */
	readonly agentRevisions: AgentRevisionModelSelectionRepository;
}

/** A caller's function that runs against both repositories in the transaction. */
export type PersonalConfigurationMaterializationWork<Result> = (transaction: PersonalConfigurationMaterializationTransaction) => Promise<Result>;

/**
 * Opens the single transaction in which the proposal and the agent revision both change.
 *
 * This is the only place the two domains meet. Because both writes share the transaction,
 * there is no state in which a new revision exists but its proposal is still Accepted.
 *
 * Called by: {@link _PersonalConfigurationMaterializer.materializeAtomically}; supplied by
 * `_CreatePersonalConfigurationRouter`.
 *
 * @see {@link PrismaPersonalConfigurationMaterializationUnitOfWork} for the only implementation.
 */
export interface PersonalConfigurationMaterializationUnitOfWork
{
	/**
	 * Runs the work at Serializable isolation, retrying it while conflicts remain retryable.
	 *
	 * @param work - Runs once per attempt, so it must be safe to repeat; both repositories are
	 * rebuilt for each attempt.
	 * @returns Whatever the work returned on the attempt that committed.
	 * @throws Error for any unexpected failure, and for a conflict still present after the last
	 * attempt, so the caller can log it once and report a fail-closed result.
	 */
	run<Result>(work: PersonalConfigurationMaterializationWork<Result>): Promise<Result>;
}
