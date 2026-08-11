import type { PersonalConfigurationPatch } from "../proposal/personal-configuration-patch.types.js";

/** Stable owner-visible lifecycle projection for a durable proposal. */
export enum PersonalConfigurationChangeViewStates
{
	/** The owner has not yet made a decision. */
	Proposed = "proposed",
	/** The owner accepted the proposal but it is not yet materialized. */
	Accepted = "accepted",
	/** The proposal has been copied to a new immutable agent revision. */
	Applied = "applied",
	/** The owner rejected the proposal. */
	Rejected = "rejected",
	/** A later persona or service change made the proposal ineligible. */
	Superseded = "superseded",
}

/** Product-safe owner view of one durable future-session configuration proposal. */
export interface PersonalConfigurationChangeView
{
	/** Opaque durable proposal identifier. */
	readonly changeId: string;
	/** Closed patch requested for a later immutable run snapshot. */
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

/** Read-only persistence boundary for the signed-in owner's configuration-proposal state. */
export interface PersonalConfigurationChangeViewRepository
{
	/** Lists at most fifty proposals belonging to the exact owner and selected silo. */
	listOwned(siloId: string, userId: string): Promise<readonly PersonalConfigurationChangeView[]>;
}
