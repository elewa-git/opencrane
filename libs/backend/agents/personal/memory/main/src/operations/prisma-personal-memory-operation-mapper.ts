import { MemoryMutationDeliveryStates } from "@opencrane/contracts";

import { ___PersonalMemoryOperationRecordSchema } from "./personal-memory-operation-persistence.validator";
import { PersonalMemoryOperationInvalidState, type AdmitPersonalMemoryOperationCommand, type PersonalMemoryOperationMessageSource, type PersonalMemoryOperationRecord } from "./personal-memory-operation-persistence.types";
import { PersonalMemoryOperationFailureCodes, PersonalMemoryOperationKinds, PersonalMemoryOperationPhases, type PersonalMemoryOperationLifecycle } from "./personal-memory-operation.types";

/** Prisma command values accepted from the generated operation row. */
type _PrismaKind = "Remember" | "Correct" | "Forget";

/** Prisma phase values accepted from the generated operation row. */
type _PrismaPhase = "DatasetEnsurePending" | "DocumentAddPending" | "CognifyPending" | "CatalogCommitPending" | "PriorDocumentDeletePending" | "DocumentDeletePending" | "CatalogFinalizePending" | "RecoveryRequired" | "Completed";

/** Prisma failure values accepted from the generated operation row. */
type _PrismaFailureCode = "AuthorityEnded" | "DatasetUnavailable" | "SourceUnavailable" | "DocumentConflict" | "IndexInputChanged" | "IndexingUnavailable" | "CatalogConflict" | "DeletionUnavailable";

/** Prisma delivery values accepted from the generated operation row. */
type _PrismaDeliveryState = "ProvenNotSent" | "Ambiguous";

/** Structural operation row kept free of Prisma imports outside the authoritative repository. */
interface _PrismaOperationRow
{
	readonly id: string;
	readonly siloId: string;
	readonly datasetId: string;
	readonly actorPrincipalId: string;
	readonly idempotencyKeyDigest: string;
	readonly commandDigest: string;
	readonly kind: _PrismaKind;
	readonly phase: _PrismaPhase;
	readonly recoveryPhase: _PrismaPhase | null;
	readonly revision: number;
	readonly sourceConversationId: string | null;
	readonly sourceMessageId: string | null;
	readonly sourceMessagePosition: bigint | null;
	readonly sourcePayloadRef: string | null;
	readonly sourceCiphertextDigest: string | null;
	readonly sourceAuthorPrincipalId: string | null;
	readonly contentDigest: string | null;
	readonly targetFactId: string | null;
	readonly targetDocumentId: string | null;
	readonly expectedFactRevision: number | null;
	readonly admittedProviderDatasetId: string | null;
	readonly providerDatasetId: string | null;
	readonly providerDocumentId: string | null;
	readonly indexingOperationId: string | null;
	readonly expectedInputEvidenceDigest: string | null;
	readonly pipelineRunId: string | null;
	readonly failureCode: _PrismaFailureCode | null;
	readonly deliveryState: _PrismaDeliveryState | null;
	readonly workflowTaskId: string;
	readonly workflowTaskName: string;
	readonly workflowTaskKey: string;
	readonly admittedAt: Date;
	readonly recoveryRecordedAt: Date | null;
	readonly completedAt: Date | null;
}

/** Maps stored Prisma command kinds to the reviewed lifecycle vocabulary. */
const _KIND_FROM_PRISMA: Readonly<Record<_PrismaKind, PersonalMemoryOperationKinds>> = {
	Remember: PersonalMemoryOperationKinds.Remember,
	Correct: PersonalMemoryOperationKinds.Correct,
	Forget: PersonalMemoryOperationKinds.Forget,
};

/** Maps reviewed lifecycle command kinds to their Prisma values. */
const _KIND_TO_PRISMA: Readonly<Record<PersonalMemoryOperationKinds, _PrismaKind>> = {
	[PersonalMemoryOperationKinds.Remember]: "Remember",
	[PersonalMemoryOperationKinds.Correct]: "Correct",
	[PersonalMemoryOperationKinds.Forget]: "Forget",
};

