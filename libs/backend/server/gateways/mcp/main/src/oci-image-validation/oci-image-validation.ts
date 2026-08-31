import { createHash } from "node:crypto";

import { WorkflowTaskRetryBackoffKinds, WorkflowTaskRetryableError, WorkflowTaskTerminalError, ___RetryWorkflowDependency } from "@opencrane/backend/server/infra/workflows/contract";
import type { IWorkflowTaskContext, IWorkflowTransaction } from "@opencrane/backend/server/infra/workflows/contract";

import type { OciImageValidationRecord } from "./oci-image-validation-repository.types";
import { OciImageImportFailure } from "./oci-image-import-failure";
import { OciImageValidationActions, OciImageValidationEvents, __OciImageValidationReplayResult, __OciImageValidationTransition } from "./oci-image-validation-state";
import { OciImageValidationStates, OciImageValidationTaskNames, OciImageVerificationFailureCodes } from "./oci-image-validation.types";
import type { OciImageAdmissionResult, OciImageLayoutArtifactTarget, OciImageValidationAdmission, OciImageValidationTaskInput, OciImageValidationWorkflow, OciImageValidationWorkflowOptions, OciImageVerificationResult } from "./oci-image-validation.types";
import { __AssertOciImageValidationTaskInput } from "./oci-image-validation.validator";

/** Stop retrying temporary verifier or database failures after five handler attempts. */
const _MAXIMUM_ATTEMPTS = 5;

/** Keep temporary database failures retryable without changing deliberate workflow outcomes. */
function _RetryablePersistence<TResult>(operation: () => Promise<TResult>): Promise<TResult>
{
	return ___RetryWorkflowDependency(operation, "OCI image validation persistence is temporarily unavailable.");
}

/** Load the exact product record named by the saved task. */
async function _Load(options: OciImageValidationWorkflowOptions, input: OciImageValidationTaskInput): Promise<OciImageValidationRecord>
{
	return await _RetryablePersistence(async function _LoadWithRetry(): Promise<OciImageValidationRecord>
	{
		return await options.unitOfWork.execute(async function _LoadValidation(transaction): Promise<OciImageValidationRecord>
		{
			const record = await transaction.ociImageValidations.load(input.siloId, input.validationId, input.submissionDigest);
			if (record === null)
				throw new WorkflowTaskTerminalError("OCI image validation is unavailable.");
			return record;
		});
	});
}

/** Map the saved product record to the limited artifact facts the verifier may use. */
function _Target(record: OciImageValidationRecord): OciImageLayoutArtifactTarget
{
	return { siloId: record.siloId, artifactId: record.artifactId, artifactRevisionId: record.artifactRevisionId, contentAddress: record.contentAddress, byteLength: record.byteLength, mediaType: record.mediaType };
}

/**
 * Commit one terminal admission answer and return the durable winner after a replay race.
 *
 * The workflow may retry after the registry accepted an import but before this write returned. The
 * conditional repository write therefore owns the only state transition; a losing attempt rereads
 * that committed answer instead of choosing a new outcome or adding a second audit event.
 *
 * Called by: `_Run` inside the `record-decision` checkpoint after validation and any registry import.
 */
async function _Record(options: OciImageValidationWorkflowOptions, input: OciImageValidationTaskInput, result: OciImageAdmissionResult): Promise<OciImageAdmissionResult>
{
	return await _RetryablePersistence(async function _RecordWithRetry(): Promise<OciImageAdmissionResult>
	{
		return await options.unitOfWork.execute(async function _StoreValidation(transaction): Promise<OciImageAdmissionResult>
		{
			// 1. Prove the requested final action against the pending state before the repository changes it.
			const event = result.accepted ? OciImageValidationEvents.ImportAccepted : OciImageValidationEvents.AdmissionRejected;
			const expectedAction = result.accepted ? OciImageValidationActions.StoreImported : OciImageValidationActions.StoreRejected;
			if (__OciImageValidationTransition(OciImageValidationStates.Pending, event) !== expectedAction)
				throw new WorkflowTaskTerminalError("OCI image validation transition is invalid.");

			// 2. Save once, then read the row that won if another replay committed while this attempt ran.
			const write = await transaction.ociImageValidations.recordResult(input.siloId, input.validationId, input.submissionDigest, result);
			if (write === null)
				throw new WorkflowTaskTerminalError("OCI image validation is unavailable.");
			let winner: OciImageAdmissionResult | null;
			try { winner = __OciImageValidationReplayResult(write.validation); }
			catch { throw new WorkflowTaskTerminalError("OCI image validation stored result is invalid."); }
			if (winner === null)
				throw new WorkflowTaskTerminalError("OCI image validation stored result is unavailable.");

			// 3. Audit only the transition winner so replayed tasks retain one durable history entry.
			if (write.changed)
				await transaction.mcp.appendAudit(input.siloId, "Updated", `OciImageValidation/${input.validationId}`, `OCI image admission ${winner.accepted ? "imported" : "rejected"}`);
			return winner;
		});
	});
}

