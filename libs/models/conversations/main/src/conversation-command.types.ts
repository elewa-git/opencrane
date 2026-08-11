import type { ConversationModes, ConversationLifecycles } from "./conversation.types.js";

/**
 * Stable commands interpreted by the immutable conversation-mode strategy registry.
 *
 * Values are shared with adapters so unsupported commands cannot acquire behaviour implicitly.
 */
export enum ConversationCommandKinds
{
	/** Admit new participant input through the mode-correct message path. */
	SubmitMessage = "submit_message",
	/** Continue the currently active agent-session run with steering. */
	SteerRun = "steer_run",
	/** Answer an elicitation owned by the currently active agent-session run. */
	AnswerElicitation = "answer_elicitation",
	/** Permanently close the conversation for all future writes. */
	Close = "close",
}

/**
 * Stable allowed actions returned by conversation strategy decisions.
 *
 * These actions route a command to an existing authority and never perform persistence themselves.
 */
export enum ConversationCommandActions
{
	/** Route participant input through governed run admission. */
	AdmitAgentRun = "admit_agent_run",
	/** Persist an ordinary message without creating a synthetic run. */
	AdmitOrdinaryMessage = "admit_ordinary_message",
	/** Forward steering or elicitation to the exact currently active run. */
	TargetActiveRun = "target_active_run",
	/** Apply the only legal open-to-closed lifecycle transition. */
	CloseConversation = "close_conversation",
}

/**
 * Stable fail-closed reasons returned by conversation strategy decisions.
 *
 * Values distinguish malformed durable binding from lifecycle and mode denials for audit without granting authority.
 */
export enum ConversationCommandDenialReasons
{
	/** Persisted mode and optional agent-service binding violate the exact mode invariant. */
	InvalidAgentBinding = "invalid_agent_binding",
	/** Conversation lifecycle is closed and therefore denies every write. */
	ConversationClosed = "conversation_closed",
	/** Selected mode deliberately does not support this command. */
	CommandNotSupportedByMode = "command_not_supported_by_mode",
	/** Agent-session continuation has no active foreground run to target. */
	NoActiveRun = "no_active_run",
	/** Supplied run coordinate does not match the active foreground run. */
	ActiveRunMismatch = "active_run_mismatch",
	/** Command, mode, or lifecycle is outside the exhaustive owned vocabulary. */
	UnsupportedCommand = "unsupported_command",
}

/** Command that admits new participant input. */
export interface SubmitMessageConversationCommand
{
	/** Discriminant selecting mode-correct message admission. */
	readonly kind: ConversationCommandKinds.SubmitMessage;
}

/** Command that permanently closes an open conversation. */
export interface CloseConversationCommand
{
	/** Discriminant selecting the monotonic close transition. */
	readonly kind: ConversationCommandKinds.Close;
}

/** Command that steers one exact active agent-session run. */
export interface SteerRunConversationCommand
{
	/** Discriminant selecting active-run steering. */
	readonly kind: ConversationCommandKinds.SteerRun;
	/** Run coordinate that must equal the conversation's active foreground run. */
	readonly targetRunId: string;
}

/** Command that answers elicitation for one exact active agent-session run. */
export interface AnswerElicitationConversationCommand
{
	/** Discriminant selecting active-run elicitation response. */
	readonly kind: ConversationCommandKinds.AnswerElicitation;
	/** Run coordinate that must equal the conversation's active foreground run. */
	readonly targetRunId: string;
}

/** Exhaustive commands owned by the immutable conversation-mode strategies. */
export type ConversationCommand = SubmitMessageConversationCommand | CloseConversationCommand | SteerRunConversationCommand | AnswerElicitationConversationCommand;

/** Durable facts required for a pure conversation command decision. */
export interface ConversationCommandContext
{
	/** Immutable persisted mode selecting the behaviour strategy. */
	readonly mode: ConversationModes;
	/** Current monotonic lifecycle selecting open or closed state behaviour. */
	readonly lifecycle: ConversationLifecycles;
	/** Bound agent service, or null when the mode prohibits an agent binding. */
	readonly agentServiceId: string | null;
	/** Current foreground run, or null when no run may receive continuation commands. */
	readonly activeRunId: string | null;
	/** Requested write command. */
	readonly command: ConversationCommand;
}

/** Allowed pure strategy result routing a command to its owning authority. */
export interface AllowedConversationCommandDecision
{
	/** Positive result discriminant. */
	readonly allowed: true;
	/** Mode- and state-correct authority action. */
	readonly action: ConversationCommandActions;
}

/** Denied pure strategy result with one stable fail-closed reason. */
export interface DeniedConversationCommandDecision
{
	/** Negative result discriminant. */
	readonly allowed: false;
	/** Stable reason explaining the failed invariant or unsupported command. */
	readonly reason: ConversationCommandDenialReasons;
}

/** Pure exhaustive decision returned for every conversation state and command. */
export type ConversationCommandDecision = AllowedConversationCommandDecision | DeniedConversationCommandDecision;
