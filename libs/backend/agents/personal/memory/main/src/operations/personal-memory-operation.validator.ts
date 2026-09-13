import { z } from "zod";

import { MemoryMutationDeliveryStates } from "@opencrane/contracts";

import { PersonalMemoryOperationEvents, PersonalMemoryOperationFailureCodes, PersonalMemoryOperationKinds, PersonalMemoryOperationPhases, type CreatePersonalMemoryOperationLifecycleCommand, type PersonalMemoryOperationEvent, type PersonalMemoryOperationLifecycle } from "./personal-memory-operation.types";

const _Identifier = z.string().trim().min(1).max(128);
const _Uuid = z.string().uuid();
const _Digest = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const _Revision = z.number().int().positive();

type _PhaseAllowance = Readonly<Record<PersonalMemoryOperationPhases, boolean>>;

const _REMEMBER_PHASES: _PhaseAllowance = {
	[PersonalMemoryOperationPhases.DatasetEnsurePending]: true,
	[PersonalMemoryOperationPhases.DocumentAddPending]: true,
	[PersonalMemoryOperationPhases.CognifyPending]: true,
	[PersonalMemoryOperationPhases.CatalogCommitPending]: true,
	[PersonalMemoryOperationPhases.PriorDocumentDeletePending]: false,
	[PersonalMemoryOperationPhases.DocumentDeletePending]: false,
	[PersonalMemoryOperationPhases.CatalogFinalizePending]: false,
	[PersonalMemoryOperationPhases.RecoveryRequired]: true,
	[PersonalMemoryOperationPhases.Completed]: true,
};

const _CORRECT_PHASES: _PhaseAllowance = {
	[PersonalMemoryOperationPhases.DatasetEnsurePending]: false,
	[PersonalMemoryOperationPhases.DocumentAddPending]: true,
	[PersonalMemoryOperationPhases.CognifyPending]: true,
	[PersonalMemoryOperationPhases.CatalogCommitPending]: true,
	[PersonalMemoryOperationPhases.PriorDocumentDeletePending]: true,
	[PersonalMemoryOperationPhases.DocumentDeletePending]: false,
	[PersonalMemoryOperationPhases.CatalogFinalizePending]: false,
	[PersonalMemoryOperationPhases.RecoveryRequired]: true,
	[PersonalMemoryOperationPhases.Completed]: true,
};

const _FORGET_PHASES: _PhaseAllowance = {
	[PersonalMemoryOperationPhases.DatasetEnsurePending]: false,
	[PersonalMemoryOperationPhases.DocumentAddPending]: false,
	[PersonalMemoryOperationPhases.CognifyPending]: false,
	[PersonalMemoryOperationPhases.CatalogCommitPending]: false,
	[PersonalMemoryOperationPhases.PriorDocumentDeletePending]: false,
	[PersonalMemoryOperationPhases.DocumentDeletePending]: true,
	[PersonalMemoryOperationPhases.CatalogFinalizePending]: true,
	[PersonalMemoryOperationPhases.RecoveryRequired]: true,
	[PersonalMemoryOperationPhases.Completed]: true,
};

const _PHASES_BY_KIND: Readonly<Record<PersonalMemoryOperationKinds, _PhaseAllowance>> = {
	[PersonalMemoryOperationKinds.Remember]: _REMEMBER_PHASES,
	[PersonalMemoryOperationKinds.Correct]: _CORRECT_PHASES,
	[PersonalMemoryOperationKinds.Forget]: _FORGET_PHASES,
};

