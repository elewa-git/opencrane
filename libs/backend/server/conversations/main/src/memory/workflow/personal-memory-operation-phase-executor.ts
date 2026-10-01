import type { ZodType } from "zod";

import { MemoryMutationDeliveryStates, ___MemoryGatewayDatasetCognifyResponseSchema, ___MemoryGatewayDatasetEnsureResponseSchema, ___MemoryGatewayDocumentAddResponseSchema, ___MemoryGatewayDocumentDeleteResponseSchema } from "@opencrane/contracts";
import type { MemoryGatewayDocumentListResponse } from "@opencrane/contracts";
import { PersonalMemoryOperationEvents, PersonalMemoryOperationFailureCodes, PersonalMemoryOperationPhases, __PersonalMemoryProviderDatasetName, type PersonalMemoryOperationEvent, type PersonalMemoryOperationRecord } from "@opencrane/backend/agents/personal/memory";
import { WorkflowTaskCancelledError, WorkflowTaskRetryableError, WorkflowTaskTerminalError, type IWorkflowTaskContext } from "@opencrane/backend/server/infra/workflows/contract";

import type { ConversationCaller } from "../../authorization/conversation-caller.types";
import type { PersonalMemoryMessageSourceRead } from "../source/personal-memory-message-source.types";
import { _MutationDeliveryState, _PersonalMemoryOperationBlocked, _PersonalMemoryOperationMutationFailed } from "./personal-memory-operation-failures";
import type { PersonalMemoryOperationAuthorityDependencies } from "./personal-memory-operation-authority.types";

/** One phase handler that returns verified lifecycle evidence or terminal completion. */
interface _PersonalMemoryOperationPhaseHandler
{
	/** Executes one active saved phase. */
	(executor: _PersonalMemoryOperationPhaseExecutor, context: IWorkflowTaskContext, operation: PersonalMemoryOperationRecord): Promise<PersonalMemoryOperationEvent | null>;
}

/** Dispatches each saved phase to one current-authority and evidence-checked operation. */
export class _PersonalMemoryOperationPhaseExecutor
{
	/** Dependencies shared by every phase without retaining transient source content. */
	private readonly dependencies: PersonalMemoryOperationAuthorityDependencies;

	/** Creates the pure-dispatch phase executor around the workflow's explicit ports. */
	constructor(dependencies: PersonalMemoryOperationAuthorityDependencies)
	{
		this.dependencies = dependencies;
	}

	/** Executes the handler selected by the saved phase or its saved recovery phase. */
	async execute(context: IWorkflowTaskContext, operation: PersonalMemoryOperationRecord): Promise<PersonalMemoryOperationEvent | null>
	{
		return _PHASE_HANDLERS[operation.phase](this, context, operation);
	}

	/** Ensures the opaque dataset through a replay-safe, strictly parsed checkpoint. */
	async ensureDataset(context: IWorkflowTaskContext, operation: PersonalMemoryOperationRecord): Promise<PersonalMemoryOperationEvent>
	{
		const executor = this;
		const datasetName = __PersonalMemoryProviderDatasetName(operation.datasetId);
		const receipt = await this._mutation(context, "dataset-ensure", PersonalMemoryOperationFailureCodes.DatasetUnavailable, ___MemoryGatewayDatasetEnsureResponseSchema, async function _ensure()
		{
			const actor = await executor._authorize(operation);
			return executor.dependencies.gateway.ensureDataset(_gatewayContext(operation, actor), { datasetName });
		});
		if (receipt.dataset.datasetName !== datasetName)
			throw _checkpointConflict();
		await this._authorize(operation);
		return { ..._event(operation), event: PersonalMemoryOperationEvents.DatasetEnsured, providerDatasetId: receipt.dataset.datasetId };
	}

