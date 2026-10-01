import { createHash } from "node:crypto";

import { WorkflowTaskTerminalError, ___RetryWorkflowDependency, type IWorkflowEngine, type IWorkflowTaskContext } from "@opencrane/backend/server/infra/workflows/contract";
import { ___GeneratedFileEventName } from "@opencrane/contracts";
import { ___IsSha256ContentAddress } from "@opencrane/models/artifacts";

import { CONVERSATION_GENERATED_FILE_TASK } from "../persistence/conversation-generated-file-task";
import type { ConversationGeneratedFileTaskInput } from "../persistence/generated-file-capture.types";
import { ConversationGeneratedFileWorkflowOutcomes, GeneratedFileQuarantineOutcomes, GeneratedFileWorkflowStates, type ConversationGeneratedFileWorkflowDependencies, type ConversationGeneratedFileWorkflowResult, type GeneratedFilePromotionReceipt, type GeneratedFileWorkflowSnapshot, type PromoteGeneratedFileCommand } from "./generated-file-workflow.types";

/** Task-local checkpoint name; the admitted task key already binds it to one immutable operation. */
const _PROMOTION_CHECKPOINT = "promote-generated-file";
/** Exact digest syntax required for the promotion receipt itself. */
const _SHA256 = /^sha256:[0-9a-f]{64}$/u;

/** Register the server task that promotes captured bytes and waits for the existing Artifact scanner. */
export function _RegisterConversationGeneratedFileWorkflow(workflows: IWorkflowEngine, dependencies: ConversationGeneratedFileWorkflowDependencies): void
{
	workflows.register({ ...CONVERSATION_GENERATED_FILE_TASK, run: async function _Run(context, input: ConversationGeneratedFileTaskInput): Promise<ConversationGeneratedFileWorkflowResult>
	{
		_AssertTask(input, context);
		while (true)
		{
			const snapshot = await ___RetryWorkflowDependency(function _Load()
			{
				return dependencies.persistence.loadCurrent(input, context.task, new Date());
			}, "Generated file state is temporarily unavailable");
			if (snapshot === null)
				return _Result(input.operationId, ConversationGeneratedFileWorkflowOutcomes.AuthorityEnded);
			_AssertSnapshot(input, snapshot);

			switch (snapshot.state)
			{
				case GeneratedFileWorkflowStates.Ready:
					return _Result(snapshot.operationId, ConversationGeneratedFileWorkflowOutcomes.Ready);
				case GeneratedFileWorkflowStates.Failed:
					return _Result(snapshot.operationId, ConversationGeneratedFileWorkflowOutcomes.Failed);
				case GeneratedFileWorkflowStates.ScanPending:
					await context.waitForEvent(___GeneratedFileEventName(snapshot.operationId), { timeoutAt: new Date(snapshot.notAfterEpochMs) });
					break;
				case GeneratedFileWorkflowStates.PromotionRequired:
				{
					const outcome = await _Promote(context, snapshot, dependencies);
					if (outcome !== null)
						return _Result(snapshot.operationId, outcome);
					break;
				}
				default:
					throw new WorkflowTaskTerminalError("Generated file workflow state is invalid");
			}
		}
	} });
}

/** Verify custody, checkpoint one promotion receipt, and admit that exact receipt to quarantine. */
async function _Promote(context: IWorkflowTaskContext, snapshot: GeneratedFileWorkflowSnapshot, dependencies: ConversationGeneratedFileWorkflowDependencies): Promise<ConversationGeneratedFileWorkflowOutcomes | null>
{
	const content = await ___RetryWorkflowDependency(function _OpenBytes()
	{
		return dependencies.persistence.openVerifiedBytes(snapshot, context.task, new Date());
	}, "Generated file custody is temporarily unavailable");
	if (content === null)
		return ConversationGeneratedFileWorkflowOutcomes.AuthorityEnded;
	_AssertContent(snapshot, content);

	const command: PromoteGeneratedFileCommand = { siloId: snapshot.siloId, operationId: snapshot.operationId, artifactId: snapshot.artifactId, artifactRevisionId: snapshot.artifactRevisionId, uploadLeaseId: snapshot.uploadLeaseId, contentAddress: snapshot.contentAddress, byteLength: snapshot.byteLength, mediaType: snapshot.mediaType, notAfterEpochMs: snapshot.notAfterEpochMs, content };
	const receipt = await context.checkpoint({ stepName: _PROMOTION_CHECKPOINT }, function _PromoteOnce()
	{
		return ___RetryWorkflowDependency(function _CallPromotion()
		{
			return dependencies.promotion.promote(command);
		}, "Generated file promotion is temporarily unavailable");
	});
	_AssertReceipt(snapshot, receipt);

	const outcome = await ___RetryWorkflowDependency(function _Finalize()
	{
		return dependencies.persistence.finalizeQuarantine(snapshot, context.task, receipt, new Date());
	}, "Generated file quarantine admission is temporarily unavailable");
	if (outcome === GeneratedFileQuarantineOutcomes.AuthorityEnded)
		return ConversationGeneratedFileWorkflowOutcomes.AuthorityEnded;
	if (outcome !== GeneratedFileQuarantineOutcomes.Advanced && outcome !== GeneratedFileQuarantineOutcomes.Idempotent)
		throw new WorkflowTaskTerminalError("Generated file quarantine returned an invalid outcome");
	return null;
}

