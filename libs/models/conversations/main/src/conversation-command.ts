import { ConversationCommandActions, ConversationCommandDenialReasons, ConversationCommandKinds, type ConversationCommand, type ConversationCommandContext, type ConversationCommandDecision } from "./conversation-command.types.js";
import { ConversationLifecycles, ConversationModes } from "./conversation.types.js";
import { __HasValidConversationAgentBinding } from "./conversation-invariants.js";

/** Pure handler for one state or mode strategy cell. */
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

/** Routes close through the monotonic lifecycle owner. */
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

/** Requires a steering or elicitation command to name the exact active agent-session run. */
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

/** Exhaustive direct strategy: ordinary messages cannot manufacture runs. */
const _DIRECT_STRATEGY: _ModeCommandStrategy = {
	[ConversationCommandKinds.SubmitMessage]: _admitOrdinaryMessage,
	[ConversationCommandKinds.SteerRun]: _denyUnsupportedModeCommand,
	[ConversationCommandKinds.AnswerElicitation]: _denyUnsupportedModeCommand,
	[ConversationCommandKinds.Close]: _closeConversation,
};

/** Exhaustive group strategy: ordinary messages cannot manufacture runs. */
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

/** Exhaustive open-state dispatch through the immutable mode strategy. */
function _decideOpen(context: ConversationCommandContext): ConversationCommandDecision
{
	const strategy = _MODE_STRATEGIES[context.mode] as _ModeCommandStrategy | undefined;
	const handler = strategy?.[context.command.kind] as _CommandHandler | undefined;
	return handler ? handler(context) : _deny(ConversationCommandDenialReasons.UnsupportedCommand);
}

/** Exhaustive state-by-command table; closed deliberately denies every write cell. */
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
 * Decides one conversation write from durable mode, lifecycle, binding, and active-run facts.
 * Unsupported runtime values and invalid agent bindings deny without selecting an authority.
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