	/** Rechecks the exact human source, then adds it through the provider's reconciliation owner. */
	async addDocument(context: IWorkflowTaskContext, operation: PersonalMemoryOperationRecord): Promise<PersonalMemoryOperationEvent>
	{
		const source = operation.source;
		const expectedContentDigest = operation.expectedContentDigest;
		const providerDatasetId = operation.providerDatasetId;
		if (source === null || expectedContentDigest === null || providerDatasetId === null)
			throw new _PersonalMemoryOperationBlocked(PersonalMemoryOperationFailureCodes.SourceUnavailable);
		const executor = this;
		const receipt = await this._mutation(context, "document-add", PersonalMemoryOperationFailureCodes.DocumentConflict, ___MemoryGatewayDocumentAddResponseSchema, async function _add()
		{
			const actor = await executor._actor(operation);
			const read = await executor._readSource(actor, source);
			if (read === null || read.contentDigest !== expectedContentDigest || !_sameSource(read.source, source))
				throw new _PersonalMemoryOperationBlocked(PersonalMemoryOperationFailureCodes.SourceUnavailable);
			await executor._authorize(operation, actor);
			const request = { datasetId: providerDatasetId, content: read.text, contentDigest: expectedContentDigest };
			return executor.dependencies.gateway.addDocument(_gatewayContext(operation, actor), request);
		});
		if (!_sameUuid(receipt.datasetId, providerDatasetId) || receipt.contentDigest !== expectedContentDigest)
			throw _checkpointConflict();
		await this._authorize(operation);
		return { ..._event(operation), event: PersonalMemoryOperationEvents.DocumentAdded, documentId: receipt.documentId, contentDigest: receipt.contentDigest };
	}

	/** Saves the current complete input digest or runs the already identified Cognify operation. */
	async cognify(context: IWorkflowTaskContext, operation: PersonalMemoryOperationRecord): Promise<PersonalMemoryOperationEvent>
	{
		if (operation.providerDatasetId === null || operation.documentId === null || operation.expectedContentDigest === null)
			throw new _PersonalMemoryOperationBlocked(PersonalMemoryOperationFailureCodes.IndexInputChanged);
		if (operation.indexingOperationId === null || operation.expectedInputEvidenceDigest === null)
		{
			const actor = await this._authorize(operation);
			const listed = await this._listDocuments(operation, actor);
			_assertCognifyInput(operation, listed);
			return { ..._event(operation), event: PersonalMemoryOperationEvents.IndexEvidenceSaved, indexingOperationId: this.dependencies.ids.create(), expectedInputEvidenceDigest: listed.inputEvidenceDigest };
		}
		const stepName = `dataset-cognify:${operation.indexingOperationId}`;
		const request = { datasetId: operation.providerDatasetId, operationId: operation.indexingOperationId, expectedInputEvidenceDigest: operation.expectedInputEvidenceDigest };
		const actor = await this._authorize(operation);
		const listed = await this._listDocuments(operation, actor);
		_assertCognifyInput(operation, listed);
		if (listed.inputEvidenceDigest !== request.expectedInputEvidenceDigest)
			throw new _PersonalMemoryOperationBlocked(PersonalMemoryOperationFailureCodes.IndexInputChanged);
		const executor = this;
		const receipt = await this._mutation(context, stepName, PersonalMemoryOperationFailureCodes.IndexingUnavailable, ___MemoryGatewayDatasetCognifyResponseSchema, async function _cognify()
		{
			const currentActor = await executor._authorize(operation);
			return executor.dependencies.gateway.cognifyDataset(_gatewayContext(operation, currentActor), request);
		});
		if (!_sameUuid(receipt.datasetId, request.datasetId) || !_sameUuid(receipt.operationId, request.operationId) || receipt.inputEvidenceDigest !== request.expectedInputEvidenceDigest)
			throw _checkpointConflict();
		await this._authorize(operation);
		return { ..._event(operation), event: PersonalMemoryOperationEvents.IndexingCompleted, indexingOperationId: operation.indexingOperationId, expectedInputEvidenceDigest: operation.expectedInputEvidenceDigest, pipelineRunId: receipt.pipelineRunId };
	}

	/** Builds the fenced catalog event that the atomic authorized catalog owner may publish. */
	async commitCatalog(_context: IWorkflowTaskContext, operation: PersonalMemoryOperationRecord): Promise<PersonalMemoryOperationEvent>
	{
		return { ..._event(operation), event: PersonalMemoryOperationEvents.CatalogCommitted };
	}

