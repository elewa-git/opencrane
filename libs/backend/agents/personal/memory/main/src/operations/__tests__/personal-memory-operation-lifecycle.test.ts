import { describe, expect, it } from "vitest";

import { MemoryMutationDeliveryStates } from "@opencrane/contracts";

import { __CreatePersonalMemoryOperationLifecycle, __PlanPersonalMemoryOperationLifecycle, _PersonalMemoryOperationLifecyclePolicy } from "../personal-memory-operation-lifecycle";
import { PersonalMemoryOperationEvents, PersonalMemoryOperationFailureCodes, PersonalMemoryOperationKinds, PersonalMemoryOperationPhases, PersonalMemoryOperationTransitionDenialReasons, PersonalMemoryOperationTransitionOutcomes, type PersonalMemoryOperationEvent, type PersonalMemoryOperationLifecycle } from "../personal-memory-operation.types";
import { ___CreatePersonalMemoryOperationLifecycleCommandSchema, ___PersonalMemoryOperationEventSchema, ___PersonalMemoryOperationLifecycleSchema } from "../personal-memory-operation.validator";

const _OPERATION_ID = "00000000-0000-4000-8000-000000000001";
const _DATASET_ID = "00000000-0000-4000-8000-000000000002";
const _DOCUMENT_ID = "00000000-0000-4000-8000-000000000003";
const _TARGET_DOCUMENT_ID = "00000000-0000-4000-8000-000000000004";
const _INDEXING_ID = "00000000-0000-4000-8000-000000000005";
const _PIPELINE_ID = "00000000-0000-4000-8000-000000000006";
const _CONTENT_DIGEST = `sha256:${"a".repeat(64)}`;
const _INPUT_DIGEST = `sha256:${"b".repeat(64)}`;

