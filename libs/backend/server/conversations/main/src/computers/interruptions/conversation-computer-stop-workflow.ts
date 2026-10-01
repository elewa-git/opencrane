import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";
import { WorkflowTaskRetryableError, type IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";

import type { ConversationComputerCredentialIssuer } from "../turns/conversation-computer-turn.types";
import { CONVERSATION_COMPUTER_STOP_TASK } from "./conversation-computer-stop-task";
import { ConversationComputerStopAdmissionKinds, ConversationComputerStopDecisions, ConversationComputerStopTaskOutcomes, type ConversationComputerStopAdmissionAuthority, type ConversationComputerStopLifecycle, type ConversationComputerStopPublisher, type ConversationComputerStopTaskInput, type ConversationComputerStopTaskResult } from "./conversation-computer-stop.types";

/** Registers the single durable owner of Stop arbitration and cleanup. */
export function _RegisterConversationComputerStopWorkflow(workflows: IWorkflowEngine, dependencies: { readonly admissions: ConversationComputerStopAdmissionAuthority; readonly publisher: ConversationComputerStopPublisher; readonly lifecycle: ConversationComputerStopLifecycle; readonly credentials: Pick<ConversationComputerCredentialIssuer, "revoke"> }): void
{
	workflows.register({ ...CONVERSATION_COMPUTER_STOP_TASK, run: async function _Run(context, input: ConversationComputerStopTaskInput): Promise<ConversationComputerStopTaskResult>
	{
		_AssertTask(input, context.task);
		const admission = await dependencies.admissions.read(input.command);
		if (admission === null || admission.kind !== ConversationComputerStopAdmissionKinds.Target)
			throw new Error("conversation Stop task requires its saved target admission");
		_AssertAdmission(input, admission, context.task);
		const outcome = await dependencies.publisher.publish(admission);
		if (outcome.decision === ConversationComputerStopDecisions.Stale)
			throw new WorkflowTaskRetryableError("conversation Stop target arbitration must be retried");
		await context.checkpoint({ stepName: "record-terminal-decision" }, function _RecordDecision()
		{
			return dependencies.lifecycle.recordDecision(admission, outcome);
		});
		if (outcome.decision === ConversationComputerStopDecisions.OutputWon)
			return { outcome: ConversationComputerStopTaskOutcomes.OutputCompleted, commandId: input.command.commandId };
		if (outcome.decision !== ConversationComputerStopDecisions.CancellationWon)
			throw new Error("conversation Stop task recovered an invalid target decision");
		await context.checkpoint({ stepName: "cancel-original-turn-task" }, function _CancelOriginalTask()
		{
			return workflows.cancel(admission.originalTurnTask);
		});
		await context.checkpoint({ stepName: "revoke-model-credential" }, function _RevokeCredential()
		{
			return dependencies.credentials.revoke(admission.target.bootstrapId);
		});
		for (let cycle = 0; ; cycle += 1)
		{
			const cleanup = await context.checkpoint({ stepName: `cleanup-${cycle}` }, function _Cleanup()
			{
				return dependencies.lifecycle.cleanup(admission);
			});
			if (cleanup.activeClaimCount === 0)
				break;
			if (cleanup.nextClaimExpiryAt === null)
				throw new WorkflowTaskRetryableError("conversation Stop is waiting for a bounded provider claim");
			await context.sleepUntil(new Date(cleanup.nextClaimExpiryAt), `provider-claim-${cycle}`);
		}
		const finalized = await context.checkpoint({ stepName: "finalize-cancelled-run" }, function _Finalize()
		{
			return dependencies.lifecycle.finalize(admission);
		});
		if (!finalized)
			throw new WorkflowTaskRetryableError("conversation Stop cleanup has not converged");
		return { outcome: ConversationComputerStopTaskOutcomes.Cancelled, commandId: input.command.commandId };
	} });
}

/** Rejects a task replay whose receipt or canonical input differs from SQL admission. */
function _AssertTask(input: ConversationComputerStopTaskInput, task: { readonly taskId: string; readonly taskName: string; readonly idempotencyKey: string }): void
{
	if (task.taskName !== CONVERSATION_COMPUTER_STOP_TASK.taskName || task.idempotencyKey !== input.command.commandId || [task.taskId, input.commandDigest].some(value => value.trim().length === 0))
		throw new Error("conversation Stop task differs from its workflow receipt");
}

/** Compares every effect-bearing task coordinate with the saved SQL admission. */
function _AssertAdmission(input: ConversationComputerStopTaskInput, admission: Extract<Awaited<ReturnType<ConversationComputerStopAdmissionAuthority["read"]>>, { kind: ConversationComputerStopAdmissionKinds.Target }>, task: { readonly taskId: string; readonly taskName: string; readonly idempotencyKey: string }): void
{
	const savedInput = { command: admission.command, target: admission.target, commandDigest: admission.commandDigest, originalTurnTask: admission.originalTurnTask };
	if (admission.cancellationTask.taskId !== task.taskId || admission.cancellationTask.taskName !== task.taskName || admission.cancellationTask.idempotencyKey !== task.idempotencyKey || ___DigestCanonicalJson(savedInput as unknown as JsonValue) !== ___DigestCanonicalJson(input as unknown as JsonValue))
		throw new Error("conversation Stop task input differs from its saved admission");
}