/** Run replay-safe layout validation and registry import through saved checkpoints. */
async function _Run(context: IWorkflowTaskContext, options: OciImageValidationWorkflowOptions, input: OciImageValidationTaskInput): Promise<OciImageAdmissionResult>
{
	const record = await _Load(options, input);
	let replay: OciImageAdmissionResult | null;
	try { replay = __OciImageValidationReplayResult(record); }
	catch { throw new WorkflowTaskTerminalError("OCI image validation stored state is invalid."); }
	if (replay)
		return replay;
	const validation = await context.checkpoint({ stepName: "validate-layout" }, async function _ValidateLayout(): Promise<OciImageVerificationResult>
	{
		try { return await options.verifier.verify(_Target(record)); }
		catch
		{
			if (context.attempt < _MAXIMUM_ATTEMPTS)
				throw new WorkflowTaskRetryableError("OCI image verifier is temporarily unavailable.");
			return { accepted: false, failureCode: OciImageVerificationFailureCodes.ValidationFailed };
		}
	});
	let result: OciImageAdmissionResult;
	if (!validation.accepted)
		result = validation;
	else
	{
		result = await context.checkpoint({ stepName: "import-image" }, async function _ImportImage(): Promise<OciImageAdmissionResult>
		{
			try
			{
				const layout = await options.importer.import(_Target(record), validation.layout);
				return { accepted: true, layout };
			}
			catch (error)
			{
				const retryable = !(error instanceof OciImageImportFailure) || error.retryable;
				if (retryable && context.attempt < _MAXIMUM_ATTEMPTS)
					throw new WorkflowTaskRetryableError("OCI image registry import is temporarily unavailable.");
				return { accepted: false, failureCode: OciImageVerificationFailureCodes.RegistryImportFailed };
			}
		});
	}
	return await context.checkpoint({ stepName: "record-decision" }, async function _RecordDecision(): Promise<OciImageAdmissionResult>
	{
		return await _Record(options, input, result);
	});
}

/**
 * Derives the repeatable workflow key from saved input without exposing its identifiers in engine logs.
 * Identical admissions therefore select the same saved task, while changed immutable input selects a
 * different task.
 *
 * @param input - Saved validation and artifact identity.
 * @returns An opaque workflow idempotency key.
 */
export function __OciImageValidationTaskKey(input: OciImageValidationTaskInput): string
{
	__AssertOciImageValidationTaskInput(input);
	const digest = createHash("sha256").update(JSON.stringify([input.siloId, input.validationId, input.artifactRevisionId, input.contentAddress, input.submissionDigest])).digest("hex");
	return `workflows:oci-image-validation:${digest}`;
}

/**
 * Registers the saved OCI validation and import task, then returns its transaction-bound admission API.
 * The handler checkpoints validation, registry import, and the final product write so a replay can
 * resume without repeating completed external work.
 *
 * Called by: `apps/opencrane/src/app/mcp-workflow-composition.ts` during process composition.
 * @param options - Workflow engine, verifier, importer, and MCP database transaction owner.
 * @returns The API used to save the job in the caller's database transaction.
 */
export function __CreateOciImageValidationWorkflow(options: OciImageValidationWorkflowOptions): OciImageValidationWorkflow
{
	options.execution.register({
		taskName: OciImageValidationTaskNames.Import,
		retryPolicy: { maximumAttempts: _MAXIMUM_ATTEMPTS, backoff: { kind: WorkflowTaskRetryBackoffKinds.Exponential, initialDelaySeconds: 30, multiplier: 2, maximumDelaySeconds: 300 } },
		async run(context: IWorkflowTaskContext, input: OciImageValidationTaskInput): Promise<OciImageAdmissionResult>
		{
			__AssertOciImageValidationTaskInput(input);
			return await _Run(context, options, input);
		},
	});
	return {
		async admit(transaction: IWorkflowTransaction, input: OciImageValidationTaskInput): Promise<OciImageValidationAdmission>
		{
			const taskKey = __OciImageValidationTaskKey(input);
			const receipt = await options.execution.spawn(transaction, { taskName: OciImageValidationTaskNames.Import, idempotencyKey: taskKey, input });
			return { taskKey, receipt };
		},
	};
}
