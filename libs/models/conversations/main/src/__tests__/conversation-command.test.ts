import { describe, expect, it } from "vitest";

import { __DecideConversationCommand, ConversationCommandActions, ConversationCommandDenialReasons, ConversationCommandKinds, ConversationLifecycles, ConversationModes } from "../index";
import type { ConversationCommand, ConversationCommandContext, ConversationCommandDecision } from "../index";

/** Active run used by exact-target steering and elicitation fixtures. */
const _ACTIVE_RUN_ID = "run-active";

/** Creates a command with an exact active-run target where the command requires one. */
function _command(kind: ConversationCommandKinds): ConversationCommand
{
	if (kind === ConversationCommandKinds.SteerRun)
	{
		return { kind, targetRunId: _ACTIVE_RUN_ID };
	}

	if (kind === ConversationCommandKinds.AnswerElicitation)
	{
		return { kind, targetRunId: _ACTIVE_RUN_ID };
	}

	return { kind };
}

/** Supplies the exact agent binding required by one immutable mode. */
function _agentServiceId(mode: ConversationModes): string | null
{
	return mode === ConversationModes.AgentSession ? "agent-service-1" : null;
}

/** Builds one durable command-decision fixture. */
function _context(mode: ConversationModes, lifecycle: ConversationLifecycles, kind: ConversationCommandKinds): ConversationCommandContext
{
	return { mode, lifecycle, agentServiceId: _agentServiceId(mode), activeRunId: _ACTIVE_RUN_ID, command: _command(kind) };
}

/** Expected open-state strategy action for one Mode x Command cell. */
function _expectedOpenDecision(mode: ConversationModes, kind: ConversationCommandKinds): ConversationCommandDecision
{
	if (kind === ConversationCommandKinds.Close)
	{
		return { allowed: true, action: ConversationCommandActions.CloseConversation };
	}

	if (kind === ConversationCommandKinds.SubmitMessage)
	{
		if (mode === ConversationModes.AgentSession)
			return { allowed: false, reason: ConversationCommandDenialReasons.CommandNotSupportedByMode };
		return { allowed: true, action: ConversationCommandActions.AdmitOrdinaryMessage };
	}

	if (mode === ConversationModes.AgentSession)
	{
		return { allowed: true, action: ConversationCommandActions.TargetActiveRun };
	}

	return { allowed: false, reason: ConversationCommandDenialReasons.CommandNotSupportedByMode };
}

describe("conversation State x Command strategies", function _ConversationStateCommandSuite()
{
	it("covers every lifecycle, mode, and command cell", function _CoversEveryCell()
	{
		for (const lifecycle of Object.values(ConversationLifecycles))
		{
			for (const mode of Object.values(ConversationModes))
			{
				for (const kind of Object.values(ConversationCommandKinds))
				{
					const expected = lifecycle === ConversationLifecycles.Closed
						? { allowed: false, reason: ConversationCommandDenialReasons.ConversationClosed }
						: _expectedOpenDecision(mode, kind);

					expect(__DecideConversationCommand(_context(mode, lifecycle, kind))).toEqual(expected);
				}
			}
		}
	});

	it("requires steering and elicitation to target the exact active agent-session run", function _RequiresActiveRun()
	{
		for (const kind of [ConversationCommandKinds.SteerRun, ConversationCommandKinds.AnswerElicitation])
		{
			const context = _context(ConversationModes.AgentSession, ConversationLifecycles.Open, kind);
			expect(__DecideConversationCommand({ ...context, activeRunId: null })).toEqual({ allowed: false, reason: ConversationCommandDenialReasons.NoActiveRun });
			expect(__DecideConversationCommand({ ...context, command: { kind, targetRunId: "run-stale" } })).toEqual({ allowed: false, reason: ConversationCommandDenialReasons.ActiveRunMismatch });
		}
	});

	it("distinguishes invalid agent binding from a closed lifecycle", function _DistinguishesBinding()
	{
		const missingAgent = { ..._context(ConversationModes.AgentSession, ConversationLifecycles.Open, ConversationCommandKinds.SubmitMessage), agentServiceId: null };
		const forbiddenAgent = { ..._context(ConversationModes.Direct, ConversationLifecycles.Open, ConversationCommandKinds.SubmitMessage), agentServiceId: "agent-service-1" };

		expect(__DecideConversationCommand(missingAgent)).toEqual({ allowed: false, reason: ConversationCommandDenialReasons.InvalidAgentBinding });
		expect(__DecideConversationCommand(forbiddenAgent)).toEqual({ allowed: false, reason: ConversationCommandDenialReasons.InvalidAgentBinding });
	});

	it("fails closed for runtime commands outside the exhaustive vocabulary", function _RejectsUnknownCommand()
	{
		const invalidContext = { ..._context(ConversationModes.Direct, ConversationLifecycles.Open, ConversationCommandKinds.SubmitMessage), command: { kind: "delete_history" } } as unknown as ConversationCommandContext;

		expect(__DecideConversationCommand(invalidContext)).toEqual({ allowed: false, reason: ConversationCommandDenialReasons.UnsupportedCommand });
	});
});