	/** Deletes the corrected fact's prior provider document through one stable checkpoint. */
	async deletePriorDocument(context: IWorkflowTaskContext, operation: PersonalMemoryOperationRecord): Promise<PersonalMemoryOperationEvent>
	{
		return this._deleteDocument(context, operation, "prior-document-delete", PersonalMemoryOperationEvents.PriorDocumentDeleted);
	}

	/** Deletes the forgotten fact's provider document through one stable checkpoint. */
	async deleteDocument(context: IWorkflowTaskContext, operation: PersonalMemoryOperationRecord): Promise<PersonalMemoryOperationEvent>
	{
		return this._deleteDocument(context, operation, "document-delete", PersonalMemoryOperationEvents.DocumentDeleted);
	}

	/** Builds the fenced finalization event that the atomic authorized catalog owner may publish. */
	async finalizeCatalog(_context: IWorkflowTaskContext, operation: PersonalMemoryOperationRecord): Promise<PersonalMemoryOperationEvent>
	{
		return { ..._event(operation), event: PersonalMemoryOperationEvents.CatalogFinalized };
	}

	/** Dispatches recovery only through the phase already frozen in the saved operation. */
	async recover(context: IWorkflowTaskContext, operation: PersonalMemoryOperationRecord): Promise<PersonalMemoryOperationEvent>
	{
		const phase = operation.recoveryPhase;
		if (phase === null || phase === PersonalMemoryOperationPhases.RecoveryRequired || phase === PersonalMemoryOperationPhases.Completed)
			throw new Error("Personal-memory recovery phase is invalid");
		const event = await _PHASE_HANDLERS[phase](this, context, operation);
		if (event === null)
			throw new Error("Personal-memory recovery reached a terminal handler");
		return event;
	}

	/** Returns terminal completion without touching actor, authorization, source, or provider ports. */
	async complete(_context: IWorkflowTaskContext, _operation: PersonalMemoryOperationRecord): Promise<null>
	{
		return null;
	}

	/** Deletes one exact saved target after current actor and MemoryScope checks. */
	private async _deleteDocument(context: IWorkflowTaskContext, operation: PersonalMemoryOperationRecord, stepName: string, event: PersonalMemoryOperationEvents.PriorDocumentDeleted | PersonalMemoryOperationEvents.DocumentDeleted): Promise<PersonalMemoryOperationEvent>
	{
		if (operation.providerDatasetId === null || operation.targetDocumentId === null)
			throw new _PersonalMemoryOperationBlocked(PersonalMemoryOperationFailureCodes.DeletionUnavailable);
		const request = { datasetId: operation.providerDatasetId, documentId: operation.targetDocumentId };
		const executor = this;
		const receipt = await this._mutation(context, stepName, PersonalMemoryOperationFailureCodes.DeletionUnavailable, ___MemoryGatewayDocumentDeleteResponseSchema, async function _delete()
		{
			const actor = await executor._authorize(operation);
			return executor.dependencies.gateway.deleteDocument(_gatewayContext(operation, actor), request);
		});
		if (!_sameUuid(receipt.documentId, operation.targetDocumentId) || !_sameUuid(receipt.datasetId, operation.providerDatasetId))
			throw _checkpointConflict();
		await this._authorize(operation);
		return { ..._event(operation), event, documentId: operation.targetDocumentId };
	}

	/** Resolves the exact current external actor or selects an authority-ended lifecycle outcome. */
	private async _actor(operation: PersonalMemoryOperationRecord): Promise<ConversationCaller>
	{
		let actor: ConversationCaller | null;
		try
		{
			actor = await this.dependencies.actors.resolve(operation.siloId, operation.actorPrincipalId);
		}
		catch
		{
			throw new WorkflowTaskRetryableError("Personal-memory actor evidence is temporarily unavailable");
		}
		if (actor === null || actor.siloId !== operation.siloId || actor.principalId !== operation.actorPrincipalId || actor.subjectId.trim().length === 0 || actor.externalIssuer === undefined || actor.externalIssuer.trim().length === 0)
			throw new _PersonalMemoryOperationBlocked(PersonalMemoryOperationFailureCodes.AuthorityEnded);
		return actor;
	}