const _MUTATION_FAILURES_BY_PHASE: Readonly<Record<PersonalMemoryOperationPhases, readonly PersonalMemoryOperationFailureCodes[]>> = {
	[PersonalMemoryOperationPhases.DatasetEnsurePending]: [PersonalMemoryOperationFailureCodes.DatasetUnavailable],
	[PersonalMemoryOperationPhases.DocumentAddPending]: [PersonalMemoryOperationFailureCodes.DocumentConflict],
	[PersonalMemoryOperationPhases.CognifyPending]: [PersonalMemoryOperationFailureCodes.IndexingUnavailable],
	[PersonalMemoryOperationPhases.CatalogCommitPending]: [],
	[PersonalMemoryOperationPhases.PriorDocumentDeletePending]: [PersonalMemoryOperationFailureCodes.DeletionUnavailable],
	[PersonalMemoryOperationPhases.DocumentDeletePending]: [PersonalMemoryOperationFailureCodes.DeletionUnavailable],
	[PersonalMemoryOperationPhases.CatalogFinalizePending]: [],
	[PersonalMemoryOperationPhases.RecoveryRequired]: [],
	[PersonalMemoryOperationPhases.Completed]: [],
};

const _BLOCKED_FAILURES_BY_PHASE: Readonly<Record<PersonalMemoryOperationPhases, readonly PersonalMemoryOperationFailureCodes[]>> = {
	[PersonalMemoryOperationPhases.DatasetEnsurePending]: [PersonalMemoryOperationFailureCodes.AuthorityEnded, PersonalMemoryOperationFailureCodes.DatasetUnavailable],
	[PersonalMemoryOperationPhases.DocumentAddPending]: [PersonalMemoryOperationFailureCodes.AuthorityEnded, PersonalMemoryOperationFailureCodes.SourceUnavailable, PersonalMemoryOperationFailureCodes.DocumentConflict],
	[PersonalMemoryOperationPhases.CognifyPending]: [PersonalMemoryOperationFailureCodes.AuthorityEnded, PersonalMemoryOperationFailureCodes.DatasetUnavailable, PersonalMemoryOperationFailureCodes.IndexInputChanged, PersonalMemoryOperationFailureCodes.IndexingUnavailable],
	[PersonalMemoryOperationPhases.CatalogCommitPending]: [PersonalMemoryOperationFailureCodes.AuthorityEnded, PersonalMemoryOperationFailureCodes.CatalogConflict],
	[PersonalMemoryOperationPhases.PriorDocumentDeletePending]: [PersonalMemoryOperationFailureCodes.AuthorityEnded, PersonalMemoryOperationFailureCodes.DeletionUnavailable],
	[PersonalMemoryOperationPhases.DocumentDeletePending]: [PersonalMemoryOperationFailureCodes.AuthorityEnded, PersonalMemoryOperationFailureCodes.DeletionUnavailable],
	[PersonalMemoryOperationPhases.CatalogFinalizePending]: [PersonalMemoryOperationFailureCodes.AuthorityEnded, PersonalMemoryOperationFailureCodes.CatalogConflict],
	[PersonalMemoryOperationPhases.RecoveryRequired]: [],
	[PersonalMemoryOperationPhases.Completed]: [],
};

/** Check whether a durable phase can belong to the selected command strategy. */
export function __PersonalMemoryOperationPhaseMatchesKind(kind: PersonalMemoryOperationKinds, phase: PersonalMemoryOperationPhases): boolean
{
	return _PHASES_BY_KIND[kind][phase];
}

/** Check whether an uncertain mutation can save this failure against the unfinished phase. */
export function __PersonalMemoryMutationFailureMatchesPhase(phase: PersonalMemoryOperationPhases, failureCode: PersonalMemoryOperationFailureCodes): boolean
{
	return _MUTATION_FAILURES_BY_PHASE[phase].includes(failureCode);
}

/** Check whether a failed read or guard can save this failure against the unfinished phase. */
export function __PersonalMemoryBlockedFailureMatchesPhase(phase: PersonalMemoryOperationPhases, failureCode: PersonalMemoryOperationFailureCodes): boolean
{
	return _BLOCKED_FAILURES_BY_PHASE[phase].includes(failureCode);
}