/** Maps stored Prisma phases to the reviewed lifecycle vocabulary. */
const _PHASE_FROM_PRISMA: Readonly<Record<_PrismaPhase, PersonalMemoryOperationPhases>> = {
	DatasetEnsurePending: PersonalMemoryOperationPhases.DatasetEnsurePending,
	DocumentAddPending: PersonalMemoryOperationPhases.DocumentAddPending,
	CognifyPending: PersonalMemoryOperationPhases.CognifyPending,
	CatalogCommitPending: PersonalMemoryOperationPhases.CatalogCommitPending,
	PriorDocumentDeletePending: PersonalMemoryOperationPhases.PriorDocumentDeletePending,
	DocumentDeletePending: PersonalMemoryOperationPhases.DocumentDeletePending,
	CatalogFinalizePending: PersonalMemoryOperationPhases.CatalogFinalizePending,
	RecoveryRequired: PersonalMemoryOperationPhases.RecoveryRequired,
	Completed: PersonalMemoryOperationPhases.Completed,
};

/** Maps reviewed lifecycle phases to their Prisma values. */
const _PHASE_TO_PRISMA: Readonly<Record<PersonalMemoryOperationPhases, _PrismaPhase>> = {
	[PersonalMemoryOperationPhases.DatasetEnsurePending]: "DatasetEnsurePending",
	[PersonalMemoryOperationPhases.DocumentAddPending]: "DocumentAddPending",
	[PersonalMemoryOperationPhases.CognifyPending]: "CognifyPending",
	[PersonalMemoryOperationPhases.CatalogCommitPending]: "CatalogCommitPending",
	[PersonalMemoryOperationPhases.PriorDocumentDeletePending]: "PriorDocumentDeletePending",
	[PersonalMemoryOperationPhases.DocumentDeletePending]: "DocumentDeletePending",
	[PersonalMemoryOperationPhases.CatalogFinalizePending]: "CatalogFinalizePending",
	[PersonalMemoryOperationPhases.RecoveryRequired]: "RecoveryRequired",
	[PersonalMemoryOperationPhases.Completed]: "Completed",
};

/** Maps stored fixed failures to the reviewed lifecycle vocabulary. */
const _FAILURE_FROM_PRISMA: Readonly<Record<_PrismaFailureCode, PersonalMemoryOperationFailureCodes>> = {
	AuthorityEnded: PersonalMemoryOperationFailureCodes.AuthorityEnded,
	DatasetUnavailable: PersonalMemoryOperationFailureCodes.DatasetUnavailable,
	SourceUnavailable: PersonalMemoryOperationFailureCodes.SourceUnavailable,
	DocumentConflict: PersonalMemoryOperationFailureCodes.DocumentConflict,
	IndexInputChanged: PersonalMemoryOperationFailureCodes.IndexInputChanged,
	IndexingUnavailable: PersonalMemoryOperationFailureCodes.IndexingUnavailable,
	CatalogConflict: PersonalMemoryOperationFailureCodes.CatalogConflict,
	DeletionUnavailable: PersonalMemoryOperationFailureCodes.DeletionUnavailable,
};

/** Maps reviewed lifecycle failures to their Prisma values. */
const _FAILURE_TO_PRISMA: Readonly<Record<PersonalMemoryOperationFailureCodes, _PrismaFailureCode>> = {
	[PersonalMemoryOperationFailureCodes.AuthorityEnded]: "AuthorityEnded",
	[PersonalMemoryOperationFailureCodes.DatasetUnavailable]: "DatasetUnavailable",
	[PersonalMemoryOperationFailureCodes.SourceUnavailable]: "SourceUnavailable",
	[PersonalMemoryOperationFailureCodes.DocumentConflict]: "DocumentConflict",
	[PersonalMemoryOperationFailureCodes.IndexInputChanged]: "IndexInputChanged",
	[PersonalMemoryOperationFailureCodes.IndexingUnavailable]: "IndexingUnavailable",
	[PersonalMemoryOperationFailureCodes.CatalogConflict]: "CatalogConflict",
	[PersonalMemoryOperationFailureCodes.DeletionUnavailable]: "DeletionUnavailable",
};