	/** Rechecks the actor and current MemoryScope action immediately before protected work. */
	private async _authorize(operation: PersonalMemoryOperationRecord, resolved?: ConversationCaller): Promise<ConversationCaller>
	{
		const actor = resolved ?? await this._actor(operation);
		const now = this.dependencies.clock.now();
		let allowed: boolean;
		try
		{
			allowed = !Number.isNaN(now.getTime()) && await this.dependencies.authorization.allows(operation, actor, now);
		}
		catch
		{
			throw new WorkflowTaskRetryableError("Personal-memory authorization evidence is temporarily unavailable");
		}
		if (!allowed)
			throw new _PersonalMemoryOperationBlocked(PersonalMemoryOperationFailureCodes.AuthorityEnded);
		return actor;
	}

	/** Reads the exact source while keeping a transport failure distinct from provider delivery. */
	private async _readSource(actor: ConversationCaller, source: NonNullable<PersonalMemoryOperationRecord["source"]>): Promise<PersonalMemoryMessageSourceRead | null>
	{
		try
		{
			return await this.dependencies.sources.read(actor, source.conversationId, source.messageId, source.messagePosition);
		}
		catch
		{
			throw new WorkflowTaskRetryableError("Personal-memory source evidence is temporarily unavailable");
		}
	}

	/** Lists current provider input as a read before any mutation checkpoint begins. */
	private async _listDocuments(operation: PersonalMemoryOperationRecord, actor: ConversationCaller): Promise<MemoryGatewayDocumentListResponse>
	{
		if (operation.providerDatasetId === null)
			throw new _PersonalMemoryOperationBlocked(PersonalMemoryOperationFailureCodes.IndexInputChanged);
		try
		{
			return await this.dependencies.gateway.listDocuments(_gatewayContext(operation, actor), { datasetId: operation.providerDatasetId });
		}
		catch
		{
			throw new WorkflowTaskRetryableError("Personal-memory index evidence is temporarily unavailable");
		}
	}

	/** Runs one mutation checkpoint and strictly validates both fresh and replayed JSON receipts. */
	private async _mutation<Result>(context: IWorkflowTaskContext, stepName: string, failureCode: PersonalMemoryOperationFailureCodes, schema: ZodType<Result>, operation: () => Promise<Result>): Promise<Result>
	{
		let receipt: unknown;
		let operationReturned = false;
		try
		{
			receipt = await context.checkpoint<unknown>({ stepName }, async function _mutate()
			{
				try
				{
					const result = await operation();
					operationReturned = true;
					return result;
				}
				catch (error)
				{
					if (error instanceof _PersonalMemoryOperationBlocked || error instanceof WorkflowTaskCancelledError || error instanceof WorkflowTaskRetryableError || error instanceof WorkflowTaskTerminalError)
						throw error;
					throw new _PersonalMemoryOperationMutationFailed(failureCode, _MutationDeliveryState(error));
				}
			});
		}
		catch (error)
		{
			if (operationReturned)
				throw new _PersonalMemoryOperationMutationFailed(failureCode, MemoryMutationDeliveryStates.Ambiguous);
			if (error instanceof _PersonalMemoryOperationBlocked || error instanceof _PersonalMemoryOperationMutationFailed || error instanceof WorkflowTaskCancelledError || error instanceof WorkflowTaskRetryableError || error instanceof WorkflowTaskTerminalError)
				throw error;
			throw new WorkflowTaskRetryableError("Personal-memory mutation checkpoint is temporarily unavailable");
		}
		const parsed = schema.safeParse(receipt);
		if (!parsed.success)
			throw _checkpointConflict();
		return parsed.data;
	}
}

