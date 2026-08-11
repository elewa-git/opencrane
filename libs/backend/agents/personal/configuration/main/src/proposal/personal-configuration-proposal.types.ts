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
	/** Durable provenance no longer resolves to one owner and revision set. */
	ProvenanceConflict = "provenance_conflict",
	/** Persistence failed before an authoritative proposal result was available. */
	PersistenceUnavailable = "persistence_unavailable",
}

/** A durable request to change a personal agent only for a later immutable run snapshot. */
export interface ProposePersonalConfigurationChangeCommand
{
	/** Silo that owns every recorded source coordinate. */
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
	/** Closed, validated request payload retained for later materialisation. */
	readonly requestedPatch: PersonalConfigurationPatch;
	/** Canonical SHA-256 digest of the request payload. */
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