/** Maps stored delivery evidence to the shared contract vocabulary. */
const _DELIVERY_FROM_PRISMA: Readonly<Record<_PrismaDeliveryState, MemoryMutationDeliveryStates>> = {
	ProvenNotSent: MemoryMutationDeliveryStates.ProvenNotSent,
	Ambiguous: MemoryMutationDeliveryStates.Ambiguous,
};

/** Maps shared delivery evidence to its Prisma values. */
const _DELIVERY_TO_PRISMA: Readonly<Record<MemoryMutationDeliveryStates, _PrismaDeliveryState>> = {
	[MemoryMutationDeliveryStates.ProvenNotSent]: "ProvenNotSent",
	[MemoryMutationDeliveryStates.Ambiguous]: "Ambiguous",
};

/** Converts one Prisma row and rejects impossible lifecycle or persistence evidence. */
export function _PersonalMemoryOperationRecord(row: _PrismaOperationRow): PersonalMemoryOperationRecord
{
	const source = _SourceFromRow(row);
	const candidate: PersonalMemoryOperationRecord = {
		operationId: row.id,
		siloId: row.siloId,
		datasetId: row.datasetId,
		actorPrincipalId: row.actorPrincipalId,
		idempotencyKeyDigest: row.idempotencyKeyDigest,
		commandDigest: row.commandDigest,
		kind: _KIND_FROM_PRISMA[row.kind],
		phase: _PHASE_FROM_PRISMA[row.phase],
		revision: row.revision,
		recoveryPhase: row.recoveryPhase === null ? null : _PHASE_FROM_PRISMA[row.recoveryPhase],
		expectedContentDigest: row.contentDigest,
		targetFactId: row.targetFactId,
		targetDocumentId: row.targetDocumentId,
		providerDatasetId: row.providerDatasetId,
		documentId: row.providerDocumentId,
		indexingOperationId: row.indexingOperationId,
		expectedInputEvidenceDigest: row.expectedInputEvidenceDigest,
		pipelineRunId: row.pipelineRunId,
		failureCode: row.failureCode === null ? null : _FAILURE_FROM_PRISMA[row.failureCode],
		deliveryState: row.deliveryState === null ? null : _DELIVERY_FROM_PRISMA[row.deliveryState],
		source,
		expectedFactRevision: row.expectedFactRevision,
		admittedProviderDatasetId: row.admittedProviderDatasetId,
		task: { taskId: row.workflowTaskId, taskName: row.workflowTaskName, taskKey: row.workflowTaskKey },
		admittedAt: row.admittedAt,
		recoveryRecordedAt: row.recoveryRecordedAt,
		completedAt: row.completedAt,
	};
	const parsed = ___PersonalMemoryOperationRecordSchema.safeParse(candidate);
	if (!parsed.success)
		throw new PersonalMemoryOperationInvalidState("saved personal-memory operation evidence is invalid");
	return parsed.data;
}

/** Projects a validated persistence record to the exact strict lifecycle planner shape. */
export function _PersonalMemoryOperationLifecycle(record: PersonalMemoryOperationRecord): PersonalMemoryOperationLifecycle
{
	return {
		operationId: record.operationId,
		kind: record.kind,
		phase: record.phase,
		revision: record.revision,
		recoveryPhase: record.recoveryPhase,
		expectedContentDigest: record.expectedContentDigest,
		targetFactId: record.targetFactId,
		targetDocumentId: record.targetDocumentId,
		providerDatasetId: record.providerDatasetId,
		documentId: record.documentId,
		indexingOperationId: record.indexingOperationId,
		expectedInputEvidenceDigest: record.expectedInputEvidenceDigest,
		pipelineRunId: record.pipelineRunId,
		failureCode: record.failureCode,
		deliveryState: record.deliveryState,
	};
}

