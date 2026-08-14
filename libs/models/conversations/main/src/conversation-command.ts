import { ConversationCommandActions, ConversationCommandDenialReasons, ConversationCommandKinds, type ConversationCommand, type ConversationCommandContext, type ConversationCommandDecision } from "./conversation-command.types";
import { ConversationLifecycles, ConversationModes } from "./conversation.types";
import { __HasValidConversationAgentBinding } from "./conversation-invariants";

/** Decides one command for one combination of lifecycle and mode — a single cell in the tables below. */
type _CommandHandler = (context: ConversationCommandContext) => ConversationCommandDecision;

/** Mode strategy table requiring one decision for every supported command. */
type _ModeCommandStrategy = Readonly<Record<ConversationCommandKinds, _CommandHandler>>;

/** Builds one allowed routing decision. */
function _allow(action: ConversationCommandActions): ConversationCommandDecision
{
	return { allowed: true, action };
}

/** Builds one denied fail-closed decision. */
function _deny(reason: ConversationCommandDenialReasons): ConversationCommandDecision
{
	return { allowed: false, reason };
}

/** Routes agent-session input through run admission. */
function _admitAgentRun(): ConversationCommandDecision
{
	return _allow(ConversationCommandActions.AdmitAgentRun);
}

/** Routes direct or group input through ordinary message admission. */
function _admitOrdinaryMessage(): ConversationCommandDecision
{
	return _allow(ConversationCommandActions.AdmitOrdinaryMessage);
}

/** Allows the close command; the lifecycle owner performs the one-way open-to-closed change. */
function _closeConversation(): ConversationCommandDecision
{
	return _allow(ConversationCommandActions.CloseConversation);
}

/** Denies a command that the selected immutable mode deliberately does not own. */
function _denyUnsupportedModeCommand(): ConversationCommandDecision
{
	return _deny(ConversationCommandDenialReasons.CommandNotSupportedByMode);
}

/** Denies every write once the monotonic lifecycle reaches closed. */
function _denyClosed(): ConversationCommandDecision
{
	return _deny(ConversationCommandDenialReasons.ConversationClosed);
}

/** Allows steering or an elicitation answer only when the command's `targetRunId` equals the conversation's active run; denies when there is no active run, or when the ids differ. */
function _targetActiveRun(context: ConversationCommandContext): ConversationCommandDecision
{
	if (context.activeRunId === null)
	{
		return _deny(ConversationCommandDenialReasons.NoActiveRun);
	}

	if (!("targetRunId" in context.command) || context.command.targetRunId !== context.activeRunId)
	{
		return _deny(ConversationCommandDenialReasons.ActiveRunMismatch);
	}

	return _allow(ConversationCommandActions.TargetActiveRun);
}

/** Exhaustive agent-session strategy: all input remains under run authority. */
const _AGENT_SESSION_STRATEGY: _ModeCommandStrategy = {
	[ConversationCommandKinds.SubmitMessage]: _admitAgentRun,
	[ConversationCommandKinds.SteerRun]: _targetActiveRun,
	[ConversationCommandKinds.AnswerElicitation]: _targetActiveRun,
	[ConversationCommandKinds.Close]: _closeConversation,
};

/** Direct mode: a message is stored as an ordinary message and never starts a run. */
const _DIRECT_STRATEGY: _ModeCommandStrategy = {
	[ConversationCommandKinds.SubmitMessage]: _admitOrdinaryMessage,
	[ConversationCommandKinds.SteerRun]: _denyUnsupportedModeCommand,
	[ConversationCommandKinds.AnswerElicitation]: _denyUnsupportedModeCommand,
	[ConversationCommandKinds.Close]: _closeConversation,
};

/** Group mode: same as direct — a message is stored as an ordinary message and never starts a run. */
const _GROUP_STRATEGY: _ModeCommandStrategy = {
	[ConversationCommandKinds.SubmitMessage]: _admitOrdinaryMessage,
	[ConversationCommandKinds.SteerRun]: _denyUnsupportedModeCommand,
	[ConversationCommandKinds.AnswerElicitation]: _denyUnsupportedModeCommand,
	[ConversationCommandKinds.Close]: _closeConversation,
};

/** Exhaustive immutable-mode strategy registry. */
const _MODE_STRATEGIES: Readonly<Record<ConversationModes, _ModeCommandStrategy>> = {
	[ConversationModes.AgentSession]: _AGENT_SESSION_STRATEGY,
	[ConversationModes.Direct]: _DIRECT_STRATEGY,
	[ConversationModes.Group]: _GROUP_STRATEGY,
};

/** For an open conversation, hands the command to the table for its mode; an unknown mode or command denies. */
function _decideOpen(context: ConversationCommandContext): ConversationCommandDecision
{
	const strategy = _MODE_STRATEGIES[context.mode] as _ModeCommandStrategy | undefined;
	const handler = strategy?.[context.command.kind] as _CommandHandler | undefined;
	return handler ? handler(context) : _deny(ConversationCommandDenialReasons.UnsupportedCommand);
}

/** Decision table by lifecycle then command. Every cell for a closed conversation denies, so closing is a complete stop rather than a filter. */
const _STATE_COMMAND_STRATEGIES: Readonly<Record<ConversationLifecycles, Readonly<Record<ConversationCommandKinds, _CommandHandler>>>> = {
	[ConversationLifecycles.Open]: {
		[ConversationCommandKinds.SubmitMessage]: _decideOpen,
		[ConversationCommandKinds.SteerRun]: _decideOpen,
		[ConversationCommandKinds.AnswerElicitation]: _decideOpen,
		[ConversationCommandKinds.Close]: _decideOpen,
	},
	[ConversationLifecycles.Closed]: {
		[ConversationCommandKinds.SubmitMessage]: _denyClosed,
		[ConversationCommandKinds.SteerRun]: _denyClosed,
		[ConversationCommandKinds.AnswerElicitation]: _denyClosed,
		[ConversationCommandKinds.Close]: _denyClosed,
	},
};

/**
 * Decide what one conversation command is allowed to do, before anything is written.
 *
 * Pure function: it reads the stored mode, lifecycle, agent binding, and active run, and returns
 * either the single action a caller may then perform or a stable denial reason. It performs no
 * persistence itself.
 *
 * Fails closed. A conversation whose mode and agent binding disagree, a closed conversation, a
 * command the mode does not support, an unknown mode, and an unknown command all deny. The caller
 * must branch on `allowed` and must never fall through to a default action.
 *
 * Called by: `libs/backend/server/conversations/main/src/db/prisma-conversation-mutation-repository.ts`,
 * `libs/backend/server/conversations/main/src/db/prisma-conversation-unit-of-work.ts`.
 * @param context - The stored mode, lifecycle, agent binding, active run, and the requested command.
 * @returns An allowed decision naming exactly one action to perform, or a denial with a stable reason safe to log and to map to an HTTP status.
 * @see {@link ConversationCommandActions}
 * @see {@link ConversationCommandDenialReasons}
 */
export function __DecideConversationCommand(context: ConversationCommandContext): ConversationCommandDecision
{
	if (!__HasValidConversationAgentBinding(context.mode, context.agentServiceId))
	{
		return _deny(ConversationCommandDenialReasons.InvalidAgentBinding);
	}

	const stateStrategy = _STATE_COMMAND_STRATEGIES[context.lifecycle] as Readonly<Record<ConversationCommandKinds, _CommandHandler>> | undefined;
	const handler = stateStrategy?.[context.command.kind] as _CommandHandler | undefined;
	return handler ? handler(context) : _deny(ConversationCommandDenialReasons.UnsupportedCommand);
}
