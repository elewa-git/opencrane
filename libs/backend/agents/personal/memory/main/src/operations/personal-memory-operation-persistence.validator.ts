import { z } from "zod";

import { MemoryMutationDeliveryStates } from "@opencrane/contracts";

import { PersonalMemoryOperationKinds, PersonalMemoryOperationPhases, PersonalMemoryOperationFailureCodes, type PersonalMemoryOperationLifecycle } from "./personal-memory-operation.types";
import { ___PersonalMemoryOperationLifecycleSchema } from "./personal-memory-operation.validator";
import type { AdmitPersonalMemoryOperationCommand, PersonalMemoryOperationRecord, PersonalMemoryOperationTaskCoordinates, PersonalMemoryOperationTaskIdentity } from "./personal-memory-operation-persistence.types";

const _Identifier = z.string().trim().min(1).max(128);
const _Uuid = z.string().uuid();
const _Digest = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const _Revision = z.number().int().positive();
const _Timestamp = z.date().refine(function _IsValid(value) { return !Number.isNaN(value.getTime()); });
const _MessageSource = z.object({
	conversationId: _Identifier,
	messageId: _Identifier,
	messagePosition: z.bigint().nonnegative(),
	payloadRef: _Identifier,
	ciphertextDigest: _Digest,
	authorPrincipalId: _Identifier,
}).strict();
/** Validates the immutable task coordinates supplied before workflow admission. */
export const ___PersonalMemoryOperationTaskCoordinatesSchema: z.ZodType<PersonalMemoryOperationTaskCoordinates> = z.object({ taskName: _Identifier, taskKey: _Identifier }).strict();

/** Validates the actual workflow receipt before it can be saved with an operation. */
export const ___PersonalMemoryOperationTaskIdentitySchema: z.ZodType<PersonalMemoryOperationTaskIdentity> = z.object({ taskId: _Uuid, taskName: _Identifier, taskKey: _Identifier }).strict();

/** Validates the silo-scoped replay lookup performed before composite admission. */
export const ___PersonalMemoryOperationReplayLookupSchema = z.object({ siloId: _Identifier, idempotencyKeyDigest: _Digest }).strict();

/** Validates secret-free admission evidence before any lock or database write occurs. */
export const ___AdmitPersonalMemoryOperationCommandSchema: z.ZodType<AdmitPersonalMemoryOperationCommand> = z.object({
	operationId: _Uuid,
	siloId: _Identifier,
	datasetId: _Identifier,
	actorPrincipalId: _Identifier,
	idempotencyKeyDigest: _Digest,
	commandDigest: _Digest,
	kind: z.nativeEnum(PersonalMemoryOperationKinds),
	source: _MessageSource.nullable(),
	contentDigest: _Digest.nullable(),
	targetFactId: _Identifier.nullable(),
	targetDocumentId: _Uuid.nullable(),
	expectedFactRevision: _Revision.nullable(),
	providerDatasetId: _Uuid.nullable(),
	task: ___PersonalMemoryOperationTaskCoordinatesSchema,
	admittedAt: _Timestamp,
}).strict().superRefine(function _CommandShape(command, context)
{
	const remembers = command.kind === PersonalMemoryOperationKinds.Remember;
	const forgets = command.kind === PersonalMemoryOperationKinds.Forget;
	if (forgets !== (command.source === null && command.contentDigest === null))
		context.addIssue({ code: "custom", message: "operation source does not match command kind" });
	if (!forgets && (command.source === null || command.contentDigest === null))
		context.addIssue({ code: "custom", message: "Remember and Correct require encrypted source evidence" });
	if (remembers !== (command.targetFactId === null && command.targetDocumentId === null && command.expectedFactRevision === null))
		context.addIssue({ code: "custom", message: "operation target does not match command kind" });
	if (!remembers && (command.targetFactId === null || command.targetDocumentId === null || command.expectedFactRevision === null))
		context.addIssue({ code: "custom", message: "Correct and Forget require complete target evidence" });
	if (!remembers && command.providerDatasetId === null)
		context.addIssue({ code: "custom", message: "existing-fact commands require an adopted provider dataset" });
	if (command.source !== null && command.source.authorPrincipalId !== command.actorPrincipalId)
		context.addIssue({ code: "custom", message: "operation source author must be the authenticated actor" });
});