/** Reject a handler invocation whose receipt cannot belong to the captured operation. */
function _AssertTask(input: ConversationGeneratedFileTaskInput, context: IWorkflowTaskContext): void
{
	if (!_Coordinate(input.siloId) || !_OperationId(input.operationId) || context.task.taskName !== CONVERSATION_GENERATED_FILE_TASK.taskName
		|| !_Coordinate(context.task.taskId) || !_Coordinate(context.task.idempotencyKey))
		throw new WorkflowTaskTerminalError("Generated file task input does not match its admitted receipt");
}

/** Match the operation identifier accepted by the shared task-scoped scan event vocabulary. */
function _OperationId(value: unknown): value is string
{
	return typeof value === "string" && /^[A-Za-z0-9:_-]{1,128}$/u.test(value);
}

/** Reject a malformed or substituted state before it can select a workflow effect. */
function _AssertSnapshot(input: ConversationGeneratedFileTaskInput, snapshot: GeneratedFileWorkflowSnapshot): void
{
	// A saved outcome survives its execution deadline; replaying it starts no new work.
	const isTerminal = snapshot.state === GeneratedFileWorkflowStates.Ready || snapshot.state === GeneratedFileWorkflowStates.Failed;
	if (snapshot.siloId !== input.siloId || snapshot.operationId !== input.operationId
		|| ![snapshot.artifactId, snapshot.artifactRevisionId, snapshot.uploadLeaseId, snapshot.mediaType].every(_Coordinate)
		|| !___IsSha256ContentAddress(snapshot.contentAddress) || !Number.isSafeInteger(snapshot.byteLength) || snapshot.byteLength < 1 || snapshot.byteLength > 1_048_576
		|| !Number.isSafeInteger(snapshot.notAfterEpochMs) || snapshot.notAfterEpochMs <= 0
		|| (!isTerminal && snapshot.notAfterEpochMs <= Date.now()))
		throw new WorkflowTaskTerminalError("Generated file workflow state is invalid");
}

/** Compare reconstructed plaintext with the immutable saved content identity. */
function _AssertContent(snapshot: GeneratedFileWorkflowSnapshot, content: Uint8Array): void
{
	const contentAddress = content instanceof Uint8Array ? `sha256:${createHash("sha256").update(content).digest("hex")}` : null;
	if (contentAddress === null || content.byteLength !== snapshot.byteLength || contentAddress !== snapshot.contentAddress)
		throw new WorkflowTaskTerminalError("Generated file custody did not return the admitted bytes");
}

/** Require the checkpointed receipt to describe only this operation's fixed lease and bytes. */
function _AssertReceipt(snapshot: GeneratedFileWorkflowSnapshot, receipt: GeneratedFilePromotionReceipt): void
{
	if (receipt.leaseId !== snapshot.uploadLeaseId || receipt.contentAddress !== snapshot.contentAddress || receipt.byteLength !== snapshot.byteLength
		|| receipt.mediaType !== snapshot.mediaType || !_SHA256.test(receipt.receiptDigest))
		throw new WorkflowTaskTerminalError("Generated file promotion receipt conflicts with the captured operation");
}

/** Build a metadata-only terminal result. */
function _Result(operationId: string, outcome: ConversationGeneratedFileWorkflowOutcomes): ConversationGeneratedFileWorkflowResult
{
	return { operationId, outcome };
}

/** Check one bounded workflow coordinate without accepting controls or normalization. */
function _Coordinate(value: unknown): value is string
{
	return typeof value === "string" && value.length > 0 && value.length <= 512 && value === value.trim() && !/[\p{Cc}]/u.test(value);
}