/** Validates newly admitted immutable command evidence before the lifecycle creates state. */
export const ___CreatePersonalMemoryOperationLifecycleCommandSchema: z.ZodType<CreatePersonalMemoryOperationLifecycleCommand> = z.object({
	operationId: _Uuid,
	kind: z.nativeEnum(PersonalMemoryOperationKinds),
	expectedContentDigest: _Digest.nullable(),
	targetFactId: _Identifier.nullable(),
	targetDocumentId: _Uuid.nullable(),
	providerDatasetId: _Uuid.nullable(),
}).strict().superRefine(function _CommandEvidence(command, context)
{
	const remembers = command.kind === PersonalMemoryOperationKinds.Remember;
	const forgets = command.kind === PersonalMemoryOperationKinds.Forget;
	if ((remembers && (command.targetFactId !== null || command.targetDocumentId !== null))
		|| (!remembers && (command.targetFactId === null || command.targetDocumentId === null)))
		context.addIssue({ code: "custom", message: "operation target does not match command kind" });
	if (forgets !== (command.expectedContentDigest === null))
		context.addIssue({ code: "custom", message: "operation content digest does not match command kind" });
	if (!remembers && command.providerDatasetId === null)
		context.addIssue({ code: "custom", message: "existing-fact command requires its provider dataset" });
});

/** Validates a durable lifecycle row before any event decision uses its saved evidence. */
export const ___PersonalMemoryOperationLifecycleSchema: z.ZodType<PersonalMemoryOperationLifecycle> = z.object({
	operationId: _Uuid,
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
}).strict().superRefine(function _StateEvidence(operation, context)
{
	const recovery = operation.phase === PersonalMemoryOperationPhases.RecoveryRequired;
	if (!__PersonalMemoryOperationPhaseMatchesKind(operation.kind, operation.phase))
		context.addIssue({ code: "custom", message: "operation phase does not match command kind" });
	if (!recovery && (operation.recoveryPhase !== null || operation.failureCode !== null || operation.deliveryState !== null))
		context.addIssue({ code: "custom", message: "recovery evidence does not match operation phase" });
	if (recovery)
	{
		if (operation.recoveryPhase === null || operation.failureCode === null
			|| !__PersonalMemoryOperationPhaseMatchesKind(operation.kind, operation.recoveryPhase)
			|| operation.recoveryPhase === PersonalMemoryOperationPhases.RecoveryRequired
			|| operation.recoveryPhase === PersonalMemoryOperationPhases.Completed)
			context.addIssue({ code: "custom", message: "recovery phase must name unfinished work for this command" });
		else if (operation.deliveryState === MemoryMutationDeliveryStates.Ambiguous)
		{
			if (!__PersonalMemoryMutationFailureMatchesPhase(operation.recoveryPhase, operation.failureCode))
				context.addIssue({ code: "custom", message: "ambiguous mutation evidence does not match recovery phase" });
		}
		else if (operation.deliveryState === null)
		{
			if (!__PersonalMemoryBlockedFailureMatchesPhase(operation.recoveryPhase, operation.failureCode))
				context.addIssue({ code: "custom", message: "blocked failure evidence does not match recovery phase" });
		}
		else
			context.addIssue({ code: "custom", message: "proven-not-sent failure cannot be saved as recovery" });
	}
	const remembers = operation.kind === PersonalMemoryOperationKinds.Remember;
	const forgets = operation.kind === PersonalMemoryOperationKinds.Forget;
	if ((remembers && (operation.targetFactId !== null || operation.targetDocumentId !== null))
		|| (!remembers && (operation.targetFactId === null || operation.targetDocumentId === null)))
		context.addIssue({ code: "custom", message: "saved target does not match command kind" });
	if (forgets !== (operation.expectedContentDigest === null))
		context.addIssue({ code: "custom", message: "saved content digest does not match command kind" });
	const activePhase = recovery ? operation.recoveryPhase : operation.phase;
	const datasetMayBeMissing = remembers && activePhase === PersonalMemoryOperationPhases.DatasetEnsurePending;
	if (!datasetMayBeMissing && operation.providerDatasetId === null)
		context.addIssue({ code: "custom", message: "saved phase requires an adopted provider dataset" });
	const documentRequired = !forgets && activePhase !== PersonalMemoryOperationPhases.DatasetEnsurePending && activePhase !== PersonalMemoryOperationPhases.DocumentAddPending;
	if ((documentRequired && operation.documentId === null) || (!documentRequired && operation.documentId !== null))
		context.addIssue({ code: "custom", message: "saved document evidence does not match operation phase" });
	const indexingPairMatches = (operation.indexingOperationId === null) === (operation.expectedInputEvidenceDigest === null);
	if (!indexingPairMatches)
		context.addIssue({ code: "custom", message: "indexing operation and input digest must be saved together" });
	const indexingReceiptRequired = !forgets && (activePhase === PersonalMemoryOperationPhases.CatalogCommitPending
		|| activePhase === PersonalMemoryOperationPhases.PriorDocumentDeletePending
		|| activePhase === PersonalMemoryOperationPhases.Completed);
	if ((indexingReceiptRequired && (operation.indexingOperationId === null || operation.pipelineRunId === null))
		|| (!indexingReceiptRequired && operation.pipelineRunId !== null))
		context.addIssue({ code: "custom", message: "pipeline receipt does not match operation phase" });
	if (forgets && (operation.documentId !== null || operation.indexingOperationId !== null || operation.expectedInputEvidenceDigest !== null || operation.pipelineRunId !== null))
		context.addIssue({ code: "custom", message: "Forget cannot retain replacement or indexing evidence" });
});

