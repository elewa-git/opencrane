import { MemoryGatewayErrorCodes, MemoryMutationDeliveryStates } from "@opencrane/contracts";
import { PersonalMemoryOperationEvents, PersonalMemoryOperationFailureCodes, PersonalMemoryOperationKinds, PersonalMemoryOperationPersistenceOutcomes, PersonalMemoryOperationPhases, PersonalMemoryOperationTransitionOutcomes, __PlanPersonalMemoryOperationLifecycle, type PersonalMemoryOperationEvent, type PersonalMemoryOperationLifecycle, type PersonalMemoryOperationRecord, type PersonalMemoryOperationUnitOfWork } from "@opencrane/backend/agents/personal/memory";
import { MemoryGatewayMutationFailure, type MemoryGatewayClient } from "@opencrane/backend/server/infra/memory-gateway-client";
import { WorkflowTaskCancelledError, WorkflowTaskRetryableError, WorkflowTaskTerminalError, type IWorkflowTaskContext } from "@opencrane/backend/server/infra/workflows/contract";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PersonalMemoryMessageSourceRead } from "../../source/personal-memory-message-source.types";
import { PersonalMemoryOperationAuthority } from "../personal-memory-operation-authority";
import { PersonalMemoryOperationAuthorizedCatalogApplyOutcomes, type PersonalMemoryOperationAuthorityDependencies } from "../personal-memory-operation-authority.types";
import { PERSONAL_MEMORY_OPERATION_TASK } from "../personal-memory-operation-task";
import { PersonalMemoryOperationTaskOutcomes } from "../personal-memory-operation-task.types";

const _OPERATION_ID = "928b379d-d679-42db-bd46-c938bb15f3d1";
const _TASK_ID = "2e886d70-4dc8-4d18-873b-a2cb17f66798";
const _DATASET_ID = "dataset-1";
const _PROVIDER_DATASET_ID = "51111111-1111-4111-8111-111111111111";
const _DOCUMENT_ID = "52222222-2222-4222-8222-222222222222";
const _TARGET_DOCUMENT_ID = "53333333-3333-4333-8333-333333333333";
const _INDEXING_OPERATION_ID = "54444444-4444-4444-8444-444444444444";
const _PIPELINE_RUN_ID = "55555555-5555-4555-8555-555555555555";
const _OTHER_UUID = "56666666-6666-4666-8666-666666666666";
const _CONTENT_DIGEST = `sha256:${"a".repeat(64)}`;
const _INPUT_DIGEST = `sha256:${"b".repeat(64)}`;
const _SOURCE = { conversationId: "conversation-1", messageId: "message-1", messagePosition: 3n, payloadRef: "payload-1", ciphertextDigest: `sha256:${"c".repeat(64)}`, authorPrincipalId: "principal-1" };
const _ACTOR = { siloId: "silo-1", principalId: "principal-1", subjectId: "subject-1", externalIssuer: "https://issuer.test" };

interface _Harness
{
	readonly authority: PersonalMemoryOperationAuthority;
	readonly operations: PersonalMemoryOperationUnitOfWork;
	readonly catalog: { readonly apply: ReturnType<typeof vi.fn> };
	readonly context: IWorkflowTaskContext;
	readonly events: PersonalMemoryOperationEvent[];
	readonly checkpointNames: string[];
	readonly checkpoints: Map<string, unknown>;
	readonly actors: { readonly resolve: ReturnType<typeof vi.fn> };
	readonly authorization: { readonly allows: ReturnType<typeof vi.fn> };
	readonly sources: { readonly read: ReturnType<typeof vi.fn> };
	readonly gateway: Record<string, ReturnType<typeof vi.fn>>;
	get operation(): PersonalMemoryOperationRecord;
	set operation(value: PersonalMemoryOperationRecord);
}

