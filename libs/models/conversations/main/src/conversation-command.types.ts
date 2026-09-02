import type { ConversationModes, ConversationLifecycles } from "./conversation.types";

/**
 * Stable commands interpreted by the immutable conversation-mode strategy registry.
 *
 * Values are shared with adapters so unsupported commands cannot acquire behaviour implicitly.
 */
export enum ConversationCommandKinds
{
	/** Submit a new message. What that does depends on the conversation's mode. */
	SubmitMessage = "submit_message",
	/** Continue the currently active agent-session run with steering. */
	SteerRun = "steer_run",
	/** Answer an elicitation owned by the currently active agent-session run. */
	AnswerElicitation = "answer_elicitation",
	/** Permanently close the conversation for all future writes. */
	Close = "close",
}

/**
 * What a caller is permitted to do after {@link __DecideConversationCommand} allows a command.
 *
 * Each value names exactly one thing to perform. The decision itself writes nothing, so the caller
 * must carry out the named action and must not perform any other write on the strength of an
 * allowed decision.
 */
export enum ConversationCommandActions
{
	/** Persist an ordinary message without creating a synthetic run. */
	AdmitOrdinaryMessage = "admit_ordinary_message",
	/** Forward steering or elicitation to the exact currently active run. */
	TargetActiveRun = "target_active_run",
	/** Apply the only legal open-to-closed lifecycle transition. */
	CloseConversation = "close_conversation",
}

/**
 * Frames exchanged by the browser conversation socket for participant submissions.
 *
 * The browser adapter and server transport branch on these serialized values, so they are a
 * closed wire contract. Renaming a member breaks active clients but does not change stored data.
 * A frame selects a transport handler; it never grants conversation access by itself.
 */
export enum ConversationSocketFrameKinds
{
	/** Carries a direct or group participant message to the ordinary message authority. */
	MessageSubmit = "conversation.message.submit",
	/** Acknowledges an ordinary message append or idempotent retry. */
	MessageAccepted = "conversation.message.accepted",
	/** Refuses an ordinary message before it can enter a conversation. */
	MessageRejected = "conversation.message.rejected",
	/** Carries one AgentSession text body to immutable ConversationComputer history. */
	ComputerInputSubmit = "conversation.computer.input.submit",
	/** Acknowledges an immutable AgentSession input append or idempotent retry. */
	ComputerInputAccepted = "conversation.computer.input.accepted",
	/** Refuses an AgentSession input before it can enter immutable history. */
	ComputerInputRejected = "conversation.computer.input.rejected",
}

/**
 * Why a conversation command was denied.
 *
 * Every value means the same thing to the caller: do not write. They differ so an audit, and an
 * HTTP layer choosing a status code, can tell a stored-data problem from a lifecycle or mode
 * refusal. None of them means "retry and it may work".
 */
export enum ConversationCommandDenialReasons
{
	/** The stored mode and agent binding disagree — an agent-session conversation with no agent, or a direct or group conversation with one. The stored row is wrong, so no retry helps. */
	InvalidAgentBinding = "invalid_agent_binding",
	/** Conversation lifecycle is closed and therefore denies every write. */
	ConversationClosed = "conversation_closed",
	/** Selected mode deliberately does not support this command. */
	CommandNotSupportedByMode = "command_not_supported_by_mode",
	/** Agent-session continuation has no active foreground run to target. */
	NoActiveRun = "no_active_run",
	/** The command's `targetRunId` is not the conversation's active run, so the caller is steering a run that has already moved on. */
	ActiveRunMismatch = "active_run_mismatch",
	/** The command, mode, or lifecycle is not a value this model knows — usually stored data from a newer or older version. */
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
	/** Run id that must equal the conversation's active run, or the command is denied. */
	readonly targetRunId: string;
}

/** Command that answers elicitation for one exact active agent-session run. */
export interface AnswerElicitationConversationCommand
{
	/** Discriminant selecting active-run elicitation response. */
	readonly kind: ConversationCommandKinds.AnswerElicitation;
	/** Run id that must equal the conversation's active run, or the command is denied. */
	readonly targetRunId: string;
}

/** Exhaustive commands owned by the immutable conversation-mode strategies. */
export type ConversationCommand = SubmitMessageConversationCommand | CloseConversationCommand | SteerRunConversationCommand | AnswerElicitationConversationCommand;

/** What {@link __DecideConversationCommand} needs: the conversation's stored mode, lifecycle, agent binding, and active run, plus the command being attempted. Read all four from storage — never from the request. */
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

/** A denial. Perform no write; the `reason` is safe to log and to map to an HTTP status. */
export interface DeniedConversationCommandDecision
{
	/** Negative result discriminant. */
	readonly allowed: false;
	/** Stable reason explaining the failed invariant or unsupported command. */
	readonly reason: ConversationCommandDenialReasons;
}

/** Pure exhaustive decision returned for every conversation state and command. */
export type ConversationCommandDecision = AllowedConversationCommandDecision | DeniedConversationCommandDecision;
