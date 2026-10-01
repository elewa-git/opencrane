import { PersonalMemoryOperationEvents, PersonalMemoryOperationInvalidState, PersonalMemoryOperationPersistenceOutcomes, PersonalMemoryOperationPhases, type PersonalMemoryOperationEvent, type PersonalMemoryOperationPersistenceResult, type PersonalMemoryOperationRecord } from "@opencrane/backend/agents/personal/memory";
import { WorkflowTaskCancelledError, WorkflowTaskRetryableError, WorkflowTaskTerminalError, type IWorkflowTaskContext } from "@opencrane/backend/server/infra/workflows/contract";

import { _PersonalMemoryOperationBlocked, _PersonalMemoryOperationMutationFailed } from "./personal-memory-operation-failures";
import { _PersonalMemoryOperationPhaseExecutor } from "./personal-memory-operation-phase-executor";
import type { PersonalMemoryOperationAuthorityDependencies } from "./personal-memory-operation-authority.types";
import { PERSONAL_MEMORY_OPERATION_TASK } from "./personal-memory-operation-task";
import { PersonalMemoryOperationTaskOutcomes, type PersonalMemoryOperationTaskInput, type PersonalMemoryOperationTaskResult } from "./personal-memory-operation-task.types";
import { _PersonalMemoryOperationTaskInputSchema } from "./personal-memory-operation-task.validator";

/**
 * Owns saved personal-memory phase selection, current checks, lifecycle events, and revision-conflict recovery.
 *
 * The authority accepts only the identifier-only task input and its exact saved receipt. Provider
 * methods remain single-step operations; this owner decides their durable order and converts only
 * content-free delivery evidence into lifecycle events.
 *
 * Called by: {@link _RegisterPersonalMemoryOperationWorkflow} from server composition.
 */
export class PersonalMemoryOperationAuthority
{
	/** Explicit dependencies used by the phase executor and persistence loop. */
	private readonly dependencies: PersonalMemoryOperationAuthorityDependencies;
	/** Exhaustive phase dispatcher that never stores transient source text. */
	private readonly phases: _PersonalMemoryOperationPhaseExecutor;

	/**
	 * Creates the sole saved-phase operation owner.
	 * @param dependencies - Configured silo, persistence, current authority, source, gateway, and test seams.
	 */
	public constructor(dependencies: PersonalMemoryOperationAuthorityDependencies)
	{
		this.dependencies = dependencies;
		this.phases = new _PersonalMemoryOperationPhaseExecutor(dependencies);
	}

	/**
	 * Resumes one admitted operation until it completes or requires a later workflow attempt.
	 * @param context - Engine context whose receipt and checkpoints belong to this task.
	 * @param input - Identifier-only silo and operation coordinates admitted with the command.
	 * @returns Closed completion after every saved provider and catalog phase finishes.
	 * @throws WorkflowTaskTerminalError When task or durable operation evidence conflicts.
	 * @throws WorkflowTaskRetryableError When current evidence or infrastructure may recover later.
	 */
	public async run(context: IWorkflowTaskContext, input: PersonalMemoryOperationTaskInput): Promise<PersonalMemoryOperationTaskResult>
	{
		const accepted = _PersonalMemoryOperationTaskInputSchema.safeParse(input);
		if (!accepted.success || accepted.data.siloId !== this.dependencies.siloId || !_initialTaskMatches(context, accepted.data))
			throw new WorkflowTaskTerminalError("Personal-memory task input differs from its admitted coordinates");
		let operation = await this._load(accepted.data);
		_assertSavedTask(operation, context, accepted.data);

		while (true)
		{
			if (operation.phase === PersonalMemoryOperationPhases.Completed)
				return { outcome: PersonalMemoryOperationTaskOutcomes.Completed, operationId: operation.operationId };
			let event: PersonalMemoryOperationEvent;
			try
			{
				const phaseEvent = await this.phases.execute(context, operation);
				if (phaseEvent === null)
					throw new WorkflowTaskTerminalError("Personal-memory unfinished phase returned completion");
				event = phaseEvent;
			}
			catch (error)
			{
				if (error instanceof _PersonalMemoryOperationBlocked)
				{
					if (operation.phase === PersonalMemoryOperationPhases.RecoveryRequired)
						throw new WorkflowTaskRetryableError("Personal-memory recovery guard remains unavailable");
					event = { ..._event(operation), event: PersonalMemoryOperationEvents.OperationBlocked, failureCode: error.failureCode };
				}
				else if (error instanceof _PersonalMemoryOperationMutationFailed)
				{
					if (operation.phase === PersonalMemoryOperationPhases.RecoveryRequired)
						throw new WorkflowTaskRetryableError("Personal-memory mutation recovery remains unavailable");
					event = { ..._event(operation), event: PersonalMemoryOperationEvents.MutationFailed, failureCode: error.failureCode, deliveryState: error.deliveryState };
				}
				else if (error instanceof WorkflowTaskCancelledError || error instanceof WorkflowTaskTerminalError || error instanceof WorkflowTaskRetryableError)
					throw error;
				else
					throw new WorkflowTaskRetryableError("Personal-memory operation dependency is temporarily unavailable");
			}
			const result = await this._apply(event);
			if (result.outcome === PersonalMemoryOperationPersistenceOutcomes.Denied)
				throw new WorkflowTaskTerminalError("Personal-memory lifecycle rejected saved phase evidence");
			if (result.outcome === PersonalMemoryOperationPersistenceOutcomes.Retry)
				throw new WorkflowTaskRetryableError("Personal-memory provider proved the unchanged operation may retry");
			operation = result.operation;
			if (operation.phase === PersonalMemoryOperationPhases.RecoveryRequired)
				throw new WorkflowTaskRetryableError("Personal-memory operation requires recovery");
		}
	}

