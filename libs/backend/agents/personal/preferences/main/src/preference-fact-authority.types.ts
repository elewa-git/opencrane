/** Provenance for one preference candidate or user-approved fact. */
export interface PreferenceFactProvenance
{
	/** Origin class that determines which durable source coordinate is valid. */
	readonly kind: "explicit_statement" | "conversation_message" | "interview" | "inferred";
	/** Immutable conversation message source, when the provenance is conversation-derived. */
	readonly messageId: string | null;
	/** Immutable persona interview source, when the preference arose during onboarding or refresh. */
	readonly interviewId: string | null;
	/** Explanation data shown when the owner inspects or corrects the fact. */
	readonly detail: Readonly<Record<string, unknown>>;
}

/** Request to record a new prompt-personalisation fact or a correction successor. */
export interface RecordPreferenceFactCommand
{
	/** Silo containing the profile and all provenance. */
	readonly siloId: string;
	/** User who owns the personal profile and approves this durable change. */
	readonly userId: string;
	/** Personal profile whose future runs may freeze the fact. */
	readonly personaProfileId: string;
	/** Stable semantic key used to group corrections of one preference. */
	readonly preferenceKey: string;
	/** Literal short instruction that the deterministic compiler can include in future prompts. */
	readonly statement: string;
	/** Candidate versus prompt-eligible accepted lifecycle state. */
	readonly state: "candidate" | "accepted";
	/** Owner consent required before a fact can enter future run inputs. */
	readonly consentState: "pending" | "explicit" | "confirmed";
	/** Explainable source of the fact. */
	readonly provenance: PreferenceFactProvenance;
	/** Confidence from zero to one, retained for transparent candidate review. */
	readonly confidence: number;
	/** Sensitive facts are never inferred. */
	readonly sensitivity: "ordinary" | "sensitive";
	/** Earlier accepted fact replaced by this correction, or null for a new preference. */
	readonly supersedesFactId: string | null;
	/** Owner or reviewed system identity that recorded the fact. */
	readonly recordedBy: string;
	/** User who accepted an initially prompt-eligible fact, or null for a candidate. */
	readonly acceptedBy: string | null;
	/** Stable idempotency key for retried recording. */
	readonly idempotencyKey: string;
}

/** Request to explicitly forget one candidate or accepted preference without deleting its history. */
export interface ForgetPreferenceFactCommand
{
	/** Silo containing the preference. */
	readonly siloId: string;
	/** User who owns the preference. */
	readonly userId: string;
	/** Personal profile that owns the preference. */
	readonly personaProfileId: string;
	/** Exact fact becoming unavailable to future admissions. */
	readonly preferenceFactId: string;
	/** Trusted server time at which the owner requested forgetting. */
	readonly forgottenAt: string;
}

/** Request to promote one owner candidate after explicit confirmation. */
export interface AcceptPreferenceFactCommand
{
	/** Silo containing the candidate. */
	readonly siloId: string;
	/** User who owns and confirms the candidate. */
	readonly userId: string;
	/** Personal profile that owns the candidate. */
	readonly personaProfileId: string;
	/** Exact candidate becoming eligible for future snapshots. */
	readonly preferenceFactId: string;
	/** User confirmation state retained with the acceptance. */
	readonly consentState: "explicit" | "confirmed";
	/** Principal recording the approval decision. */
	readonly acceptedBy: string;
	/** Trusted server time for the acceptance transition. */
	readonly acceptedAt: string;
}

/** Raw transaction result from recording one preference fact. */
export type AtomicRecordPreferenceFactResult = { readonly status: "recorded"; readonly preferenceFactId: string } | { readonly status: "idempotent"; readonly preferenceFactId: string } | { readonly status: "profile_unavailable" | "correction_conflict" | "persistence_unavailable" };

/** Raw transaction result from explicitly forgetting one preference fact. */
export type AtomicForgetPreferenceFactResult = { readonly status: "forgotten" } | { readonly status: "preference_unavailable" | "persistence_unavailable" };

/** Raw transaction result from promoting one candidate after owner confirmation. */
export type AtomicAcceptPreferenceFactResult = { readonly status: "accepted" } | { readonly status: "preference_unavailable" | "persistence_unavailable" };

/** Persistence boundary for user-controlled preference learning, correction, and forgetting. */
export interface PreferenceFactRepository
{
	/** Records a fact or correction successor without mutating its predecessor's evidence. */
	recordAtomically(command: RecordPreferenceFactCommand): Promise<AtomicRecordPreferenceFactResult>;
	/** Marks one owner fact forgotten so only later admissions stop selecting it. */
	forgetAtomically(command: ForgetPreferenceFactCommand): Promise<AtomicForgetPreferenceFactResult>;
	/** Promotes one same-owner candidate using explicit user confirmation. */
	acceptAtomically(command: AcceptPreferenceFactCommand): Promise<AtomicAcceptPreferenceFactResult>;
}

/** Stable public result from recording a new fact or correction successor. */
export type RecordPreferenceFactResult = { readonly outcome: "recorded"; readonly preferenceFactId: string; readonly idempotent: boolean } | { readonly outcome: "denied"; readonly reason: "invalid_command" | "profile_unavailable" | "correction_conflict" | "persistence_unavailable" };

/** Stable public result from explicitly forgetting a fact. */
export type ForgetPreferenceFactResult = { readonly outcome: "forgotten" } | { readonly outcome: "denied"; readonly reason: "invalid_command" | "preference_unavailable" | "persistence_unavailable" };

/** Stable public result from owner confirmation of a candidate preference. */
export type AcceptPreferenceFactResult = { readonly outcome: "accepted" } | { readonly outcome: "denied"; readonly reason: "invalid_command" | "preference_unavailable" | "persistence_unavailable" };