/** Validates every persisted field plus the reviewed lifecycle invariants before a row is returned. */
export const ___PersonalMemoryOperationRecordSchema: z.ZodType<PersonalMemoryOperationRecord> = z.object({
	operationId: _Uuid,
	siloId: _Identifier,
	datasetId: _Identifier,
	actorPrincipalId: _Identifier,
	idempotencyKeyDigest: _Digest,
	commandDigest: _Digest,
	kind: z.nativeEnum(PersonalMemoryOperationKinds),
	phase: z.nativeEnum(PersonalMemoryOperationPhases),
	revision: _Revision,
	recoveryPhase: z.nativeEnum(PersonalMemoryOperationPhases).nullable(),
	expectedContentDigest: _Digest.nullable(),
	targetFactId: _Identifier.nullable(),
	targetDocumentId: _Uuid.nullable(),
	providerDatasetId: _Uuid.nullable(),
	documentId: _Uuid.nullable(),
	indexingOperationId: _Uuid.nullable(),
	expectedInputEvidenceDigest: _Digest.nullable(),
	pipelineRunId: _Uuid.nullable(),
	failureCode: z.nativeEnum(PersonalMemoryOperationFailureCodes).nullable(),
	deliveryState: z.nativeEnum(MemoryMutationDeliveryStates).nullable(),
	source: _MessageSource.nullable(),
	expectedFactRevision: _Revision.nullable(),
	admittedProviderDatasetId: _Uuid.nullable(),
	task: ___PersonalMemoryOperationTaskIdentitySchema,
	admittedAt: _Timestamp,
	recoveryRecordedAt: _Timestamp.nullable(),
	completedAt: _Timestamp.nullable(),
}).strict().superRefine(function _RecordShape(record, context)
{
	const lifecycle: PersonalMemoryOperationLifecycle = {
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
	if (!___PersonalMemoryOperationLifecycleSchema.safeParse(lifecycle).success)
		context.addIssue({ code: "custom", message: "saved lifecycle evidence is invalid" });
	const forgets = record.kind === PersonalMemoryOperationKinds.Forget;
	if (forgets !== (record.source === null && record.expectedContentDigest === null))
		context.addIssue({ code: "custom", message: "saved source does not match command kind" });
	if (!forgets && (record.source === null || record.expectedContentDigest === null))
		context.addIssue({ code: "custom", message: "saved operation requires encrypted source evidence" });
	const remembers = record.kind === PersonalMemoryOperationKinds.Remember;
	if (remembers !== (record.targetFactId === null && record.targetDocumentId === null && record.expectedFactRevision === null))
		context.addIssue({ code: "custom", message: "saved target does not match command kind" });
	if (!remembers && (record.targetFactId === null || record.targetDocumentId === null || record.expectedFactRevision === null))
		context.addIssue({ code: "custom", message: "saved operation requires complete target evidence" });
	if (!remembers && record.admittedProviderDatasetId === null)
		context.addIssue({ code: "custom", message: "existing-fact operation lacks its admitted provider dataset" });
	if (record.admittedProviderDatasetId !== null && record.providerDatasetId !== record.admittedProviderDatasetId)
		context.addIssue({ code: "custom", message: "operation changed its admitted provider dataset" });
	if (record.source !== null && record.source.authorPrincipalId !== record.actorPrincipalId)
		context.addIssue({ code: "custom", message: "saved source author does not match the admitted actor" });
	const recovery = record.phase === PersonalMemoryOperationPhases.RecoveryRequired;
	if (recovery !== (record.recoveryRecordedAt !== null))
		context.addIssue({ code: "custom", message: "recovery timestamp does not match operation phase" });
	const completed = record.phase === PersonalMemoryOperationPhases.Completed;
	if (completed !== (record.completedAt !== null))
		context.addIssue({ code: "custom", message: "completion timestamp does not match operation phase" });
});
