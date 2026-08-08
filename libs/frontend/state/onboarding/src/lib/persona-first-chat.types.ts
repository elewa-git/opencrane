import { InjectionToken } from "@angular/core";

/** Durable server-owned workflow stages that determine the next onboarding route. */
export enum UserOnboardingRouteStates
{
	/** The reviewed persona interview has not started. */
	SurveyPending = "survey_pending",
	/** The reviewed persona interview is active. */
	SurveyInProgress = "survey_in_progress",
	/** An approved persona is ready for its one-time bootstrap exchange. */
	BootstrapChatPending = "bootstrap_chat_pending",
	/** The one-time bootstrap exchange has started and remains resumable. */
	BootstrapChatInProgress = "bootstrap_chat_in_progress",
	/** Server-validated bootstrap evidence admitted completion. */
	Completed = "completed"
}

/** Reviewed archetypes that select one immutable first-chat source. */
export enum PersonaFirstChatArchetypes
{
	/** Direct and decisive first-chat pacing. */
	Commander = "commander",
	/** Energetic and collaborative first-chat pacing. */
	Catalyst = "catalyst",
	/** Calm and supportive first-chat pacing. */
	Anchor = "anchor",
	/** Precise and structured first-chat pacing. */
	Analyst = "analyst"
}

/** Persona colour values returned with exact approved-revision evidence. */
export enum PersonaFirstChatColours
{
	/** Commander colour coordinate. */
	Red = "red",
	/** Catalyst colour coordinate. */
	Yellow = "yellow",
	/** Anchor colour coordinate. */
	Green = "green",
	/** Analyst colour coordinate. */
	Blue = "blue"
}

/** Server-authored transcript speaker roles. */
export enum PersonaFirstChatTranscriptRoles
{
	/** Reviewed opening or question material. */
	Assistant = "assistant",
	/** Immutable owner answer evidence. */
	User = "user"
}

/** Finite transcript entry kinds emitted by the onboarding authority. */
export enum PersonaFirstChatTranscriptKinds
{
	/** One-time reviewed introduction. */
	Opening = "opening",
	/** One of the exact three reviewed calibration questions. */
	Question = "question",
	/** One admitted owner answer. */
	Answer = "answer"
}

/** Exact approved persona evidence selected for the bootstrap exchange. */
export interface PersonaFirstChatPersona
{
	/** Immutable approved persona revision identifier. */
	readonly revisionId: string;
	/** Reviewed human-readable persona name. */
	readonly displayName: string;
	/** Reviewed bootstrap archetype selected from the persona revision. */
	readonly archetype: PersonaFirstChatArchetypes;
	/** Exact primary colour carried by the approved persona revision. */
	readonly primaryColour: PersonaFirstChatColours;
}

/** Immutable retrievable bootstrap source pinned to one conversation. */
export interface PersonaFirstChatContentRevision
{
	/** Stable source revision identifier. */
	readonly id: string;
	/** SHA-256 integrity digest of the canonical reviewed source. */
	readonly digest: string;
	/** Human-readable reviewed source label. */
	readonly sourceLabel: string;
}

/** One immutable server-projected transcript entry. */
export interface PersonaFirstChatTranscriptEntry
{
	/** Contiguous one-based display order; it is not a database identifier. */
	readonly ordinal: number;
	/** Speaker role selecting safe presentation alignment. */
	readonly role: PersonaFirstChatTranscriptRoles;
	/** Finite provenance kind for the rendered text. */
	readonly kind: PersonaFirstChatTranscriptKinds;
	/** Plain bounded text rendered without HTML interpretation. */
	readonly text: string;
	/** One-based calibration question coordinate, when the entry belongs to a question. */
	readonly questionOrdinal: number | null;
}

/** Current reviewed question selected by durable answer count. */
export interface PersonaFirstChatCurrentQuestion
{
	/** One-based coordinate within the exact three-question source. */
	readonly ordinal: number;
	/** Reviewed question text. */
	readonly text: string;
}

