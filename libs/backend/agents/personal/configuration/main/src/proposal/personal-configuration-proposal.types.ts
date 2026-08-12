import type { PersonalConfigurationPatch } from "./personal-configuration-patch.types.js";

/** Stable proposal outcomes and denial reasons owned by this package. */
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

/** Validation reason why the proposal authority may deny a future-session change. */
export type PersonalConfigurationProposalDenialReason =
	PersonalConfigurationProposalCodes.InvalidCommand;

/** Domain outcome for one proposal request. */
export type ProposePersonalConfigurationChangeResult =
	| { readonly outcome: PersonalConfigurationProposalCodes.Proposed; readonly changeId: string }
	| { readonly outcome: PersonalConfigurationProposalCodes.Denied; readonly reason: PersonalConfigurationProposalDenialReason };