/** Builds a complete durable operation for one allowed lifecycle phase. */
function _Record(kind: PersonalMemoryOperationKinds = PersonalMemoryOperationKinds.Remember, phase?: PersonalMemoryOperationPhases): PersonalMemoryOperationRecord
{
	const remembers = kind === PersonalMemoryOperationKinds.Remember;
	const forgets = kind === PersonalMemoryOperationKinds.Forget;
	return {
		operationId: _OPERATION_ID,
		siloId: "silo-1",
		datasetId: _DATASET_ID,
		actorPrincipalId: _ACTOR.principalId,
		idempotencyKeyDigest: `sha256:${"d".repeat(64)}`,
		commandDigest: `sha256:${"e".repeat(64)}`,
		kind,
		phase: phase ?? _InitialPhase(kind),
		revision: 1,
		recoveryPhase: null,
		expectedContentDigest: forgets ? null : _CONTENT_DIGEST,
		targetFactId: remembers ? null : "fact-1",
		targetDocumentId: remembers ? null : _TARGET_DOCUMENT_ID,
		providerDatasetId: remembers ? null : _PROVIDER_DATASET_ID,
		documentId: null,
		indexingOperationId: null,
		expectedInputEvidenceDigest: null,
		pipelineRunId: null,
		failureCode: null,
		deliveryState: null,
		source: forgets ? null : _SOURCE,
		expectedFactRevision: remembers ? null : 2,
		admittedProviderDatasetId: remembers ? null : _PROVIDER_DATASET_ID,
		task: { taskId: _TASK_ID, taskName: PERSONAL_MEMORY_OPERATION_TASK.taskName, taskKey: _OPERATION_ID },
		admittedAt: new Date("2026-09-14T08:00:00.000Z"),
		recoveryRecordedAt: null,
		completedAt: null,
	};
}

/** Creates controlled persistence, workflow, current-authority, source, and gateway ports. */
function _CreateHarness(initial: PersonalMemoryOperationRecord = _Record()): _Harness
{
	let operation = initial;
	const events: PersonalMemoryOperationEvent[] = [];
	const checkpoints = new Map<string, unknown>();
	const checkpointNames: string[] = [];
	const actors = { resolve: vi.fn().mockResolvedValue(_ACTOR) };
	const authorization = { allows: vi.fn().mockResolvedValue(true) };
	const sourceRead: PersonalMemoryMessageSourceRead = { source: _SOURCE, text: "My durable preference", contentDigest: _CONTENT_DIGEST };
	const sources = { read: vi.fn().mockResolvedValue(sourceRead) };
	const gateway = {
		ensureDataset: vi.fn().mockResolvedValue({ dataset: { datasetId: _PROVIDER_DATASET_ID, datasetName: "" } }),
		addDocument: vi.fn().mockResolvedValue({ datasetId: _PROVIDER_DATASET_ID, documentId: _DOCUMENT_ID, contentDigest: _CONTENT_DIGEST }),
		listDocuments: vi.fn().mockResolvedValue({ datasetId: _PROVIDER_DATASET_ID, inputEvidenceDigest: _INPUT_DIGEST, documents: [{ documentId: _DOCUMENT_ID, contentDigest: _CONTENT_DIGEST }] }),
		cognifyDataset: vi.fn().mockResolvedValue({ datasetId: _PROVIDER_DATASET_ID, operationId: _INDEXING_OPERATION_ID, inputEvidenceDigest: _INPUT_DIGEST, pipelineRunId: _PIPELINE_RUN_ID }),
		deleteDocument: vi.fn().mockResolvedValue({ datasetId: _PROVIDER_DATASET_ID, documentId: _TARGET_DOCUMENT_ID }),
	};
	const operations: PersonalMemoryOperationUnitOfWork = {
		load: vi.fn().mockImplementation(function _Load() { return Promise.resolve(operation); }),
		apply: vi.fn().mockImplementation(function _Apply(event: PersonalMemoryOperationEvent, recordedAt: Date)
		{
			events.push(event);
			const planned = __PlanPersonalMemoryOperationLifecycle(_Lifecycle(operation), event);
			if (planned.outcome === PersonalMemoryOperationTransitionOutcomes.Denied || planned.operation === undefined)
				return Promise.resolve({ outcome: PersonalMemoryOperationPersistenceOutcomes.Denied, operation, reason: planned.reason });
			if (planned.outcome === PersonalMemoryOperationTransitionOutcomes.Retry)
				return Promise.resolve({ outcome: PersonalMemoryOperationPersistenceOutcomes.Retry, operation });
			operation = { ...operation, ...planned.operation, ..._RecordedTimes(planned.operation.phase, recordedAt) };
			return Promise.resolve({ outcome: PersonalMemoryOperationPersistenceOutcomes.Advanced, operation });
		}),
	};
	const catalog = {
		apply: vi.fn().mockImplementation(async function _ApplyCatalog(event: PersonalMemoryOperationEvent, recordedAt: Date)
		{
			return { outcome: PersonalMemoryOperationAuthorizedCatalogApplyOutcomes.Applied, persistence: await operations.apply(event, recordedAt) };
		}),
	};
	const context = {
		task: { taskId: _TASK_ID, taskName: PERSONAL_MEMORY_OPERATION_TASK.taskName, idempotencyKey: _OPERATION_ID },
		attempt: 1,
		checkpoint: vi.fn().mockImplementation(async function _Checkpoint(step: { readonly stepName: string }, action: () => Promise<unknown>)
		{
			checkpointNames.push(step.stepName);
			if (checkpoints.has(step.stepName))
				return checkpoints.get(step.stepName);
			const result = await action();
			checkpoints.set(step.stepName, result);
			return result;
		}),
	} as unknown as IWorkflowTaskContext;
	const dependencies: PersonalMemoryOperationAuthorityDependencies = {
		siloId: "silo-1",
		operations,
		catalog,
		actors,
		authorization,
		sources,
		gateway: gateway as unknown as MemoryGatewayClient,
		clock: { now: function _Now() { return new Date("2026-09-14T09:00:00.000Z"); } },
		ids: { create: function _Create() { return _INDEXING_OPERATION_ID; } },
	};
	return { authority: new PersonalMemoryOperationAuthority(dependencies), operations, catalog, context, events, checkpointNames, checkpoints, actors, authorization, sources, gateway, get operation() { return operation; }, set operation(value) { operation = value; } };
}

