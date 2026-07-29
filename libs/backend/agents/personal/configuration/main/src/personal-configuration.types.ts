import { AgentConfigPatchKinds } from "@opencrane/contracts";

/** Closed configuration change that a future personal revision authority may materialise. */
export type PersonalConfigurationPatch = { readonly kind: AgentConfigPatchKinds.PersonaRefresh } | { readonly kind: AgentConfigPatchKinds.ModelAlias; readonly modelAlias: string };

/**
 * Stable result codes for proposing a personal configuration change.
 *
 * The enum deliberately contains the public outcome and the narrower repository statuses because
 * the proposal authority maps repository refusals directly into its caller-visible reason. The
 * type aliases below still select only the members valid for each property, so a persistence status
 * cannot accidentally be returned as a successful outcome.
 */
export enum PersonalConfigurationProposalCodes
{
	/** A durable, provenance-bound proposal was recorded for a future run. */
	Proposed = "proposed",
	/** The proposal authority refused the request without recording a change. */
	Denied = "denied",
	/** One or more caller-supplied coordinates, timestamps, patch fields, or digests were invalid. */
	InvalidCommand = "invalid_command",
	/** The profile, conversation, run, and service no longer resolve to one owner and revision set. */
	ProvenanceConflict = "provenance_conflict",
	/** The proposal transaction failed before it could return an authoritative result. */
	PersistenceUnavailable = "persistence_unavailable",
}

/**
 * Stable request and result codes for an owner's personal configuration decision.
 *
 * `Accepted` and `Rejected` are persisted API values as well as valid input decisions. The remaining
 * members describe fail-closed authority results; keeping them named prevents router, service, and
 * persistence branches from drifting to slightly different spellings.
 */
export enum PersonalConfigurationDecisionCodes
{
	/** The owner consented to the proposed future configuration change. */
	Accepted = "accepted",
	/** The owner explicitly declined the proposal and supplied a human-readable reason. */
	Rejected = "rejected",
	/** The decision authority refused the request without changing proposal state. */
	Denied = "denied",
	/** The decision command was malformed or violated the accepted/rejected payload contract. */
	InvalidCommand = "invalid_command",
	/** No still-decidable proposal exists for the exact owner, silo, and change identifier. */
	NotFoundOrNotOwner = "not_found_or_not_owner",
	/** The proposal already has a terminal owner decision and cannot be decided again. */
	AlreadyDecided = "already_decided",
	/** The decision transaction failed before an authoritative state transition was recorded. */
	PersistenceUnavailable = "persistence_unavailable",
}

/**
 * Stable owner-visible lifecycle values for a personal configuration proposal.
 *
 * These lower-case strings are the API projection of the database lifecycle enum. The explicit
 * mapping keeps Prisma's storage names separate while ensuring a newly added database state cannot
 * be silently exposed under an unrelated fallback value.
 */
export enum PersonalConfigurationChangeViewStates
{
	/** The proposal is awaiting the owner's explicit accept-or-reject decision. */
	Proposed = "proposed",
	/** The owner accepted the proposal, but its downstream authority has not applied it yet. */
	Accepted = "accepted",
	/** The exact accepted proposal has been materialised into a later immutable revision. */
	Applied = "applied",
	/** The owner declined the proposal and no authority may apply it. */
	Rejected = "rejected",
	/** A newer proposal or revision made this proposal ineligible for application. */
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
