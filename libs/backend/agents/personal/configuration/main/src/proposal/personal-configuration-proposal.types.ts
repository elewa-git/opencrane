import type { PersonalConfigurationPatch } from "./personal-configuration-patch.types.js";

/**
 * What recording a new configuration proposal came back with.
 *
 * A proposal is a request only: it changes nothing about the agent until its owner decides it
 * and a materialisation step applies it. `Proposed` therefore means "recorded for later
 * review", not "in effect".
 *
 * `ProvenanceConflict` is the one that needs care. It means the conversation, run, agent
 * service or persona profile named in the command is not owned by this user, or its active
 * revision moved on between the agent reading it and this insert. Retrying with the same
 * command cannot fix it — the expected revision ids are stale and must be re-read.
 * `PersistenceUnavailable` is the only retryable code.
 */
export enum PersonalConfigurationProposalCodes
{
	/** A durable future-revision proposal was recorded. */
	Proposed = "proposed",
	/** The authority refused the caller-controlled proposal. */
	Denied = "denied",
	/** Command coordinates, timestamp, patch, or digest were invalid. */
	InvalidCommand = "invalid_command",
	/**
	 * The conversation, run, agent service or persona profile is not owned by this user and silo,
	 * or its active revision changed since the agent read it. Re-read the current revisions before
	 * proposing again; the same command will keep failing.
	 */
	ProvenanceConflict = "provenance_conflict",
	/** The only retryable code: the write failed and whether a proposal row was created is
	 * unknown. Re-read the user's proposals rather than proposing again blindly. */
	PersistenceUnavailable = "persistence_unavailable",
}

/**
 * A recorded request to change a personal agent. It applies only to a later run, never the one
 * that asked for it.
 *
 * The `source*` fields say where the request came from and are all re-checked against the
 * database before the row is written, so a proposal can never be attributed to a conversation
 * or run the user does not own. The two `expected*RevisionId` fields freeze what the agent was
 * when the user asked; if either has moved on by the time the proposal is applied, the proposal
 * is refused as stale rather than applied to an agent the user never saw.
 *
 * `requestedPatchDigest` must be the canonical-JSON digest of `requestedPatch`; a mismatch is
 * refused as `InvalidCommand`.
 */
export interface ProposePersonalConfigurationChangeCommand
{
	/** Silo that owns the conversation, run, service, and profile below. */
	readonly siloId: string;
	/** User who initiated the change. */
	readonly userId: string;
	/** Personal persona profile whose active revision was observed. */
	readonly personaProfileId: string;
	/** Personal AgentService whose active revision was observed. */
	readonly agentServiceId: string;
	/** Conversation that supplied the request. */
	readonly sourceConversationId: string;
	/** Canonical run that recorded the request. */
	readonly sourceRunId: string;
	/** Optional message that caused the request. */
	readonly sourceMessageId: string | null;
	/** The validated patch, kept for materialisation later. */
	readonly requestedPatch: PersonalConfigurationPatch;
	/**
	 * `sha256:<hex>` digest of `requestedPatch` in canonical JSON form. A digest that does not
	 * match the patch is refused as `InvalidCommand`, so this field cannot disagree with the patch
	 * stored beside it.
	 *
	 * @see https://www.rfc-editor.org/rfc/rfc8785 — RFC 8785 (JSON Canonicalization Scheme), which
	 * fixes the key order and escaping the digest is taken over.
	 */
	readonly requestedPatchDigest: string;
	/** Active persona revision that must still be current before application. */
	readonly expectedPersonaRevisionId: string | null;
	/** Active agent revision that must still be current before application. */
	readonly expectedAgentRevisionId: string | null;
	/** Trusted proposal instant. */
	readonly proposedAt: string;
}

/** The result of proposing one change: the new id, or a denial reason. */
export type ProposePersonalConfigurationChangeResult =
	| { readonly outcome: PersonalConfigurationProposalCodes.Proposed; readonly changeId: string }
	| { readonly outcome: PersonalConfigurationProposalCodes.Denied; readonly reason: PersonalConfigurationProposalCodes.InvalidCommand | PersonalConfigurationProposalCodes.ProvenanceConflict | PersonalConfigurationProposalCodes.PersistenceUnavailable };

/**
 * Records one new personal configuration proposal.
 *
 * This port only ever inserts. Deciding and applying a proposal go through separate ports, and
 * the database trigger rejects any change to the request fields once the row exists, so the
 * recorded request stays exactly what the user asked for.
 *
 * Called by: {@link __ProposePersonalConfigurationChange}.
 *
 * @see {@link PrismaPersonalConfigurationProposalUnitOfWork} for the implementation, and
 * {@link PersonalConfigurationProposalRepository} for the transaction-scoped variant it wraps.
 */
export interface PersonalConfigurationChangeRepository
{
	/**
	 * Re-checks ownership, then inserts the proposal in one transaction.
	 *
	 * @param command - The request to record, already validated by the caller.
	 * @returns `Proposed` with the new `changeId`; `ProvenanceConflict` when the conversation,
	 * run, service or profile is not this user's or its active revision moved on;
	 * `PersistenceUnavailable` when the write failed. Must not throw for these three.
	 */
	proposeAtomically(command: ProposePersonalConfigurationChangeCommand): Promise<{ readonly status: PersonalConfigurationProposalCodes.Proposed; readonly changeId: string } | { readonly status: PersonalConfigurationProposalCodes.ProvenanceConflict } | { readonly status: PersonalConfigurationProposalCodes.PersistenceUnavailable }>;
}
