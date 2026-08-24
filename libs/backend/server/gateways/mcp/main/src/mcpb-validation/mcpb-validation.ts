import { createHash } from "node:crypto";

import { WorkflowTaskRetryableError, WorkflowTaskRetryBackoffKinds, WorkflowTaskTerminalError } from "@opencrane/backend/server/infra/workflows/contract";
import type { IWorkflowTaskContext, IWorkflowTransaction } from "@opencrane/backend/server/infra/workflows/contract";

import type { McpbValidationRecord } from "./mcpb-validation-repository.types";
import { McpbValidationActions, McpbValidationEvents, __McpbValidationReplayResult, __McpbValidationTransition } from "./mcpb-validation-state";
import { McpbValidationStates, McpbValidationTaskNames } from "./mcpb-validation.types";
import type { McpbBundleArtifactTarget, McpbValidationAdmission, McpbValidationTaskInput, McpbValidationWorkflow, McpbValidationWorkflowOptions, McpbVerificationResult } from "./mcpb-validation.types";
import { __AssertMcpbValidationTaskInput } from "./mcpb-validation.validator";

/** Stop retrying temporary verifier or database failures after five handler attempts. */
const _MAXIMUM_ATTEMPTS = 5;

/** Keep temporary database failures retryable without changing deliberate workflow outcomes. */
async function _RetryablePersistence<TResult>(operation: () => Promise<TResult>): Promise<TResult>
{
	try
	{
		return await operation();
	}
	catch (error)
	{
		if (error instanceof WorkflowTaskRetryableError || error instanceof WorkflowTaskTerminalError)
			throw error;
		throw new WorkflowTaskRetryableError("MCP bundle validation persistence is temporarily unavailable.");
	}
}

/** Load the exact product record named by the saved task. */
async function _Load(options: McpbValidationWorkflowOptions, input: McpbValidationTaskInput): Promise<McpbValidationRecord>
{
	return await _RetryablePersistence(async function _LoadWithRetry(): Promise<McpbValidationRecord>
	{
		return await options.unitOfWork.execute(async function _LoadValidation(transaction): Promise<McpbValidationRecord>
		{
			const record = await transaction.mcpbValidations.load(input.siloId, input.validationId, input.submissionDigest);
			if (record === null)
				throw new WorkflowTaskTerminalError("MCP bundle validation is unavailable.");
			return record;
		});
	});
}

/** Map the saved product record to the limited artifact facts the verifier may use. */
function _Target(record: McpbValidationRecord): McpbBundleArtifactTarget
{
	return { siloId: record.siloId, artifactId: record.artifactId, artifactRevisionId: record.artifactRevisionId, contentAddress: record.contentAddress, byteLength: record.byteLength, mediaType: record.mediaType };
}

/** Store one final answer and return the database winner after a replay race. */
async function _Record(options: McpbValidationWorkflowOptions, input: McpbValidationTaskInput, result: McpbVerificationResult): Promise<McpbVerificationResult>
{
	return await _RetryablePersistence(async function _RecordWithRetry(): Promise<McpbVerificationResult>
	{
		return await options.unitOfWork.execute(async function _StoreValidation(transaction): Promise<McpbVerificationResult>
		{
			const event = result.accepted ? McpbValidationEvents.VerificationAccepted : McpbValidationEvents.VerificationRejected;
			const expectedAction = result.accepted ? McpbValidationActions.StoreVerified : McpbValidationActions.StoreRejected;
			if (__McpbValidationTransition(McpbValidationStates.Pending, event) !== expectedAction)
				throw new WorkflowTaskTerminalError("MCP bundle validation transition is invalid.");
			const write = await transaction.mcpbValidations.recordResult(input.siloId, input.validationId, input.submissionDigest, result);
			if (write === null)
				throw new WorkflowTaskTerminalError("MCP bundle validation is unavailable.");
			let winner: McpbVerificationResult | null;
			try { winner = __McpbValidationReplayResult(write.validation); }
			catch { throw new WorkflowTaskTerminalError("MCP bundle validation stored result is invalid."); }
			if (winner === null)
				throw new WorkflowTaskTerminalError("MCP bundle validation stored result is unavailable.");
			if (write.changed)
				await transaction.mcp.appendAudit("Updated", `McpbValidation/${input.validationId}`, `MCP bundle validation ${winner.accepted ? "verified" : "rejected"}`);
			return winner;
		});
	});
}

/** Run the replay-safe manifest and signature check through two saved checkpoints. */
async function _Run(context: IWorkflowTaskContext, options: McpbValidationWorkflowOptions, input: McpbValidationTaskInput): Promise<McpbVerificationResult>
{
	const record = await _Load(options, input);
	let replay: McpbVerificationResult | null;
	try { replay = __McpbValidationReplayResult(record); }
	catch { throw new WorkflowTaskTerminalError("MCP bundle validation stored state is invalid."); }
	if (replay)
		return replay;
	const result = await context.checkpoint({ stepName: "verify-package" }, async function _VerifyPackage(): Promise<McpbVerificationResult>
	{
		try { return await options.verifier.verify(_Target(record)); }
		catch { throw new WorkflowTaskRetryableError("MCP bundle verifier is temporarily unavailable."); }
	});
	return await context.checkpoint({ stepName: "record-decision" }, async function _RecordDecision(): Promise<McpbVerificationResult>
	{
		return await _Record(options, input, result);
	});
}

/** Derive a stable task key without exposing product or artifact identifiers in engine logs. */
export function __McpbValidationTaskKey(input: McpbValidationTaskInput): string
{
	__AssertMcpbValidationTaskInput(input);
	const digest = createHash("sha256").update(JSON.stringify([input.siloId, input.validationId, input.artifactRevisionId, input.contentAddress, input.submissionDigest])).digest("hex");
	return `workflows:mcpb-validation:${digest}`;
}

/** Register the saved MCP bundle verifier and return its transaction-bound admission API. */
export function __CreateMcpbValidationWorkflow(options: McpbValidationWorkflowOptions): McpbValidationWorkflow
{
	options.execution.register({
		taskName: McpbValidationTaskNames.Verify,
		retryPolicy: { maximumAttempts: _MAXIMUM_ATTEMPTS, backoff: { kind: WorkflowTaskRetryBackoffKinds.Exponential, initialDelaySeconds: 30, multiplier: 2, maximumDelaySeconds: 300 } },
		async run(context: IWorkflowTaskContext, input: McpbValidationTaskInput): Promise<McpbVerificationResult>
		{
			__AssertMcpbValidationTaskInput(input);
			return await _Run(context, options, input);
		},
	});
	return {
		async admit(transaction: IWorkflowTransaction, input: McpbValidationTaskInput): Promise<McpbValidationAdmission>
		{
			const taskKey = __McpbValidationTaskKey(input);
			const receipt = await options.execution.spawn(transaction, { taskName: McpbValidationTaskNames.Verify, idempotencyKey: taskKey, input });
			return { taskKey, receipt };
		},
	};
}