/** Selects the first saved phase owned by each admitted operation kind. */
function _InitialPhase(kind: PersonalMemoryOperationKinds): PersonalMemoryOperationPhases
{
	switch (kind)
	{
		case PersonalMemoryOperationKinds.Remember: return PersonalMemoryOperationPhases.DatasetEnsurePending;
		case PersonalMemoryOperationKinds.Correct: return PersonalMemoryOperationPhases.DocumentAddPending;
		case PersonalMemoryOperationKinds.Forget: return PersonalMemoryOperationPhases.DocumentDeletePending;
	}
}

/** Projects lifecycle timestamps that the fake persistence owner would write. */
function _RecordedTimes(phase: PersonalMemoryOperationPhases, recordedAt: Date): Pick<PersonalMemoryOperationRecord, "recoveryRecordedAt" | "completedAt">
{
	return {
		recoveryRecordedAt: phase === PersonalMemoryOperationPhases.RecoveryRequired ? recordedAt : null,
		completedAt: phase === PersonalMemoryOperationPhases.Completed ? recordedAt : null,
	};
}

/** Projects only lifecycle fields because the lifecycle validator deliberately rejects record metadata. */
function _Lifecycle(operation: PersonalMemoryOperationRecord): PersonalMemoryOperationLifecycle
{
	return {
		operationId: operation.operationId,
		kind: operation.kind,
		phase: operation.phase,
		revision: operation.revision,
		recoveryPhase: operation.recoveryPhase,
		expectedContentDigest: operation.expectedContentDigest,
		targetFactId: operation.targetFactId,
		targetDocumentId: operation.targetDocumentId,
		providerDatasetId: operation.providerDatasetId,
		documentId: operation.documentId,
		indexingOperationId: operation.indexingOperationId,
		expectedInputEvidenceDigest: operation.expectedInputEvidenceDigest,
		pipelineRunId: operation.pipelineRunId,
		failureCode: operation.failureCode,
		deliveryState: operation.deliveryState,
	};
}