describe("personal-memory operation lifecycle", function _DescribeLifecycle()
{
	it("creates strategy-specific initial phases without content or provider secrets", function _CreateInitialStates()
	{
		const remember = _Create(PersonalMemoryOperationKinds.Remember);
		const correct = _Create(PersonalMemoryOperationKinds.Correct);
		const forget = _Create(PersonalMemoryOperationKinds.Forget);
		expect(remember).toMatchObject({ phase: PersonalMemoryOperationPhases.DatasetEnsurePending, providerDatasetId: null, expectedContentDigest: _CONTENT_DIGEST, targetFactId: null });
		expect(correct).toMatchObject({ phase: PersonalMemoryOperationPhases.DocumentAddPending, providerDatasetId: _DATASET_ID, expectedContentDigest: _CONTENT_DIGEST, targetFactId: "fact-1" });
		expect(forget).toMatchObject({ phase: PersonalMemoryOperationPhases.DocumentDeletePending, providerDatasetId: _DATASET_ID, expectedContentDigest: null, targetFactId: "fact-1" });
		expect(remember).not.toHaveProperty("content");
		expect(remember).not.toHaveProperty("credential");
	});

	it("advances Remember only through dataset, document, saved input evidence, indexing, and catalog", function _Remember()
	{
		let operation = _Create(PersonalMemoryOperationKinds.Remember);
		operation = _Advance(operation, { event: PersonalMemoryOperationEvents.DatasetEnsured, providerDatasetId: _DATASET_ID });
		operation = _Advance(operation, { event: PersonalMemoryOperationEvents.DocumentAdded, documentId: _DOCUMENT_ID, contentDigest: _CONTENT_DIGEST });
		expect(operation.phase).toBe(PersonalMemoryOperationPhases.CognifyPending);
		operation = _Advance(operation, { event: PersonalMemoryOperationEvents.IndexEvidenceSaved, indexingOperationId: _INDEXING_ID, expectedInputEvidenceDigest: _INPUT_DIGEST });
		operation = _Advance(operation, { event: PersonalMemoryOperationEvents.IndexingCompleted, indexingOperationId: _INDEXING_ID, expectedInputEvidenceDigest: _INPUT_DIGEST, pipelineRunId: _PIPELINE_ID });
		operation = _Advance(operation, { event: PersonalMemoryOperationEvents.CatalogCommitted });
		expect(operation).toMatchObject({ phase: PersonalMemoryOperationPhases.Completed, revision: 6, providerDatasetId: _DATASET_ID, documentId: _DOCUMENT_ID, indexingOperationId: _INDEXING_ID, expectedInputEvidenceDigest: _INPUT_DIGEST, pipelineRunId: _PIPELINE_ID });
	});

	it("keeps correction cleanup after catalog adoption and forgetting finalization after deletion", function _CorrectionAndForget()
	{
		let correction = _Create(PersonalMemoryOperationKinds.Correct);
		correction = _Advance(correction, { event: PersonalMemoryOperationEvents.DocumentAdded, documentId: _DOCUMENT_ID, contentDigest: _CONTENT_DIGEST });
		correction = _Advance(correction, { event: PersonalMemoryOperationEvents.IndexEvidenceSaved, indexingOperationId: _INDEXING_ID, expectedInputEvidenceDigest: _INPUT_DIGEST });
		correction = _Advance(correction, { event: PersonalMemoryOperationEvents.IndexingCompleted, indexingOperationId: _INDEXING_ID, expectedInputEvidenceDigest: _INPUT_DIGEST, pipelineRunId: _PIPELINE_ID });
		correction = _Advance(correction, { event: PersonalMemoryOperationEvents.CatalogCommitted });
		expect(correction.phase).toBe(PersonalMemoryOperationPhases.PriorDocumentDeletePending);
		correction = _Advance(correction, { event: PersonalMemoryOperationEvents.PriorDocumentDeleted, documentId: _TARGET_DOCUMENT_ID });
		expect(correction.phase).toBe(PersonalMemoryOperationPhases.Completed);

		let forget = _Create(PersonalMemoryOperationKinds.Forget);
		forget = _Advance(forget, { event: PersonalMemoryOperationEvents.DocumentDeleted, documentId: _TARGET_DOCUMENT_ID });
		expect(forget.phase).toBe(PersonalMemoryOperationPhases.CatalogFinalizePending);
		forget = _Advance(forget, { event: PersonalMemoryOperationEvents.CatalogFinalized });
		expect(forget.phase).toBe(PersonalMemoryOperationPhases.Completed);
	});

	it("retries only proven-not-sent mutations and freezes ambiguous effects for evidence recovery", function _DeliveryEvidence()
	{
		const operation = _Create(PersonalMemoryOperationKinds.Remember);
		const retry = __PlanPersonalMemoryOperationLifecycle(operation, _Event(operation, { event: PersonalMemoryOperationEvents.MutationFailed, failureCode: PersonalMemoryOperationFailureCodes.DatasetUnavailable, deliveryState: MemoryMutationDeliveryStates.ProvenNotSent }));
		expect(retry).toEqual({ outcome: PersonalMemoryOperationTransitionOutcomes.Retry, operation });
		const ambiguous = __PlanPersonalMemoryOperationLifecycle(operation, _Event(operation, { event: PersonalMemoryOperationEvents.MutationFailed, failureCode: PersonalMemoryOperationFailureCodes.DatasetUnavailable, deliveryState: MemoryMutationDeliveryStates.Ambiguous }));
		expect(ambiguous).toMatchObject({ outcome: PersonalMemoryOperationTransitionOutcomes.Advanced, operation: { phase: PersonalMemoryOperationPhases.RecoveryRequired, recoveryPhase: PersonalMemoryOperationPhases.DatasetEnsurePending, failureCode: PersonalMemoryOperationFailureCodes.DatasetUnavailable, deliveryState: MemoryMutationDeliveryStates.Ambiguous, revision: 2 } });
		const recovered = _Advance(ambiguous.operation!, { event: PersonalMemoryOperationEvents.DatasetEnsured, providerDatasetId: _DATASET_ID });
		expect(recovered).toMatchObject({ phase: PersonalMemoryOperationPhases.DocumentAddPending, recoveryPhase: null, failureCode: null, deliveryState: null });
	});

	it("denies stale, foreign, unknown, and conflicting evidence without returning a state", function _DenyInvalidEvents()
	{
		const operation = _Create(PersonalMemoryOperationKinds.Remember);
		const stale = __PlanPersonalMemoryOperationLifecycle(operation, { ..._Event(operation, { event: PersonalMemoryOperationEvents.DatasetEnsured, providerDatasetId: _DATASET_ID }), expectedRevision: 2 });
		expect(stale).toEqual({ outcome: PersonalMemoryOperationTransitionOutcomes.Denied, reason: PersonalMemoryOperationTransitionDenialReasons.StaleRevision });
		const foreign = __PlanPersonalMemoryOperationLifecycle(operation, { ..._Event(operation, { event: PersonalMemoryOperationEvents.DatasetEnsured, providerDatasetId: _DATASET_ID }), operationId: "00000000-0000-4000-8000-000000000099" });
		expect(foreign).toEqual({ outcome: PersonalMemoryOperationTransitionOutcomes.Denied, reason: PersonalMemoryOperationTransitionDenialReasons.WrongOperation });
		const unknown = __PlanPersonalMemoryOperationLifecycle(operation, { ..._Event(operation, { event: PersonalMemoryOperationEvents.DatasetEnsured, providerDatasetId: _DATASET_ID }), event: "other", token: "secret" } as unknown as PersonalMemoryOperationEvent);
		expect(unknown).toEqual({ outcome: PersonalMemoryOperationTransitionOutcomes.Denied, reason: PersonalMemoryOperationTransitionDenialReasons.InvalidInput });
		const documentPhase = _Advance(operation, { event: PersonalMemoryOperationEvents.DatasetEnsured, providerDatasetId: _DATASET_ID });
		const wrongDigest = __PlanPersonalMemoryOperationLifecycle(documentPhase, _Event(documentPhase, { event: PersonalMemoryOperationEvents.DocumentAdded, documentId: _DOCUMENT_ID, contentDigest: `sha256:${"c".repeat(64)}` }));
		expect(wrongDigest).toEqual({ outcome: PersonalMemoryOperationTransitionOutcomes.Denied, reason: PersonalMemoryOperationTransitionDenialReasons.ConflictingEvidence });
		const wrongFailure = __PlanPersonalMemoryOperationLifecycle(documentPhase, _Event(documentPhase, { event: PersonalMemoryOperationEvents.MutationFailed, failureCode: PersonalMemoryOperationFailureCodes.DeletionUnavailable, deliveryState: MemoryMutationDeliveryStates.Ambiguous }));
		expect(wrongFailure).toEqual({ outcome: PersonalMemoryOperationTransitionOutcomes.Denied, reason: PersonalMemoryOperationTransitionDenialReasons.ConflictingEvidence });
	});

	it("binds indexing completion to the saved operation UUID and complete input digest", function _IndexEvidence()
	{
		let operation = _Create(PersonalMemoryOperationKinds.Correct);
		operation = _Advance(operation, { event: PersonalMemoryOperationEvents.DocumentAdded, documentId: _DOCUMENT_ID, contentDigest: _CONTENT_DIGEST });
		operation = _Advance(operation, { event: PersonalMemoryOperationEvents.IndexEvidenceSaved, indexingOperationId: _INDEXING_ID, expectedInputEvidenceDigest: _INPUT_DIGEST });
		const wrong = __PlanPersonalMemoryOperationLifecycle(operation, _Event(operation, { event: PersonalMemoryOperationEvents.IndexingCompleted, indexingOperationId: "00000000-0000-4000-8000-000000000099", expectedInputEvidenceDigest: _INPUT_DIGEST, pipelineRunId: _PIPELINE_ID }));
		expect(wrong).toEqual({ outcome: PersonalMemoryOperationTransitionOutcomes.Denied, reason: PersonalMemoryOperationTransitionDenialReasons.ConflictingEvidence });
		expect(operation.pipelineRunId).toBeNull();
	});

	it("requires positive recovery evidence and never resends an already ambiguous mutation", function _RecoveryEvidence()
	{
		let forget = _Create(PersonalMemoryOperationKinds.Forget);
		const ambiguous = __PlanPersonalMemoryOperationLifecycle(forget, _Event(forget, { event: PersonalMemoryOperationEvents.MutationFailed, failureCode: PersonalMemoryOperationFailureCodes.DeletionUnavailable, deliveryState: MemoryMutationDeliveryStates.Ambiguous }));
		expect(ambiguous).toMatchObject({ outcome: PersonalMemoryOperationTransitionOutcomes.Advanced, operation: { phase: PersonalMemoryOperationPhases.RecoveryRequired, recoveryPhase: PersonalMemoryOperationPhases.DocumentDeletePending } });
		forget = ambiguous.operation!;
		const resend = __PlanPersonalMemoryOperationLifecycle(forget, _Event(forget, { event: PersonalMemoryOperationEvents.MutationFailed, failureCode: PersonalMemoryOperationFailureCodes.DeletionUnavailable, deliveryState: MemoryMutationDeliveryStates.ProvenNotSent }));
		expect(resend).toEqual({ outcome: PersonalMemoryOperationTransitionOutcomes.Denied, reason: PersonalMemoryOperationTransitionDenialReasons.InvalidTransition });
		forget = _Advance(forget, { event: PersonalMemoryOperationEvents.DocumentDeleted, documentId: _TARGET_DOCUMENT_ID });
		expect(forget).toMatchObject({ phase: PersonalMemoryOperationPhases.CatalogFinalizePending, recoveryPhase: null, failureCode: null, deliveryState: null });
	});

	it("defines a cell for every command, phase, and event", function _ExhaustivePolicy()
	{
		const policy = _PersonalMemoryOperationLifecyclePolicy();
		for (const kind of Object.values(PersonalMemoryOperationKinds))
		{
			expect(Object.keys(policy[kind]).sort()).toEqual([...Object.values(PersonalMemoryOperationPhases)].sort());
			for (const phase of Object.values(PersonalMemoryOperationPhases))
				expect(Object.keys(policy[kind][phase]).sort()).toEqual([...Object.values(PersonalMemoryOperationEvents)].sort());
		}
	});

	it("validators reject missing strategy evidence, inconsistent recovery, and extra secret fields", function _Validation()
	{
		expect(___CreatePersonalMemoryOperationLifecycleCommandSchema.safeParse({ operationId: _OPERATION_ID, kind: PersonalMemoryOperationKinds.Forget, expectedContentDigest: _CONTENT_DIGEST, targetFactId: "fact-1", targetDocumentId: _TARGET_DOCUMENT_ID, providerDatasetId: _DATASET_ID }).success).toBe(false);
		const operation = _Create(PersonalMemoryOperationKinds.Remember);
		expect(___PersonalMemoryOperationLifecycleSchema.safeParse({ ...operation, phase: PersonalMemoryOperationPhases.RecoveryRequired, recoveryPhase: null, failureCode: PersonalMemoryOperationFailureCodes.SourceUnavailable }).success).toBe(false);
		expect(___PersonalMemoryOperationEventSchema.safeParse({ ..._Event(operation, { event: PersonalMemoryOperationEvents.DatasetEnsured, providerDatasetId: _DATASET_ID }), bearerToken: "secret" }).success).toBe(false);
	});

	it("rejects state evidence that the lifecycle planner can never save", function _RejectImpossibleSavedStates()
	{
		const remember = _Create(PersonalMemoryOperationKinds.Remember);
		expect(___PersonalMemoryOperationLifecycleSchema.safeParse({ ...remember, failureCode: PersonalMemoryOperationFailureCodes.AuthorityEnded }).success).toBe(false);
		expect(___PersonalMemoryOperationLifecycleSchema.safeParse({ ...remember, recoveryPhase: PersonalMemoryOperationPhases.DocumentAddPending }).success).toBe(false);

		const ambiguous = __PlanPersonalMemoryOperationLifecycle(remember, _Event(remember, { event: PersonalMemoryOperationEvents.MutationFailed, failureCode: PersonalMemoryOperationFailureCodes.DatasetUnavailable, deliveryState: MemoryMutationDeliveryStates.Ambiguous }));
		expect(ambiguous.outcome).toBe(PersonalMemoryOperationTransitionOutcomes.Advanced);
		expect(___PersonalMemoryOperationLifecycleSchema.safeParse({ ...ambiguous.operation!, deliveryState: MemoryMutationDeliveryStates.ProvenNotSent }).success).toBe(false);
		expect(___PersonalMemoryOperationLifecycleSchema.safeParse({ ...ambiguous.operation!, failureCode: PersonalMemoryOperationFailureCodes.DeletionUnavailable }).success).toBe(false);

		const forget = _Create(PersonalMemoryOperationKinds.Forget);
		expect(___PersonalMemoryOperationLifecycleSchema.safeParse({ ...forget, phase: PersonalMemoryOperationPhases.CatalogCommitPending }).success).toBe(false);
		expect(___PersonalMemoryOperationLifecycleSchema.safeParse({ ...forget, phase: PersonalMemoryOperationPhases.RecoveryRequired, recoveryPhase: PersonalMemoryOperationPhases.DocumentAddPending, failureCode: PersonalMemoryOperationFailureCodes.DocumentConflict, deliveryState: MemoryMutationDeliveryStates.Ambiguous }).success).toBe(false);
	});
});