/** Builds the Prisma insert from validated command and lifecycle evidence. */
export function _PersonalMemoryOperationCreateData(command: AdmitPersonalMemoryOperationCommand, lifecycle: PersonalMemoryOperationLifecycle)
{
	return {
		id: command.operationId,
		siloId: command.siloId,
		datasetId: command.datasetId,
		actorPrincipalId: command.actorPrincipalId,
		idempotencyKeyDigest: command.idempotencyKeyDigest,
		commandDigest: command.commandDigest,
		kind: _KIND_TO_PRISMA[command.kind],
		phase: _PHASE_TO_PRISMA[lifecycle.phase],
		revision: lifecycle.revision,
		sourceConversationId: command.source?.conversationId ?? null,
		sourceMessageId: command.source?.messageId ?? null,
		sourceMessagePosition: command.source?.messagePosition ?? null,
		sourcePayloadRef: command.source?.payloadRef ?? null,
		sourceCiphertextDigest: command.source?.ciphertextDigest ?? null,
		sourceAuthorPrincipalId: command.source?.authorPrincipalId ?? null,
		contentDigest: command.contentDigest,
		targetFactId: command.targetFactId,
		targetDocumentId: command.targetDocumentId,
		expectedFactRevision: command.expectedFactRevision,
		admittedProviderDatasetId: command.providerDatasetId,
		providerDatasetId: lifecycle.providerDatasetId,
		workflowTaskId: command.task.taskId,
		workflowTaskName: command.task.taskName,
		workflowTaskKey: command.task.taskKey,
		admittedAt: command.admittedAt,
	};
}

/** Maps an accepted lifecycle state to one revision-fenced Prisma update. */
export function _PersonalMemoryOperationLifecycleUpdate(next: PersonalMemoryOperationLifecycle, recordedAt: Date)
{
	return {
		phase: _PHASE_TO_PRISMA[next.phase],
		recoveryPhase: next.recoveryPhase === null ? null : _PHASE_TO_PRISMA[next.recoveryPhase],
		revision: next.revision,
		providerDatasetId: next.providerDatasetId,
		providerDocumentId: next.documentId,
		indexingOperationId: next.indexingOperationId,
		expectedInputEvidenceDigest: next.expectedInputEvidenceDigest,
		pipelineRunId: next.pipelineRunId,
		failureCode: next.failureCode === null ? null : _FAILURE_TO_PRISMA[next.failureCode],
		deliveryState: next.deliveryState === null ? null : _DELIVERY_TO_PRISMA[next.deliveryState],
		recoveryRecordedAt: next.phase === PersonalMemoryOperationPhases.RecoveryRequired ? recordedAt : null,
		completedAt: next.phase === PersonalMemoryOperationPhases.Completed ? recordedAt : null,
	};
}

/** Rebuilds all-or-none encrypted source coordinates from a Prisma row. */
function _SourceFromRow(row: _PrismaOperationRow): PersonalMemoryOperationMessageSource | null
{
	const values = [row.sourceConversationId, row.sourceMessageId, row.sourceMessagePosition, row.sourcePayloadRef, row.sourceCiphertextDigest, row.sourceAuthorPrincipalId];
	if (values.every(value => value === null))
		return null;
	if (values.some(value => value === null))
		throw new PersonalMemoryOperationInvalidState("saved personal-memory source coordinates are incomplete");
	return { conversationId: row.sourceConversationId!, messageId: row.sourceMessageId!, messagePosition: row.sourceMessagePosition!, payloadRef: row.sourcePayloadRef!, ciphertextDigest: row.sourceCiphertextDigest!, authorPrincipalId: row.sourceAuthorPrincipalId! };
}
