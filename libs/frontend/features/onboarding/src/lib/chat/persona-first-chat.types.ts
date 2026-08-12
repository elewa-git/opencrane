import type { PersonaArchetypeTones } from "@opencrane/elements/ui";

/**
 * Which screen the first chat is showing. The page works it out; the component only renders it.
 *
 * `Reconnecting` and `Submitting` both disable the composer but keep the transcript on screen, so
 * the user never loses what they have written. `Error` is recoverable — a retry is offered.
 * `Completed` removes the composer entirely.
 */
export enum PersonaFirstChatStates
{
	/** The current calibration question accepts an owner answer. */
	AwaitingCalibration = "awaiting_calibration",
	/** The user's answer is being sent; the transcript stays visible and the composer is disabled. */
	Submitting = "submitting",
	/** The connection dropped and state is reloading; the saved transcript stays readable. */
	Reconnecting = "reconnecting",
	/** The server is checking the answers before finishing onboarding. */
	Finishing = "finishing",
	/** The authority has confirmed that all three calibration answers are complete. */
	Completed = "completed",
	/** A recoverable presentation error prevents the next answer from being submitted. */
	Error = "error"
}

/** Who said a line: the agent or the user. */
export enum PersonaFirstChatMessageRoles
{
	/** Message emitted by the approved personal agent snapshot. */
	Agent = "agent",
	/** Something the user typed. */
	Owner = "owner"
}

/**
 * The CSS class for the provenance strip, one per archetype.
 *
 * A fixed set rather than a template string, so no archetype value from the server can ever become
 * an arbitrary class name.
 */
export enum PersonaFirstChatArchetypeClasses
{
	/** Commander provenance treatment backed by the shared red archetype token. */
	Commander = "wo-first-chat__provenance--commander",
	/** Catalyst provenance treatment backed by the shared yellow archetype token. */
	Catalyst = "wo-first-chat__provenance--catalyst",
	/** Anchor provenance treatment backed by the shared green archetype token. */
	Anchor = "wo-first-chat__provenance--anchor",
	/** Analyst provenance treatment backed by the shared blue archetype token. */
	Analyst = "wo-first-chat__provenance--analyst"
}

/** Which of the three bootstrap questions: 1, 2 or 3. */
export type PersonaFirstChatQuestionOrdinal = 1 | 2 | 3;

/** The agent's name, initials and tone, as shown above the transcript. */
export interface PersonaFirstChatIdentity
{
	/** Human-readable agent name shown beside its avatar. */
	readonly name: string;
	/** Short stable initials rendered inside the shared avatar primitive. */
	readonly initials: string;
	/** Approved archetype treatment shared with the persona result surface. */
	readonly archetype: PersonaArchetypeTones;
}

/** Which persona revision and question set this conversation came from, shown so the user can check. */
export interface PersonaFirstChatProvenance
{
	/** Exact approved persona revision label exposed for owner verification. */
	readonly personaRevision: string;
	/** Human-readable archetype bootstrap-script name. */
	readonly scriptLabel: string;
	/** Exact reviewed bootstrap-script revision label. */
	readonly scriptRevision: string;
}

/** One line of the conversation, already in display order. */
export interface PersonaFirstChatTranscriptMessage
{
	/** Message id; use it as the track key so a reconnect does not rebuild the whole transcript. */
	readonly id: string;
	/** Speaker role that selects transcript alignment and accessible labelling. */
	readonly role: PersonaFirstChatMessageRoles;
	/** Plain conversation text rendered without HTML interpretation. */
	readonly body: string;
}

/** The question to show now, chosen by the server for this archetype. */
export interface PersonaFirstChatQuestion
{
	/** Stable question identifier returned with the answer intent. */
	readonly id: string;
	/** Which of the three questions this is. */
	readonly ordinal: PersonaFirstChatQuestionOrdinal;
	/** Reviewed archetype-specific question text. */
	readonly prompt: string;
}

/** What the composer emits when the user sends an answer. Sending it changes nothing on screen by itself. */
export interface PersonaFirstChatAnswerIntent
{
	/** Stable identifier of the question visible when Enter or Send was used. */
	readonly questionId: string;
	/** Trimmed non-empty answer supplied by the owner. */
	readonly answer: string;
}

/**
 * Everything the first-chat screen needs, and nothing more.
 *
 * Built by _ToPersonaFirstChatView from a server snapshot, so the component can be given plain data
 * and never has to know about snapshots, stores or workflow states. It exists only when the chat has
 * really started — a snapshot without a persona or content source cannot produce one, and the page
 * shows its preparing state instead.
 *
 * @see PersonaFirstChatSnapshot
 */
export interface PersonaFirstChatView
{
	/** Approved personal-agent identity rendered by the conversation surface. */
	readonly identity: PersonaFirstChatIdentity;
	/** Exact persona and bootstrap source provenance shown to the owner. */
	readonly provenance: PersonaFirstChatProvenance;
	/** The conversation, renamed for display but left in the server's order. */
	readonly transcript: readonly PersonaFirstChatTranscriptMessage[];
	/** Current server-selected question, or null after all answers. */
	readonly currentQuestion: PersonaFirstChatQuestion | null;
}