/** Builds the shared event fence from one validated saved operation. */
function _event(operation: PersonalMemoryOperationRecord): Pick<PersonalMemoryOperationEvent, "operationId" | "kind" | "expectedRevision">
{
	return { operationId: operation.operationId, kind: operation.kind, expectedRevision: operation.revision };
}

/** Builds gateway context only from the saved silo and freshly resolved subject. */
function _gatewayContext(operation: PersonalMemoryOperationRecord, actor: ConversationCaller): { readonly siloId: string; readonly subjectId: string }
{
	return { siloId: operation.siloId, subjectId: actor.subjectId };
}

/** Compares UUID coordinates across provider lowercase canonicalization. */
function _sameUuid(first: string, second: string): boolean
{
	return first.toLowerCase() === second.toLowerCase();
}

/** Rejects a durable checkpoint receipt that cannot belong to its frozen request. */
function _checkpointConflict(): WorkflowTaskTerminalError
{
	return new WorkflowTaskTerminalError("Personal-memory mutation checkpoint receipt conflicts with its saved request");
}

/** Requires the saved new document and its exact digest in the provider's locked input snapshot. */
function _assertCognifyInput(operation: PersonalMemoryOperationRecord, listed: { readonly datasetId: string; readonly inputEvidenceDigest: string; readonly documents: readonly { readonly documentId: string; readonly contentDigest: string }[] }): void
{
	if (operation.providerDatasetId === null || operation.documentId === null || operation.expectedContentDigest === null)
		throw new _PersonalMemoryOperationBlocked(PersonalMemoryOperationFailureCodes.IndexInputChanged);
	const documentId = operation.documentId;
	const document = listed.documents.find(candidate => _sameUuid(candidate.documentId, documentId));
	if (!_sameUuid(listed.datasetId, operation.providerDatasetId) || document?.contentDigest !== operation.expectedContentDigest)
		throw new _PersonalMemoryOperationBlocked(PersonalMemoryOperationFailureCodes.IndexInputChanged);
}

/** Compares every saved source coordinate without retaining its plaintext. */
function _sameSource(left: NonNullable<PersonalMemoryOperationRecord["source"]>, right: NonNullable<PersonalMemoryOperationRecord["source"]>): boolean
{
	return left.conversationId === right.conversationId
		&& left.messageId === right.messageId
		&& left.messagePosition === right.messagePosition
		&& left.payloadRef === right.payloadRef
		&& left.ciphertextDigest === right.ciphertextDigest
		&& left.authorPrincipalId === right.authorPrincipalId;
}

/** Exhaustive saved-phase dispatch table; only the lifecycle owner decides which phase is durable. */
const _PHASE_HANDLERS: Readonly<Record<PersonalMemoryOperationPhases, _PersonalMemoryOperationPhaseHandler>> = {
	[PersonalMemoryOperationPhases.DatasetEnsurePending]: function _ensure(executor, context, operation) { return executor.ensureDataset(context, operation); },
	[PersonalMemoryOperationPhases.DocumentAddPending]: function _add(executor, context, operation) { return executor.addDocument(context, operation); },
	[PersonalMemoryOperationPhases.CognifyPending]: function _cognify(executor, context, operation) { return executor.cognify(context, operation); },
	[PersonalMemoryOperationPhases.CatalogCommitPending]: function _commit(executor, context, operation) { return executor.commitCatalog(context, operation); },
	[PersonalMemoryOperationPhases.PriorDocumentDeletePending]: function _deletePrior(executor, context, operation) { return executor.deletePriorDocument(context, operation); },
	[PersonalMemoryOperationPhases.DocumentDeletePending]: function _delete(executor, context, operation) { return executor.deleteDocument(context, operation); },
	[PersonalMemoryOperationPhases.CatalogFinalizePending]: function _finalize(executor, context, operation) { return executor.finalizeCatalog(context, operation); },
	[PersonalMemoryOperationPhases.RecoveryRequired]: function _recover(executor, context, operation) { return executor.recover(context, operation); },
	[PersonalMemoryOperationPhases.Completed]: function _complete(executor, context, operation) { return executor.complete(context, operation); },
};