const _EventBase = {
	operationId: _Uuid,
	kind: z.nativeEnum(PersonalMemoryOperationKinds),
	expectedRevision: _Revision,
} as const;

/** Validates one event and rejects unknown evidence fields before lifecycle planning. */
export const ___PersonalMemoryOperationEventSchema: z.ZodType<PersonalMemoryOperationEvent> = z.discriminatedUnion("event", [
	z.object({ ..._EventBase, event: z.literal(PersonalMemoryOperationEvents.DatasetEnsured), providerDatasetId: _Uuid }).strict(),
	z.object({ ..._EventBase, event: z.literal(PersonalMemoryOperationEvents.DocumentAdded), documentId: _Uuid, contentDigest: _Digest }).strict(),
	z.object({ ..._EventBase, event: z.literal(PersonalMemoryOperationEvents.IndexEvidenceSaved), indexingOperationId: _Uuid, expectedInputEvidenceDigest: _Digest }).strict(),
	z.object({ ..._EventBase, event: z.literal(PersonalMemoryOperationEvents.IndexingCompleted), indexingOperationId: _Uuid, expectedInputEvidenceDigest: _Digest, pipelineRunId: _Uuid }).strict(),
	z.object({ ..._EventBase, event: z.literal(PersonalMemoryOperationEvents.CatalogCommitted) }).strict(),
	z.object({ ..._EventBase, event: z.literal(PersonalMemoryOperationEvents.PriorDocumentDeleted), documentId: _Uuid }).strict(),
	z.object({ ..._EventBase, event: z.literal(PersonalMemoryOperationEvents.DocumentDeleted), documentId: _Uuid }).strict(),
	z.object({ ..._EventBase, event: z.literal(PersonalMemoryOperationEvents.CatalogFinalized) }).strict(),
	z.object({ ..._EventBase, event: z.literal(PersonalMemoryOperationEvents.MutationFailed), failureCode: z.nativeEnum(PersonalMemoryOperationFailureCodes), deliveryState: z.nativeEnum(MemoryMutationDeliveryStates) }).strict(),
	z.object({ ..._EventBase, event: z.literal(PersonalMemoryOperationEvents.OperationBlocked), failureCode: z.nativeEnum(PersonalMemoryOperationFailureCodes) }).strict(),
]);
