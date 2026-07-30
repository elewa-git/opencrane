import { AgentConfigPatchKinds } from "@opencrane/contracts";

/** Closed configuration change that a future personal revision authority may materialise. */
export type PersonalConfigurationPatch = { readonly kind: AgentConfigPatchKinds.PersonaRefresh } | { readonly kind: AgentConfigPatchKinds.ModelAlias; readonly modelAlias: string };

/** Stable proposal outcomes and persistence statuses owned by this package. */
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

/** Stable input and outcome codes for a proposal owner's explicit decision. */
export enum PersonalConfigurationDecisionCodes
{
	/** The owner consented to a later immutable configuration revision. */
	Accepted = "accepted",
	/** The owner declined the proposal with a reason. */
	Rejected = "rejected",
	/** The decision authority refused the caller-controlled request. */
	Denied = "denied",
	/** The accepted/rejected decision payload was malformed. */
	InvalidCommand = "invalid_command",
	/** No still-decidable proposal belongs to the supplied user and silo. */
	NotFoundOrNotOwner = "not_found_or_not_owner",
	/** A decision already made the proposal terminal. */
	AlreadyDecided = "already_decided",
	/** Persistence failed before an authoritative decision result was available. */
	PersistenceUnavailable = "persistence_unavailable",
}

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
	readonly sourceThreadId: string;
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

/** Atomic persistence result for one durable proposal. */
export type ProposePersonalConfigurationChangeResult =
	| { readonly outcome: PersonalConfigurationProposalCodes.Proposed; readonly changeId: string }
	| { readonly outcome: PersonalConfigurationProposalCodes.Denied; readonly reason: PersonalConfigurationProposalCodes.InvalidCommand | PersonalConfigurationProposalCodes.ProvenanceConflict | PersonalConfigurationProposalCodes.PersistenceUnavailable };

/** Explicit owner decision for one durable future-session proposal. */
export interface DecidePersonalConfigurationChangeCommand
{
	/** Silo that owns the proposal. */
	readonly siloId: string;
	/** Proposal owner who is allowed to decide it. */
	readonly userId: string;
	/** Immutable proposal identifier. */
	readonly changeId: string;
	/** Explicit state selected by the owner. */
	readonly decision: PersonalConfigurationDecisionCodes.Accepted | PersonalConfigurationDecisionCodes.Rejected;
	/** Required explanation only for rejection. */
	readonly rejectionReason: string | null;
	/** Trusted decision instant. */
	readonly decidedAt: string;
}

/** Stable outcome from attempting the owner decision. */
export type DecidePersonalConfigurationChangeResult = { readonly outcome: PersonalConfigurationDecisionCodes.Accepted | PersonalConfigurationDecisionCodes.Rejected } | { readonly outcome: PersonalConfigurationDecisionCodes.Denied; readonly reason: PersonalConfigurationDecisionCodes.InvalidCommand | PersonalConfigurationDecisionCodes.NotFoundOrNotOwner | PersonalConfigurationDecisionCodes.AlreadyDecided | PersonalConfigurationDecisionCodes.PersistenceUnavailable };

/** Persistence boundary for append-only personal configuration proposals. */
export interface PersonalConfigurationChangeRepository
{
	/** Inserts one proposal only when every source coordinate is owned by the same user and silo. */
	proposeAtomically(command: ProposePersonalConfigurationChangeCommand): Promise<{ readonly status: PersonalConfigurationProposalCodes.Proposed; readonly changeId: string } | { readonly status: PersonalConfigurationProposalCodes.ProvenanceConflict } | { readonly status: PersonalConfigurationProposalCodes.PersistenceUnavailable }>;
}

/** Extension port for the explicit decision lifecycle. */
export interface PersonalConfigurationChangeDecisionRepository
{
	/** Atomically accepts or rejects one still-proposed change owned by this user. */
	decideAtomically(command: DecidePersonalConfigurationChangeCommand): Promise<{ readonly status: PersonalConfigurationDecisionCodes.Accepted | PersonalConfigurationDecisionCodes.Rejected } | { readonly status: PersonalConfigurationDecisionCodes.NotFoundOrNotOwner | PersonalConfigurationDecisionCodes.AlreadyDecided | PersonalConfigurationDecisionCodes.PersistenceUnavailable }>;
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
	readonly sourceThreadId: string;
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