function _Create(kind: PersonalMemoryOperationKinds): PersonalMemoryOperationLifecycle
{
	let expectedContentDigest: string | null = _CONTENT_DIGEST;
	let targetFactId: string | null = "fact-1";
	let targetDocumentId: string | null = _TARGET_DOCUMENT_ID;
	let providerDatasetId: string | null = _DATASET_ID;
	if (kind === PersonalMemoryOperationKinds.Remember)
	{
		targetFactId = null;
		targetDocumentId = null;
		providerDatasetId = null;
	}
	else if (kind === PersonalMemoryOperationKinds.Forget)
		expectedContentDigest = null;
	const operation = __CreatePersonalMemoryOperationLifecycle({ operationId: _OPERATION_ID, kind, expectedContentDigest, targetFactId, targetDocumentId, providerDatasetId });
	expect(operation).not.toBeNull();
	return operation!;
}

function _Event<TEvent extends Omit<PersonalMemoryOperationEvent, "operationId" | "kind" | "expectedRevision">>(operation: PersonalMemoryOperationLifecycle, event: TEvent): PersonalMemoryOperationEvent
{
	return { operationId: operation.operationId, kind: operation.kind, expectedRevision: operation.revision, ...event } as PersonalMemoryOperationEvent;
}

function _Advance<TEvent extends Omit<PersonalMemoryOperationEvent, "operationId" | "kind" | "expectedRevision">>(operation: PersonalMemoryOperationLifecycle, event: TEvent): PersonalMemoryOperationLifecycle
{
	const result = __PlanPersonalMemoryOperationLifecycle(operation, _Event(operation, event));
	expect(result.outcome).toBe(PersonalMemoryOperationTransitionOutcomes.Advanced);
	return result.operation!;
}
