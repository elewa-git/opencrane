import type { UserOnboardingAnswerStatuses, UserOnboardingBootstrapArchetypes, UserOnboardingChatMessageKinds, UserOnboardingChatRoles, UserOnboardingPersonaColours, UserOnboardingStates } from "./user-onboarding.enums.js";
import type { UserOnboardingOwner, UserOnboardingRecord } from "./user-onboarding.types.js";

/** Exact approved persona facts required to select and label the bootstrap script. */
export interface ApprovedPersonaBootstrapEvidence
{
	/** Immutable approved persona revision pinned by onboarding. */
	readonly personaRevisionId: string;
	/** Owner-visible name from the reviewed soul template. */
	readonly displayName: string;
	/** Approved archetype derived by the persona authority. */
	readonly archetype: UserOnboardingBootstrapArchetypes;
	/** Approved primary colour corresponding to the archetype. */
	readonly primaryColour: UserOnboardingPersonaColours;
}

/** One reviewed question in an immutable bootstrap script revision. */
interface UserOnboardingBootstrapQuestion
{
	/** One-based stable order within the script revision. */
	readonly ordinal: number;
	/** Exact reviewed owner-visible prompt. */
	readonly prompt: string;
}

/** Immutable structured bootstrap script selected from approved persona evidence. */
export interface UserOnboardingBootstrapContentRevision
{
	/** Stable immutable revision identity. */
	readonly id: string;
	/** Positive revision number within the archetype. */
	readonly revision: number;
	/** Persona archetype this script serves. */
	readonly archetype: UserOnboardingBootstrapArchetypes;
	/** Approved persona colour selecting this script. */
	readonly primaryColour: UserOnboardingPersonaColours;
	/** Repository-relative canonical design source. */
	readonly sourceLabel: string;
	/** SHA-256 digest of the exact canonical Markdown source. */
	readonly digest: string;
	/** Exact reviewed opening shown before the first question. */
	readonly opening: string;
	/** Exactly three reviewed ordered questions. */
	readonly questions: readonly UserOnboardingBootstrapQuestion[];
}

/** One append-only answer stored against the next ordered script question. */
interface UserOnboardingBootstrapAnswer
{
	/** Stable server-generated answer identity. */
	readonly id: string;
	/** One-based append order. */
	readonly ordinal: number;
	/** One-based script-question order. */
	readonly questionOrdinal: number;
	/** Bounded owner-submitted text after outer whitespace normalisation. */
	readonly text: string;
	/** Owner-supplied retry key unique only inside this conversation. */
	readonly idempotencyKey: string;
	/** Durable append time. */
	readonly answeredAt: Date;
}

/** Durable bootstrap conversation with every immutable owner, persona, and script pin. */
export interface UserOnboardingBootstrapConversation
{
	/** Stable onboarding-only conversation identity. */
	readonly id: string;
	/** UserOnboarding record that exclusively owns this conversation. */
	readonly onboardingId: string;
	/** Server-derived organisation silo. */
	readonly siloId: string;
	/** Server-derived authenticated subject. */
	readonly subjectId: string;
	/** Exact approved persona revision used at start. */
	readonly personaRevisionId: string;
	/** Frozen owner-visible persona name used at start. */
	readonly personaDisplayName: string;
	/** Frozen approved archetype used at start. */
	readonly personaArchetype: UserOnboardingBootstrapArchetypes;
	/** Exact immutable content revision. */
	readonly content: UserOnboardingBootstrapContentRevision;
	/** Durable ordered owner answers. */
	readonly answers: readonly UserOnboardingBootstrapAnswer[];
	/** Conversation start time. */
	readonly startedAt: Date;
}

/** One deterministic rendered transcript item. */
export interface UserOnboardingChatTranscriptItem
{
	/** One-based contiguous rendered order. */
	readonly ordinal: number;
	/** Stable speaker role. */
	readonly role: UserOnboardingChatRoles;
	/** Stable reviewed-content or owner-answer category. */
	readonly kind: UserOnboardingChatMessageKinds;
	/** Exact reviewed script text or exact normalised owner answer. */
	readonly text: string;
	/** One-based question coordinate for questions and answers. */
	readonly questionOrdinal: number | null;
}

/** Owner-visible persona pin in the chat projection. */
interface UserOnboardingChatPersonaProjection
{
	/** Exact immutable approved persona revision. */
	readonly revisionId: string;
	/** Approved owner-visible persona name. */
	readonly displayName: string;
	/** Approved bootstrap archetype. */
	readonly archetype: UserOnboardingBootstrapArchetypes;
	/** Approved display colour. */
	readonly primaryColour: UserOnboardingPersonaColours;
}

/** Owner-visible immutable script reference without hidden author guidance. */
interface UserOnboardingChatContentProjection
{
	/** Stable content revision identity. */
	readonly id: string;
	/** SHA-256 digest of the canonical Markdown bytes. */
	readonly digest: string;
	/** Repository-relative reviewed source label. */
	readonly sourceLabel: string;
}