describe("personal memory saved-phase authority", function _Suite()
{
	beforeEach(function _Reset()
	{
		vi.clearAllMocks();
	});

	it("runs Remember through ordered provider and catalog phases without saving plaintext", async function _Remember()
	{
		const f = _CreateHarness();
		f.gateway.ensureDataset.mockImplementation(async function _Ensure(_context, request) { return { dataset: { datasetId: _PROVIDER_DATASET_ID, datasetName: request.datasetName } }; });
		await expect(f.authority.run(f.context, { siloId: "silo-1", operationId: _OPERATION_ID })).resolves.toEqual({ outcome: PersonalMemoryOperationTaskOutcomes.Completed, operationId: _OPERATION_ID });
		expect(f.events.map(event => event.event)).toEqual([PersonalMemoryOperationEvents.DatasetEnsured, PersonalMemoryOperationEvents.DocumentAdded, PersonalMemoryOperationEvents.IndexEvidenceSaved, PersonalMemoryOperationEvents.IndexingCompleted, PersonalMemoryOperationEvents.CatalogCommitted]);
		expect(f.checkpointNames).toEqual(["dataset-ensure", "document-add", `dataset-cognify:${_INDEXING_OPERATION_ID}`]);
		expect(JSON.stringify({ events: f.events, checkpointNames: f.checkpointNames })).not.toContain("My durable preference");
		expect(f.gateway.addDocument).toHaveBeenCalledWith({ siloId: "silo-1", subjectId: "subject-1" }, { datasetId: _PROVIDER_DATASET_ID, content: "My durable preference", contentDigest: _CONTENT_DIGEST });
	});

	it.each([
		[PersonalMemoryOperationKinds.Correct, [PersonalMemoryOperationEvents.DocumentAdded, PersonalMemoryOperationEvents.IndexEvidenceSaved, PersonalMemoryOperationEvents.IndexingCompleted, PersonalMemoryOperationEvents.CatalogCommitted, PersonalMemoryOperationEvents.PriorDocumentDeleted]],
		[PersonalMemoryOperationKinds.Forget, [PersonalMemoryOperationEvents.DocumentDeleted, PersonalMemoryOperationEvents.CatalogFinalized]],
	] as const)("runs the complete %s event order", async function _Journey(kind, expectedEvents)
	{
		const f = _CreateHarness(_Record(kind));
		await expect(f.authority.run(f.context, { siloId: "silo-1", operationId: _OPERATION_ID })).resolves.toMatchObject({ outcome: PersonalMemoryOperationTaskOutcomes.Completed });
		expect(f.events.map(event => event.event)).toEqual(expectedEvents);
	});

	it("returns a saved Completed result before current actor, grant, source, or provider reads", async function _Completed()
	{
		const f = _CreateHarness({ ..._Record(), phase: PersonalMemoryOperationPhases.Completed, providerDatasetId: _PROVIDER_DATASET_ID, documentId: _DOCUMENT_ID, indexingOperationId: _INDEXING_OPERATION_ID, expectedInputEvidenceDigest: _INPUT_DIGEST, pipelineRunId: _PIPELINE_RUN_ID, completedAt: new Date() });
		await expect(f.authority.run(f.context, { siloId: "silo-1", operationId: _OPERATION_ID })).resolves.toEqual({ outcome: PersonalMemoryOperationTaskOutcomes.Completed, operationId: _OPERATION_ID });
		expect(f.actors.resolve).not.toHaveBeenCalled();
		expect(f.authorization.allows).not.toHaveBeenCalled();
		expect(f.sources.read).not.toHaveBeenCalled();
		expect(f.gateway.ensureDataset).not.toHaveBeenCalled();
	});

	it("rejects a mismatched saved task receipt before current or provider reads", async function _ReceiptMismatch()
	{
		const f = _CreateHarness({ ..._Record(), task: { ..._Record().task, taskId: "another-task" } });
		await expect(f.authority.run(f.context, { siloId: "silo-1", operationId: _OPERATION_ID })).rejects.toBeInstanceOf(WorkflowTaskTerminalError);
		expect(f.actors.resolve).not.toHaveBeenCalled();
		expect(f.gateway.ensureDataset).not.toHaveBeenCalled();
	});

	it("saves current-authority loss as recovery without calling the provider", async function _AuthorityEnded()
	{
		const f = _CreateHarness();
		f.authorization.allows.mockResolvedValue(false);
		await expect(f.authority.run(f.context, { siloId: "silo-1", operationId: _OPERATION_ID })).rejects.toBeInstanceOf(WorkflowTaskRetryableError);
		expect(f.events).toEqual([expect.objectContaining({ event: PersonalMemoryOperationEvents.OperationBlocked, failureCode: PersonalMemoryOperationFailureCodes.AuthorityEnded })]);
		expect(f.gateway.ensureDataset).not.toHaveBeenCalled();
		expect(f.operation.phase).toBe(PersonalMemoryOperationPhases.RecoveryRequired);
	});

	it("saves source drift before Add and never exposes the changed text to the gateway", async function _SourceDrift()
	{
		const f = _CreateHarness(_Record(PersonalMemoryOperationKinds.Correct));
		f.sources.read.mockResolvedValue({ source: _SOURCE, text: "changed", contentDigest: `sha256:${"f".repeat(64)}` });
		await expect(f.authority.run(f.context, { siloId: "silo-1", operationId: _OPERATION_ID })).rejects.toBeInstanceOf(WorkflowTaskRetryableError);
		expect(f.events[0]).toMatchObject({ event: PersonalMemoryOperationEvents.OperationBlocked, failureCode: PersonalMemoryOperationFailureCodes.SourceUnavailable });
		expect(f.gateway.addDocument).not.toHaveBeenCalled();
	});

	it.each(["actor", "authorization", "source", "list"] as const)("retries a failed pre-dispatch %s read without recording ambiguous delivery", async function _ReadFailure(owner)
	{
		const initial = owner === "source"
			? _Record(PersonalMemoryOperationKinds.Correct)
			: owner === "list"
				? { ..._Record(PersonalMemoryOperationKinds.Correct, PersonalMemoryOperationPhases.CognifyPending), documentId: _DOCUMENT_ID, indexingOperationId: _INDEXING_OPERATION_ID, expectedInputEvidenceDigest: _INPUT_DIGEST, revision: 3 }
				: _Record();
		const f = _CreateHarness(initial);
		if (owner === "actor")
			f.actors.resolve.mockRejectedValue(new Error("actor read failed"));
		if (owner === "authorization")
			f.authorization.allows.mockRejectedValue(new Error("authorization read failed"));
		if (owner === "source")
			f.sources.read.mockRejectedValue(new Error("source read failed"));
		if (owner === "list")
			f.gateway.listDocuments.mockRejectedValue(new Error("list read failed"));
		await expect(f.authority.run(f.context, { siloId: "silo-1", operationId: _OPERATION_ID })).rejects.toBeInstanceOf(WorkflowTaskRetryableError);
		expect(f.operations.apply).not.toHaveBeenCalled();
		expect(f.gateway.ensureDataset).not.toHaveBeenCalled();
		expect(f.gateway.addDocument).not.toHaveBeenCalled();
		expect(f.gateway.cognifyDataset).not.toHaveBeenCalled();
	});

	it("passes checkpoint claim cancellation through without a provider call or lifecycle write", async function _CheckpointCancelled()
	{
		const f = _CreateHarness();
		vi.mocked(f.context.checkpoint).mockRejectedValueOnce(new WorkflowTaskCancelledError(_TASK_ID));
		await expect(f.authority.run(f.context, { siloId: "silo-1", operationId: _OPERATION_ID })).rejects.toBeInstanceOf(WorkflowTaskCancelledError);
		expect(f.gateway.ensureDataset).not.toHaveBeenCalled();
		expect(f.operations.apply).not.toHaveBeenCalled();
	});

	it("retries an untyped checkpoint setup failure without recording provider delivery", async function _CheckpointUnavailable()
	{
		const f = _CreateHarness();
		vi.mocked(f.context.checkpoint).mockRejectedValueOnce(new Error("checkpoint setup failed"));
		await expect(f.authority.run(f.context, { siloId: "silo-1", operationId: _OPERATION_ID })).rejects.toBeInstanceOf(WorkflowTaskRetryableError);
		expect(f.gateway.ensureDataset).not.toHaveBeenCalled();
		expect(f.operations.apply).not.toHaveBeenCalled();
	});

	it("records ambiguous recovery when checkpoint persistence fails after the provider returns", async function _CheckpointSaveFailed()
	{
		const f = _CreateHarness();
		f.gateway.ensureDataset.mockImplementation(async function _Ensure(_context, request) { return { dataset: { datasetId: _PROVIDER_DATASET_ID, datasetName: request.datasetName } }; });
		vi.mocked(f.context.checkpoint).mockImplementationOnce(async function _FailAfterOperation(_step, operation)
		{
			await operation();
			throw new Error("checkpoint persistence failed");
		});
		await expect(f.authority.run(f.context, { siloId: "silo-1", operationId: _OPERATION_ID })).rejects.toBeInstanceOf(WorkflowTaskRetryableError);
		expect(f.gateway.ensureDataset).toHaveBeenCalledOnce();
		expect(f.events[0]).toMatchObject({ event: PersonalMemoryOperationEvents.MutationFailed, deliveryState: MemoryMutationDeliveryStates.Ambiguous });
		expect(f.operation.phase).toBe(PersonalMemoryOperationPhases.RecoveryRequired);
	});

	it("retries proven-not-sent mutation failure without advancing the saved revision", async function _ProvenNotSent()
	{
		const f = _CreateHarness();
		f.gateway.ensureDataset.mockRejectedValue(new MemoryGatewayMutationFailure(MemoryGatewayErrorCodes.ProviderUnavailable, MemoryMutationDeliveryStates.ProvenNotSent));
		await expect(f.authority.run(f.context, { siloId: "silo-1", operationId: _OPERATION_ID })).rejects.toBeInstanceOf(WorkflowTaskRetryableError);
		expect(f.events[0]).toMatchObject({ event: PersonalMemoryOperationEvents.MutationFailed, deliveryState: MemoryMutationDeliveryStates.ProvenNotSent });
		expect(f.operation.phase).toBe(PersonalMemoryOperationPhases.DatasetEnsurePending);
		expect(f.operation.revision).toBe(1);
	});

	it("records an unknown post-dispatch failure as ambiguous recovery", async function _Ambiguous()
	{
		const f = _CreateHarness();
		f.gateway.ensureDataset.mockRejectedValue(new Error("private provider detail"));
		await expect(f.authority.run(f.context, { siloId: "silo-1", operationId: _OPERATION_ID })).rejects.toBeInstanceOf(WorkflowTaskRetryableError);
		expect(f.events[0]).toMatchObject({ event: PersonalMemoryOperationEvents.MutationFailed, deliveryState: MemoryMutationDeliveryStates.Ambiguous });
		expect(f.operation).toMatchObject({ phase: PersonalMemoryOperationPhases.RecoveryRequired, recoveryPhase: PersonalMemoryOperationPhases.DatasetEnsurePending });
	});

	it("treats malformed cached checkpoint JSON as terminal corruption", async function _CachedInvalid()
	{
		const f = _CreateHarness();
		f.checkpoints.set("dataset-ensure", { dataset: { datasetId: _PROVIDER_DATASET_ID } });
		await expect(f.authority.run(f.context, { siloId: "silo-1", operationId: _OPERATION_ID })).rejects.toBeInstanceOf(WorkflowTaskTerminalError);
		expect(f.gateway.ensureDataset).not.toHaveBeenCalled();
		expect(f.operations.apply).not.toHaveBeenCalled();
	});

	it.each([
		[_Record(), "dataset-ensure", { dataset: { datasetId: _PROVIDER_DATASET_ID, datasetName: "wrong-name" } }, "ensureDataset"],
		[_Record(PersonalMemoryOperationKinds.Correct), "document-add", { datasetId: _OTHER_UUID, documentId: _DOCUMENT_ID, contentDigest: _CONTENT_DIGEST }, "addDocument"],
		[{ ..._Record(PersonalMemoryOperationKinds.Correct, PersonalMemoryOperationPhases.CognifyPending), documentId: _DOCUMENT_ID, indexingOperationId: _INDEXING_OPERATION_ID, expectedInputEvidenceDigest: _INPUT_DIGEST, revision: 3 }, `dataset-cognify:${_INDEXING_OPERATION_ID}`, { datasetId: _PROVIDER_DATASET_ID, operationId: _OTHER_UUID, inputEvidenceDigest: _INPUT_DIGEST, pipelineRunId: _PIPELINE_RUN_ID }, "cognifyDataset"],
		[_Record(PersonalMemoryOperationKinds.Forget), "document-delete", { datasetId: _PROVIDER_DATASET_ID, documentId: _OTHER_UUID }, "deleteDocument"],
	] as const)("rejects a valid cached receipt with wrong frozen coordinates for %s", async function _WrongCoordinates(initial, stepName, receipt, mutation)
	{
		const f = _CreateHarness(initial);
		f.checkpoints.set(stepName, receipt);
		await expect(f.authority.run(f.context, { siloId: "silo-1", operationId: _OPERATION_ID })).rejects.toBeInstanceOf(WorkflowTaskTerminalError);
		expect(f.gateway[mutation]).not.toHaveBeenCalled();
		expect(f.operations.apply).not.toHaveBeenCalled();
	});

	it("rejects malformed cached recovery evidence without appending another recovery event", async function _RecoveryCorruption()
	{
		const initial = { ..._Record(), phase: PersonalMemoryOperationPhases.RecoveryRequired, recoveryPhase: PersonalMemoryOperationPhases.DatasetEnsurePending, failureCode: PersonalMemoryOperationFailureCodes.DatasetUnavailable, deliveryState: MemoryMutationDeliveryStates.Ambiguous, revision: 2 };
		const f = _CreateHarness(initial);
		f.checkpoints.set("dataset-ensure", { dataset: { datasetId: _PROVIDER_DATASET_ID } });
		await expect(f.authority.run(f.context, { siloId: "silo-1", operationId: _OPERATION_ID })).rejects.toBeInstanceOf(WorkflowTaskTerminalError);
		expect(f.gateway.ensureDataset).not.toHaveBeenCalled();
		expect(f.operations.apply).not.toHaveBeenCalled();
	});

	it("rejects a mismatched cached delete receipt before a later authority loss can mask it", async function _DeleteCorruptionPrecedesAuthority()
	{
		const f = _CreateHarness(_Record(PersonalMemoryOperationKinds.Forget));
		f.checkpoints.set("document-delete", { datasetId: _PROVIDER_DATASET_ID, documentId: _OTHER_UUID });
		f.authorization.allows.mockResolvedValue(false);
		await expect(f.authority.run(f.context, { siloId: "silo-1", operationId: _OPERATION_ID })).rejects.toBeInstanceOf(WorkflowTaskTerminalError);
		expect(f.gateway.deleteDocument).not.toHaveBeenCalled();
		expect(f.operations.apply).not.toHaveBeenCalled();
	});

	it("does not append another failure event while saved recovery remains unavailable", async function _RecoveryWaits()
	{
		const initial = { ..._Record(), phase: PersonalMemoryOperationPhases.RecoveryRequired, recoveryPhase: PersonalMemoryOperationPhases.DatasetEnsurePending, failureCode: PersonalMemoryOperationFailureCodes.DatasetUnavailable, deliveryState: MemoryMutationDeliveryStates.Ambiguous, revision: 2 };
		const f = _CreateHarness(initial);
		f.gateway.ensureDataset.mockRejectedValue(new Error("still unavailable"));
		await expect(f.authority.run(f.context, { siloId: "silo-1", operationId: _OPERATION_ID })).rejects.toBeInstanceOf(WorkflowTaskRetryableError);
		expect(f.operations.apply).not.toHaveBeenCalled();
	});

	it("reloads a revision winner and performs no later mutation for stale state", async function _ConcurrentWinner()
	{
		const f = _CreateHarness();
		f.gateway.ensureDataset.mockImplementation(async function _Ensure(_context, request) { return { dataset: { datasetId: _PROVIDER_DATASET_ID, datasetName: request.datasetName } }; });
		const completed = { ..._Record(), phase: PersonalMemoryOperationPhases.Completed, providerDatasetId: _PROVIDER_DATASET_ID, documentId: _DOCUMENT_ID, indexingOperationId: _INDEXING_OPERATION_ID, expectedInputEvidenceDigest: _INPUT_DIGEST, pipelineRunId: _PIPELINE_RUN_ID, revision: 6, completedAt: new Date() };
		vi.mocked(f.operations.apply).mockResolvedValueOnce({ outcome: PersonalMemoryOperationPersistenceOutcomes.ConcurrentWinner, operation: completed });
		await expect(f.authority.run(f.context, { siloId: "silo-1", operationId: _OPERATION_ID })).resolves.toMatchObject({ outcome: PersonalMemoryOperationTaskOutcomes.Completed });
		expect(f.gateway.ensureDataset).toHaveBeenCalledOnce();
		expect(f.gateway.addDocument).not.toHaveBeenCalled();
	});

	it("blocks a changed Cognify input snapshot before dispatch", async function _InputChanged()
	{
		const initial = { ..._Record(PersonalMemoryOperationKinds.Correct, PersonalMemoryOperationPhases.CognifyPending), documentId: _DOCUMENT_ID, indexingOperationId: _INDEXING_OPERATION_ID, expectedInputEvidenceDigest: _INPUT_DIGEST, revision: 3 };
		const f = _CreateHarness(initial);
		f.gateway.listDocuments.mockResolvedValue({ datasetId: _PROVIDER_DATASET_ID, inputEvidenceDigest: `sha256:${"9".repeat(64)}`, documents: [{ documentId: _DOCUMENT_ID, contentDigest: _CONTENT_DIGEST }] });
		await expect(f.authority.run(f.context, { siloId: "silo-1", operationId: _OPERATION_ID })).rejects.toBeInstanceOf(WorkflowTaskRetryableError);
		expect(f.events[0]).toMatchObject({ event: PersonalMemoryOperationEvents.OperationBlocked, failureCode: PersonalMemoryOperationFailureCodes.IndexInputChanged });
		expect(f.gateway.cognifyDataset).not.toHaveBeenCalled();
	});

	it("reads Cognify input before the checkpoint renews authority for one mutation", async function _CognifyOrder()
	{
		const initial = { ..._Record(PersonalMemoryOperationKinds.Correct, PersonalMemoryOperationPhases.CognifyPending), documentId: _DOCUMENT_ID, indexingOperationId: _INDEXING_OPERATION_ID, expectedInputEvidenceDigest: _INPUT_DIGEST, revision: 3 };
		const f = _CreateHarness(initial);
		await expect(f.authority.run(f.context, { siloId: "silo-1", operationId: _OPERATION_ID })).resolves.toMatchObject({ outcome: PersonalMemoryOperationTaskOutcomes.Completed });
		const listOrder = f.gateway.listDocuments.mock.invocationCallOrder[0]!;
		const checkpointOrder = vi.mocked(f.context.checkpoint).mock.invocationCallOrder[0]!;
		const renewedAuthorizationOrder = f.authorization.allows.mock.invocationCallOrder[1]!;
		const cognifyOrder = f.gateway.cognifyDataset.mock.invocationCallOrder[0]!;
		expect(listOrder).toBeLessThan(checkpointOrder);
		expect(checkpointOrder).toBeLessThan(renewedAuthorizationOrder);
		expect(renewedAuthorizationOrder).toBeLessThan(cognifyOrder);
		expect(f.gateway.cognifyDataset).toHaveBeenCalledOnce();
	});

	it("does not call Cognify when checkpoint claim renewal rejects after the pre-read", async function _CognifyClaimLost()
	{
		const initial = { ..._Record(PersonalMemoryOperationKinds.Correct, PersonalMemoryOperationPhases.CognifyPending), documentId: _DOCUMENT_ID, indexingOperationId: _INDEXING_OPERATION_ID, expectedInputEvidenceDigest: _INPUT_DIGEST, revision: 3 };
		const f = _CreateHarness(initial);
		vi.mocked(f.context.checkpoint).mockRejectedValueOnce(new WorkflowTaskCancelledError(_TASK_ID));
		await expect(f.authority.run(f.context, { siloId: "silo-1", operationId: _OPERATION_ID })).rejects.toBeInstanceOf(WorkflowTaskCancelledError);
		expect(f.gateway.listDocuments).toHaveBeenCalledOnce();
		expect(f.gateway.cognifyDataset).not.toHaveBeenCalled();
		expect(f.operations.apply).not.toHaveBeenCalled();
	});

	it("stops at atomic catalog authority loss without writing through the ordinary lifecycle owner", async function _CatalogAuthorityEnded()
	{
		const initial = { ..._Record(PersonalMemoryOperationKinds.Correct, PersonalMemoryOperationPhases.CatalogCommitPending), documentId: _DOCUMENT_ID, indexingOperationId: _INDEXING_OPERATION_ID, expectedInputEvidenceDigest: _INPUT_DIGEST, pipelineRunId: _PIPELINE_RUN_ID, revision: 5 };
		const f = _CreateHarness(initial);
		const recovery = { ...initial, phase: PersonalMemoryOperationPhases.RecoveryRequired, recoveryPhase: PersonalMemoryOperationPhases.CatalogCommitPending, failureCode: PersonalMemoryOperationFailureCodes.AuthorityEnded, revision: 6 };
		f.catalog.apply.mockResolvedValue({ outcome: PersonalMemoryOperationAuthorizedCatalogApplyOutcomes.AuthorityEnded, persistence: { outcome: PersonalMemoryOperationPersistenceOutcomes.Advanced, operation: recovery } });
		await expect(f.authority.run(f.context, { siloId: "silo-1", operationId: _OPERATION_ID })).rejects.toBeInstanceOf(WorkflowTaskRetryableError);
		expect(f.catalog.apply).toHaveBeenCalledOnce();
		expect(f.operations.apply).not.toHaveBeenCalled();
	});

	it("stops on an atomically saved catalog conflict without using the ordinary lifecycle owner", async function _CatalogConflict()
	{
		const initial = { ..._Record(PersonalMemoryOperationKinds.Correct, PersonalMemoryOperationPhases.CatalogCommitPending), documentId: _DOCUMENT_ID, indexingOperationId: _INDEXING_OPERATION_ID, expectedInputEvidenceDigest: _INPUT_DIGEST, pipelineRunId: _PIPELINE_RUN_ID, revision: 5 };
		const f = _CreateHarness(initial);
		const recovery = { ...initial, phase: PersonalMemoryOperationPhases.RecoveryRequired, recoveryPhase: PersonalMemoryOperationPhases.CatalogCommitPending, failureCode: PersonalMemoryOperationFailureCodes.CatalogConflict, revision: 6 };
		f.catalog.apply.mockResolvedValue({ outcome: PersonalMemoryOperationAuthorizedCatalogApplyOutcomes.CatalogConflict, persistence: { outcome: PersonalMemoryOperationPersistenceOutcomes.Advanced, operation: recovery } });
		await expect(f.authority.run(f.context, { siloId: "silo-1", operationId: _OPERATION_ID })).rejects.toBeInstanceOf(WorkflowTaskRetryableError);
		expect(f.catalog.apply).toHaveBeenCalledOnce();
		expect(f.operations.apply).not.toHaveBeenCalled();
	});

	it("normalizes a replayed delete UUID but keeps the saved coordinate in the lifecycle event", async function _UuidCase()
	{
		const upper = _TARGET_DOCUMENT_ID.toUpperCase();
		const f = _CreateHarness({ ..._Record(PersonalMemoryOperationKinds.Forget), targetDocumentId: upper });
		f.gateway.deleteDocument.mockResolvedValue({ datasetId: _PROVIDER_DATASET_ID.toLowerCase(), documentId: upper.toLowerCase() });
		await expect(f.authority.run(f.context, { siloId: "silo-1", operationId: _OPERATION_ID })).resolves.toMatchObject({ outcome: PersonalMemoryOperationTaskOutcomes.Completed });
		expect(f.events[0]).toMatchObject({ event: PersonalMemoryOperationEvents.DocumentDeleted, documentId: upper });
	});
});
