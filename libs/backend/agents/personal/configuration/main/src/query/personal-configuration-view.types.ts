import type { PersonalConfigurationPatch } from "../proposal/personal-configuration-patch.types.js";

/**
 * The proposal states a user is shown.
 *
 * `Accepted` and `Applied` are the pair to keep apart: `Accepted` means the owner agreed but no
 * revision exists yet, so the agent still behaves as before; `Applied` means a new immutable
 * revision was created and later runs will use it. Showing `Accepted` as though the change were
 * live tells the user their agent changed when it has not.
 *
 * `Superseded` needs no user action beyond proposing again — a later persona or service change
 * made this proposal unusable.
 */
export enum PersonalConfigurationChangeViewStates
{
	/** The owner has not yet made a decision. */
	Proposed = "proposed",
	/** The owner accepted it, but no revision exists yet and the agent still behaves as before. */
	Accepted = "accepted",
	/** The proposal has been copied to a new immutable agent revision. */
	Applied = "applied",
	/** The owner rejected the proposal. */
	Rejected = "rejected",
	/** A later persona or service change made the proposal ineligible. */
	Superseded = "superseded",
}

/** What a user is shown about one of their configuration proposals. */
export interface PersonalConfigurationChangeView
{
	/** Opaque durable proposal identifier. */
	readonly changeId: string;
	/** The change requested, which applies only to a later run. */
	readonly requestedPatch: PersonalConfigurationPatch;
	/** Current durable proposal lifecycle state. */
	readonly state: PersonalConfigurationChangeViewStates;
	/** Conversation source that prompted the proposal. */
	readonly sourceConversationId: string;
	/** Run source that recorded the proposal. */
	readonly sourceRunId: string;
	/** Server time the proposal was created. */
	readonly proposedAt: string;
	/** Server time it was decided, when applicable. */
	readonly decidedAt: string | null;
	/** Owner-provided reason for a rejection, when applicable. */
	readonly rejectionReason: string | null;
}

/**
 * Reads the signed-in user's own configuration proposals. Never writes.
 *
 * Called by: the list route handler, as `dependencies.changes`.
 *
 * @see {@link PrismaPersonalConfigurationViewRepository} for the only implementation.
 */
export interface PersonalConfigurationChangeViewRepository
{
	/**
	 * @param siloId - Silo derived from the request host, never from request input.
	 * @param userId - Signed-in user; only their own proposals are returned.
	 * @returns At most fifty proposals, newest first. There is no paging, so an older proposal
	 * can fall off the end — a caller must not treat this as the user's complete history.
	 * @throws Error when a stored patch is not a supported shape.
	 */
	listOwned(siloId: string, userId: string): Promise<readonly PersonalConfigurationChangeView[]>;
}
