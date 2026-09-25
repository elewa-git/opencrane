import { WorkflowTaskRetryableError, type IWorkflowEngine, type IWorkflowTaskContext } from "@opencrane/backend/server/infra/workflows/contract";
import { ___GeneratedFileEventName } from "@opencrane/contracts";

import { ConversationComputerToolResultOutcomes } from "../conversation-computer-continuation.types";
import { ConversationComputerModelProgressOutcomes } from "../conversation-computer-model.types";
import { CONVERSATION_COMPUTER_TURN_MAXIMUM_ATTEMPTS, CONVERSATION_COMPUTER_TURN_TASK } from "./conversation-computer-turn-task";
import type { ConversationComputerTurnTaskInput, ConversationComputerTurnWorkflowDependencies, ConversationComputerTurnWorkflowResult } from "./conversation-computer-turn-workflow.types";

const _TURN_RETRY_MILLISECONDS = 1_000;

/** Register the finite server workflow that owns conversation-turn progression. */
export function _RegisterConversationComputerTurnWorkflow(workflows: IWorkflowEngine, dependencies: ConversationComputerTurnWorkflowDependencies): void
{
	workflows.register({ ...CONVERSATION_COMPUTER_TURN_TASK, run: async function _Run(context, input: ConversationComputerTurnTaskInput): Promise<ConversationComputerTurnWorkflowResult>
	{
		_AssertInput(input, dependencies.siloId, context);
		let admissionCycle = 0;
		while (true)
		{
			let turn;
			try
			{
				turn = await dependencies.authority.start({ computerId: input.computerId, lease: { leaseId: input.leaseId, leaseGeneration: input.leaseGeneration }, causationId: input.causationId, causationPosition: input.causationPosition });
			}
			catch
			{
				throw new WorkflowTaskRetryableError("Conversation turn admission is temporarily unavailable");
			}
			if (turn === null)
				return { outcome: "idle" };
			if (BigInt(turn.latestPendingEntryPosition) < BigInt(input.causationPosition))
			{
				admissionCycle += 1;
				await context.sleepUntil(new Date(Date.now() + _TURN_RETRY_MILLISECONDS), `predecessor-${admissionCycle}`);
				continue;
			}
			if (BigInt(turn.latestPendingEntryPosition) > BigInt(input.causationPosition))
				return { outcome: "superseded", turnId: turn.bootstrapId };
			if (turn.latestPendingEntryId !== input.causationId)
				throw new Error("Conversation turn workflow causation does not match its history position");
			if (!await dependencies.receipts.bind(turn.compile.runId, turn.compile.attempt, context.task))
				return { outcome: "superseded", turnId: turn.bootstrapId };

			let recoveryCycle = 0;
			while (true)
			{
				const progress = await dependencies.authority.advance(turn.bootstrapId);
				switch (progress.outcome)
				{
					case ConversationComputerModelProgressOutcomes.Completed:
					case ConversationComputerModelProgressOutcomes.ResponseUnavailable:
					case ConversationComputerModelProgressOutcomes.AuthorityEnded:
						return { outcome: progress.outcome, turnId: turn.bootstrapId };
					case ConversationComputerModelProgressOutcomes.ModelPending:
						await context.sleepUntil(new Date(progress.notBeforeEpochMs), `model-${progress.ordinal}-deadline`);
						break;
					case ConversationComputerModelProgressOutcomes.ModelRetryWaiting:
						await context.sleepUntil(new Date(progress.notBeforeEpochMs), `model-${progress.ordinal}-retry-${progress.retryOrdinal}`);
						break;
					case ConversationComputerToolResultOutcomes.GeneratedFilePending:
						if (!Number.isSafeInteger(progress.notAfterEpochMs) || progress.notAfterEpochMs <= 0)
							throw new Error("Generated file wait requires the original authority deadline");
						await context.waitForEvent(___GeneratedFileEventName(progress.operationId), { timeoutAt: new Date(progress.notAfterEpochMs) });
						break;
					case ConversationComputerModelProgressOutcomes.ToolPending:
					{
						if (progress.waitFor === "approval")
						{
							await context.checkpoint({ stepName: `publish-tool-approval-requested:${progress.toolInvocationId}` }, function _PublishRequested()
							{
								return dependencies.approvalNotifications.publishRequested({ bootstrapId: turn.bootstrapId, siloId: turn.siloId, conversationId: turn.binding.conversationId, runId: turn.compile.runId, attempt: turn.compile.attempt, approvalId: progress.toolInvocationId });
							});
						}
						else
						{
							const command = { siloId: turn.siloId, runId: turn.compile.runId, attempt: turn.compile.attempt, toolInvocationId: progress.toolInvocationId };
							let progressed;
							try
							{
								progressed = await context.checkpoint({ stepName: `dispatch-mcp-invocation:${progress.toolInvocationId}` }, function _Dispatch()
								{
									// The database claim prevents duplicate effects; this checkpoint records workflow progress only.
									return dependencies.toolDispatch.tryExecute(command);
								});
							}
							catch (error)
							{
								if (!(error instanceof WorkflowTaskRetryableError) || context.attempt < CONVERSATION_COMPUTER_TURN_MAXIMUM_ATTEMPTS)
									throw error;
								if (!await dependencies.toolDispatch.settleExhausted(command))
									throw error;
								break;
							}
							if (progressed)
								break;
						}
						const approvalWait = progress.waitFor === "approval" && progress.waitUntilEpochMs !== undefined ? { timeoutAt: new Date(progress.waitUntilEpochMs) } : undefined;
						const eventName = progress.waitFor === "approval" ? _ToolApprovalEventName(progress.toolInvocationId) : _ToolResultEventName(progress.toolInvocationId);
						if (approvalWait === undefined)
							await context.waitForEvent(eventName);
						else
							await context.waitForEvent(eventName, approvalWait);
						break;
					}
					case ConversationComputerModelProgressOutcomes.Retry:
						recoveryCycle += 1;
						await context.sleepUntil(new Date(Date.now() + _TURN_RETRY_MILLISECONDS), `recovery-${recoveryCycle}`);
				}
			}
		}
	} });
}

/** Name the private task event from the immutable invocation chosen by the model. */
export function _ToolResultEventName(toolInvocationId: string): string
{
	if (toolInvocationId.trim().length === 0)
		throw new Error("Conversation turn tool event requires an invocation id");
	return `tool-result:${toolInvocationId}`;
}

/** Names the separate wake emitted when an owner changes a deferred invocation's readiness. */
export function _ToolApprovalEventName(toolInvocationId: string): string
{
	if (toolInvocationId.trim().length === 0)
		throw new Error("Conversation turn approval event requires an invocation id");
	return `tool-approval:${toolInvocationId}`;
}

/** Reject a task that crossed its declared receipt, silo or immutable activation coordinates. */
function _AssertInput(input: ConversationComputerTurnTaskInput, siloId: string, context: IWorkflowTaskContext): void
{
	if (input.siloId !== siloId || context.task.taskName !== CONVERSATION_COMPUTER_TURN_TASK.taskName || context.task.idempotencyKey !== input.activationEventId
		|| !Number.isSafeInteger(input.leaseGeneration) || input.leaseGeneration < 1
		|| !/^(0|[1-9][0-9]*)$/u.test(input.causationPosition)
		|| [input.computerId, input.leaseId, input.activationEventId, input.causationId].some(value => value.trim().length === 0))
		throw new Error("Conversation turn workflow input does not match its admitted activation");
}