/** Complete resumable first-chat projection returned by every successful endpoint. */
export interface PersonaFirstChatSnapshot
{
	/** Workflow definition version pinned to the owner record. */
	readonly workflowVersion: number;
	/** Current durable onboarding route state. */
	readonly state: UserOnboardingRouteStates;
	/** One onboarding-only conversation identifier, once started. */
	readonly conversationId: string | null;
	/** Exact approved persona evidence, once the chat starts. */
	readonly persona: PersonaFirstChatPersona | null;
	/** Exact immutable reviewed source, once the chat starts. */
	readonly contentRevision: PersonaFirstChatContentRevision | null;
	/** Canonical transcript in server-owned display order. */
	readonly transcript: readonly PersonaFirstChatTranscriptEntry[];
	/** Next reviewed question, or null before start and after all answers. */
	readonly currentQuestion: PersonaFirstChatCurrentQuestion | null;
	/** Number of immutable answers admitted by the server. */
	readonly answerCount: number;
	/** Number of reviewed questions pinned to this exchange. */
	readonly questionCount: number;
	/** Whether the current durable evidence is eligible for server conclusion. */
	readonly canConclude: boolean;
	/** Server timestamp for the started conversation, or null before start. */
	readonly startedAt: string | null;
	/** Server timestamp for validated workflow completion, or null while unfinished. */
	readonly completedAt: string | null;
}

/** Public route-state projection used to navigate only from durable workflow evidence. */
export interface UserOnboardingRouteSnapshot
{
	/** Workflow definition version pinned to the owner record. */
	readonly workflowVersion: number;
	/** Current durable onboarding route state. */
	readonly state: UserOnboardingRouteStates;
	/** Exact persona interview pinned to the survey, when present. */
	readonly personaInterviewId: string | null;
	/** Exact approved persona revision pinned to onboarding, when present. */
	readonly personaRevisionId: string | null;
	/** Exact onboarding-only conversation, once started. */
	readonly bootstrapConversationId: string | null;
	/** Server timestamp for workflow creation. */
	readonly startedAt: string;
	/** Server timestamp for the last durable workflow change. */
	readonly updatedAt: string;
	/** Server timestamp for validated completion, or null while unfinished. */
	readonly completedAt: string | null;
}

/** Exact server-issued coordinates and retry identity for one answer intent. */
export interface PersonaFirstChatAnswerCommand
{
	/** Conversation identifier returned by the authoritative projection. */
	readonly expectedConversationId: string;
	/** One-based question ordinal returned by the authoritative projection. */
	readonly expectedQuestionOrdinal: number;
	/** Owner answer retained verbatim until server admission. */
	readonly text: string;
	/** Retry-stable conversation-local idempotency key. */
	readonly idempotencyKey: string;
}

/** Authoritative conflict carrying the durable position that rejected an answer. */
export class PersonaFirstChatConflictError extends Error
{
	/** Latest valid projection returned by the onboarding authority. */
	readonly chat: PersonaFirstChatSnapshot;

	/** Preserve safe recovery evidence without exposing transport internals. */
	constructor(chat: PersonaFirstChatSnapshot)
	{
		super("The saved conversation advanced elsewhere. Review the current question before sending again.");
		this.chat = chat;
	}
}

/** Narrow generated-client gateway for durable first-chat orchestration. */
export interface PersonaFirstChatGateway
{
	/** Load the public server-owned route state without starting a chat. */
	loadRouteState(): Promise<UserOnboardingRouteSnapshot>;
	/** Resume the exact current first-chat projection without mutating it. */
	load(): Promise<PersonaFirstChatSnapshot>;
	/** Create or resume the one onboarding-only conversation. */
	start(): Promise<PersonaFirstChatSnapshot>;
	/** Admit one answer under a retry-stable idempotency key. */
	answer(command: PersonaFirstChatAnswerCommand): Promise<PersonaFirstChatSnapshot>;
	/** Ask the server to conclude only after it validates complete evidence. */
	conclude(): Promise<PersonaFirstChatSnapshot>;
}

/** Dependency-injection token for the active first-chat API adapter. */
export const PERSONA_FIRST_CHAT_GATEWAY: InjectionToken<PersonaFirstChatGateway> = new InjectionToken<PersonaFirstChatGateway>("PERSONA_FIRST_CHAT_GATEWAY");
