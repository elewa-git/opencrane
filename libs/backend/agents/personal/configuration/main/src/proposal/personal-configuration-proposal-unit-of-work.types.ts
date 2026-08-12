import { PersonalConfigurationProposalCodes, type ProposePersonalConfigurationChangeCommand } from "./personal-configuration-proposal.types.js";

/**
 * What the insert returned from inside the proposal transaction.
 *
 * Narrower than {@link ProposePersonalConfigurationChangeResult}: there is no
 * `PersistenceUnavailable` here, because a failed write leaves the transaction rather than
 * returning. The outer unit of work turns that into the caller-facing code.
 */
export type PersonalConfigurationProposalPersistenceResult =
	| { readonly status: PersonalConfigurationProposalCodes.Proposed; readonly changeId: string }
	| { readonly status: PersonalConfigurationProposalCodes.ProvenanceConflict };

/**
 * Checks a proposal's sources belong to the caller, then inserts it — both inside one transaction.
 *
 * The two steps must share a transaction: checking ownership and then inserting in separate
 * transactions would let a conversation change hands in between, and the proposal would be
 * recorded against a run the user no longer owns.
 *
 * Called by: {@link PrismaPersonalConfigurationProposalUnitOfWork.proposeAtomically}, through
 * {@link PersonalConfigurationProposalTransaction}.
 *
 * @see {@link PrismaPersonalConfigurationProposalRepository} for the only implementation.
 */
export interface PersonalConfigurationProposalRepository
{
	/**
	 * @param command - The request to record.
	 * @returns `Proposed` with the new `changeId`, or `ProvenanceConflict` when the profile,
	 * conversation, run or service does not match this user and silo, or when either expected
	 * revision is no longer the active one.
	 * @throws Prisma.PrismaClientKnownRequestError (code P0001) when the database's own lifecycle
	 * trigger rejects the insert; the caller translates that into `ProvenanceConflict`.
	 */
	propose(command: ProposePersonalConfigurationChangeCommand): Promise<PersonalConfigurationProposalPersistenceResult>;
}

/** Repositories sharing one proposal transaction. */
export interface PersonalConfigurationProposalTransaction
{
	/** Writes to the personal configuration proposal table. */
	readonly proposals: PersonalConfigurationProposalRepository;
}

/** Work executed against the proposal transaction's repository set. */
export type PersonalConfigurationProposalWork<Result> = (transaction: PersonalConfigurationProposalTransaction) => Promise<Result>;

/**
 * Opens the transaction that one proposal insert runs in.
 *
 * Called by: {@link PrismaPersonalConfigurationProposalUnitOfWork.proposeAtomically}.
 *
 * @see {@link PersonalConfigurationProposalWork} for what the caller passes in.
 */
export interface PersonalConfigurationProposalUnitOfWork
{
	/** Runs the work in one database transaction. */
	run<Result>(work: PersonalConfigurationProposalWork<Result>): Promise<Result>;
}