	/** Loads one saved operation while separating invalid evidence from transient persistence failure. */
	private async _load(input: PersonalMemoryOperationTaskInput): Promise<PersonalMemoryOperationRecord>
	{
		try
		{
			const operation = await this.dependencies.operations.load(input.siloId, input.operationId);
			if (operation === null)
				throw new WorkflowTaskTerminalError("Personal-memory task has no saved operation");
			return operation;
		}
		catch (error)
		{
			if (error instanceof WorkflowTaskTerminalError)
				throw error;
			if (error instanceof PersonalMemoryOperationInvalidState)
				throw new WorkflowTaskTerminalError("Personal-memory operation state is invalid");
			throw new WorkflowTaskRetryableError("Personal-memory operation could not be loaded");
		}
	}

	/** Applies one lifecycle event while preserving uncertain post-provider receipts for retry. */
	private async _apply(event: PersonalMemoryOperationEvent): Promise<PersonalMemoryOperationPersistenceResult>
	{
		try
		{
			const recordedAt = this.dependencies.clock.now();
			if (_isCatalogEvent(event))
			{
				const result = await this.dependencies.catalog.apply(event, recordedAt);
				return result.persistence;
			}
			return await this.dependencies.operations.apply(event, recordedAt);
		}
		catch (error)
		{
			if (error instanceof WorkflowTaskCancelledError || error instanceof WorkflowTaskRetryableError || error instanceof WorkflowTaskTerminalError)
				throw error;
			if (error instanceof PersonalMemoryOperationInvalidState)
				throw new WorkflowTaskTerminalError("Personal-memory lifecycle state is invalid");
			throw new WorkflowTaskRetryableError("Personal-memory lifecycle event could not be saved");
		}
	}
}

/** Selects the two events whose catalog write requires an atomic current-authority transaction. */
function _isCatalogEvent(event: PersonalMemoryOperationEvent): boolean
{
	return event.event === PersonalMemoryOperationEvents.CatalogCommitted || event.event === PersonalMemoryOperationEvents.CatalogFinalized;
}

/** Checks receipt coordinates available before the operation row is loaded. */
function _initialTaskMatches(context: IWorkflowTaskContext, input: PersonalMemoryOperationTaskInput): boolean
{
	return context.task.taskName === PERSONAL_MEMORY_OPERATION_TASK.taskName
		&& context.task.idempotencyKey === input.operationId
		&& context.task.taskId.trim().length > 0;
}

/** Checks the complete saved workflow receipt before any current identity or provider read. */
function _assertSavedTask(operation: PersonalMemoryOperationRecord, context: IWorkflowTaskContext, input: PersonalMemoryOperationTaskInput): void
{
	if (operation.operationId !== input.operationId || operation.siloId !== input.siloId
		|| operation.task.taskId !== context.task.taskId
		|| operation.task.taskName !== context.task.taskName
		|| operation.task.taskKey !== context.task.idempotencyKey)
		throw new WorkflowTaskTerminalError("Personal-memory task receipt differs from its saved operation");
}

/** Builds the shared failure-event fence from one saved operation. */
function _event(operation: PersonalMemoryOperationRecord): Pick<PersonalMemoryOperationEvent, "operationId" | "kind" | "expectedRevision">
{
	return { operationId: operation.operationId, kind: operation.kind, expectedRevision: operation.revision };
}