/** Current question selected only by durable answer count. */
interface UserOnboardingCurrentQuestion
{
	/** One-based question order. */
	readonly ordinal: number;
	/** Exact reviewed prompt. */
	readonly text: string;
}

/** Complete deterministic projection returned by every bootstrap-chat endpoint. */
export interface UserOnboardingChatProjection
{
	/** Pinned onboarding workflow version. */
	readonly workflowVersion: number;
	/** Current server-owned workflow state. */
	readonly state: UserOnboardingStates;
	/** Onboarding-only conversation identity, or null before start. */
	readonly conversationId: string | null;
	/** Approved persona display pin, or null before approval. */
	readonly persona: UserOnboardingChatPersonaProjection | null;
	/** Selected immutable script pin, or null before approval. */
	readonly contentRevision: UserOnboardingChatContentProjection | null;
	/** Deterministic transcript rebuilt from immutable script and ordered answers. */
	readonly transcript: readonly UserOnboardingChatTranscriptItem[];
	/** Next server-selected question, or null when not started or all answered. */
	readonly currentQuestion: UserOnboardingCurrentQuestion | null;
	/** Number of durable answers. */
	readonly answerCount: number;
	/** Reviewed question count; zero before a script can be selected. */
	readonly questionCount: number;
	/** Whether the server currently admits conclusion. */
	readonly canConclude: boolean;
	/** Bootstrap conversation start time. */
	readonly startedAt: string | null;
	/** Completed onboarding time. */
	readonly completedAt: string | null;
}

/** Exact persistence command for starting one owner-bound conversation. */
export interface StartUserOnboardingChatCommand
{
	/** Server-generated conversation identifier. */
	readonly conversationId: string;
	/** Current durable onboarding record. */
	readonly onboarding: UserOnboardingRecord;
	/** Exact approved persona display and selection evidence. */
	readonly persona: ApprovedPersonaBootstrapEvidence;
	/** Exact immutable reviewed content revision. */
	readonly content: UserOnboardingBootstrapContentRevision;
}

/** Owner answer intent fenced to the exact server-projected conversation question. */
export interface SubmitUserOnboardingAnswerCommand
{
	/** Exact server-issued conversation the owner saw. */
	readonly expectedConversationId: string;
	/** Exact one-based server-issued question the owner answered. */
	readonly expectedQuestionOrdinal: number;
	/** Bounded owner-submitted answer text. */
	readonly text: string;
	/** Bounded conversation-local retry key. */
	readonly idempotencyKey: string;
}

/** Exact persistence command for one append-only answer. */
export interface AppendUserOnboardingAnswerCommand
{
	/** Server-generated answer identifier. */
	readonly answerId: string;
	/** Server-derived owner coordinates. */
	readonly owner: UserOnboardingOwner;
	/** Exact pinned conversation. */
	readonly conversationId: string;
	/** Exact one-based server-issued question the owner answered. */
	readonly questionOrdinal: number;
	/** Bounded normalised owner text. */
	readonly text: string;
	/** Bounded owner retry key. */
	readonly idempotencyKey: string;
}

/** Durable append outcome plus the winning answer when a retry collided. */
export interface UserOnboardingAnswerPersistenceResult
{
	/** Whether a row was created, resumed, or conflicted. */
	readonly status: UserOnboardingAnswerStatuses.Recorded | UserOnboardingAnswerStatuses.Resumed | UserOnboardingAnswerStatuses.IdempotencyConflict | UserOnboardingAnswerStatuses.StateConflict;
}

/** Persistence boundary for immutable script, conversation, answer, and conclusion facts. */
export interface UserOnboardingChatRepository
{
	/** Select the current reviewed revision for one approved persona colour. */
	readContentForColour(primaryColour: UserOnboardingPersonaColours): Promise<UserOnboardingBootstrapContentRevision | null>;
	/** Read one owner-bound conversation and its exact script and ordered answers. */
	readConversation(owner: UserOnboardingOwner): Promise<UserOnboardingBootstrapConversation | null>;
	/** Atomically pin one conversation, persona, and content revision while advancing workflow state. */
	startConversation(command: StartUserOnboardingChatCommand): Promise<boolean>;
	/** Append only the next question answer with conversation-local idempotency. */
	appendAnswer(command: AppendUserOnboardingAnswerCommand): Promise<UserOnboardingAnswerPersistenceResult>;
	/** Complete onboarding only for the exact pinned three-answer conversation. */
	conclude(owner: UserOnboardingOwner, conversationId: string, completedAt: Date): Promise<boolean>;
}

/** Public answer call result used by the HTTP boundary. */
export interface UserOnboardingAnswerResult
{
	/** Stable append outcome. */
	readonly status: UserOnboardingAnswerStatuses;
	/** Current authoritative chat projection. */
	readonly chat: UserOnboardingChatProjection;
}
