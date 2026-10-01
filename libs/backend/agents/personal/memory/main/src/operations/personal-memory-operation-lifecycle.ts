import { MemoryMutationDeliveryStates } from "@opencrane/contracts";

import { PersonalMemoryOperationEvents, PersonalMemoryOperationFailureCodes, PersonalMemoryOperationKinds, PersonalMemoryOperationPhases, PersonalMemoryOperationTransitionDenialReasons, PersonalMemoryOperationTransitionOutcomes, type CreatePersonalMemoryOperationLifecycleCommand, type PersonalMemoryOperationEvent, type PersonalMemoryOperationLifecycle, type PersonalMemoryOperationTransitionResult } from "./personal-memory-operation.types";
import { ___CreatePersonalMemoryOperationLifecycleCommandSchema, ___PersonalMemoryOperationEventSchema, ___PersonalMemoryOperationLifecycleSchema, __PersonalMemoryBlockedFailureMatchesPhase, __PersonalMemoryMutationFailureMatchesPhase } from "./personal-memory-operation.validator";

/** Internal table actions. These values are not stored or sent outside this module. */
enum _PolicyCellActions
{
	/** Reject this event for the selected command and phase. */
	Deny = "deny",
	/** Apply delivery-state rules for a failed provider mutation. */
	Mutation = "mutation",
	/** Record recovery for a failed authority, source, read, or catalog guard. */
	Blocked = "blocked",
	/** Apply verified event evidence and move to the cell's next phase. */
	Advance = "advance",
}

type _PolicyCell = { readonly action: _PolicyCellActions.Deny } | { readonly action: _PolicyCellActions.Mutation } | { readonly action: _PolicyCellActions.Blocked } | { readonly action: _PolicyCellActions.Advance; readonly nextPhase: PersonalMemoryOperationPhases };
type _EventPolicy = Readonly<Record<PersonalMemoryOperationEvents, _PolicyCell>>;
type _PhasePolicy = Readonly<Record<PersonalMemoryOperationPhases, _EventPolicy>>;

/** Create the first valid lifecycle state from immutable admitted command evidence. */
export function __CreatePersonalMemoryOperationLifecycle(command: CreatePersonalMemoryOperationLifecycleCommand): PersonalMemoryOperationLifecycle | null
{
	const parsed = ___CreatePersonalMemoryOperationLifecycleCommandSchema.safeParse(command);
	if (!parsed.success)
		return null;
	let phase = PersonalMemoryOperationPhases.DocumentDeletePending;
	if (parsed.data.kind === PersonalMemoryOperationKinds.Remember)
		phase = PersonalMemoryOperationPhases.DatasetEnsurePending;
	else if (parsed.data.kind === PersonalMemoryOperationKinds.Correct)
		phase = PersonalMemoryOperationPhases.DocumentAddPending;
	return {
		...parsed.data,
		phase,
		revision: 1,
		recoveryPhase: null,
		documentId: null,
		indexingOperationId: null,
		expectedInputEvidenceDigest: null,
		pipelineRunId: null,
		failureCode: null,
		deliveryState: null,
	};
}

/**
 * Decide one event without performing I/O or mutating the supplied operation.
 *
 * The caller must compare-and-set the returned revision before performing later work. A stale,
 * unknown, or evidence-conflicting event returns `Denied` and no operation to persist.
 */
export function __PlanPersonalMemoryOperationLifecycle(operationInput: PersonalMemoryOperationLifecycle, eventInput: PersonalMemoryOperationEvent): PersonalMemoryOperationTransitionResult
{
	const operation = ___PersonalMemoryOperationLifecycleSchema.safeParse(operationInput);
	const event = ___PersonalMemoryOperationEventSchema.safeParse(eventInput);
	if (!operation.success || !event.success)
		return _Denied(PersonalMemoryOperationTransitionDenialReasons.InvalidInput);
	if (event.data.operationId !== operation.data.operationId || event.data.kind !== operation.data.kind)
		return _Denied(PersonalMemoryOperationTransitionDenialReasons.WrongOperation);
	if (event.data.expectedRevision !== operation.data.revision)
		return _Denied(PersonalMemoryOperationTransitionDenialReasons.StaleRevision);
	if (operation.data.phase === PersonalMemoryOperationPhases.Completed)
		return _Denied(PersonalMemoryOperationTransitionDenialReasons.InvalidTransition);
	if (operation.data.phase === PersonalMemoryOperationPhases.RecoveryRequired
		&& (event.data.event === PersonalMemoryOperationEvents.MutationFailed || event.data.event === PersonalMemoryOperationEvents.OperationBlocked))
		return _Denied(PersonalMemoryOperationTransitionDenialReasons.InvalidTransition);
	const activePhase = operation.data.phase === PersonalMemoryOperationPhases.RecoveryRequired ? operation.data.recoveryPhase : operation.data.phase;
	if (activePhase === null)
		return _Denied(PersonalMemoryOperationTransitionDenialReasons.InvalidInput);
	const cell = _POLICY[operation.data.kind][activePhase][event.data.event];
	if (cell.action === _PolicyCellActions.Deny)
		return _Denied(PersonalMemoryOperationTransitionDenialReasons.InvalidTransition);
	if (cell.action === _PolicyCellActions.Mutation)
		return _PlanMutationFailure(operation.data, activePhase, event.data);
	if (cell.action === _PolicyCellActions.Blocked)
		return _PlanBlocked(operation.data, activePhase, event.data);
	return _PlanAdvance(operation.data, event.data, cell.nextPhase);
}

/** Return the exhaustive policy table for focused state-by-event contract tests. */
export function _PersonalMemoryOperationLifecyclePolicy(): Readonly<Record<PersonalMemoryOperationKinds, _PhasePolicy>>
{
	return _POLICY;
}

function _PlanMutationFailure(operation: PersonalMemoryOperationLifecycle, activePhase: PersonalMemoryOperationPhases, event: PersonalMemoryOperationEvent): PersonalMemoryOperationTransitionResult
{
	if (event.event !== PersonalMemoryOperationEvents.MutationFailed)
		return _Denied(PersonalMemoryOperationTransitionDenialReasons.InvalidTransition);
	if (!__PersonalMemoryMutationFailureMatchesPhase(activePhase, event.failureCode))
		return _Denied(PersonalMemoryOperationTransitionDenialReasons.ConflictingEvidence);
	if (activePhase === PersonalMemoryOperationPhases.CognifyPending && operation.indexingOperationId === null)
		return _Denied(PersonalMemoryOperationTransitionDenialReasons.ConflictingEvidence);
	if (event.deliveryState === MemoryMutationDeliveryStates.ProvenNotSent)
		return { outcome: PersonalMemoryOperationTransitionOutcomes.Retry, operation };
	return _Advance(operation, {
		phase: PersonalMemoryOperationPhases.RecoveryRequired,
		recoveryPhase: activePhase,
		failureCode: event.failureCode,
		deliveryState: event.deliveryState,
	});
}

function _PlanBlocked(operation: PersonalMemoryOperationLifecycle, activePhase: PersonalMemoryOperationPhases, event: PersonalMemoryOperationEvent): PersonalMemoryOperationTransitionResult
{
	if (event.event !== PersonalMemoryOperationEvents.OperationBlocked)
		return _Denied(PersonalMemoryOperationTransitionDenialReasons.InvalidTransition);
	if (!__PersonalMemoryBlockedFailureMatchesPhase(activePhase, event.failureCode))
		return _Denied(PersonalMemoryOperationTransitionDenialReasons.ConflictingEvidence);
	return _Advance(operation, {
		phase: PersonalMemoryOperationPhases.RecoveryRequired,
		recoveryPhase: activePhase,
		failureCode: event.failureCode,
		deliveryState: null,
	});
}

function _PlanAdvance(operation: PersonalMemoryOperationLifecycle, event: PersonalMemoryOperationEvent, nextPhase: PersonalMemoryOperationPhases): PersonalMemoryOperationTransitionResult
{
	const evidence = _ApplyEventEvidence(operation, event);
	if (evidence === null)
		return _Denied(PersonalMemoryOperationTransitionDenialReasons.ConflictingEvidence);
	return _Advance(operation, { ...evidence, phase: nextPhase, recoveryPhase: null, failureCode: null, deliveryState: null });
}

function _ApplyEventEvidence(operation: PersonalMemoryOperationLifecycle, event: PersonalMemoryOperationEvent): Partial<PersonalMemoryOperationLifecycle> | null
{
	switch (event.event)
	{
		case PersonalMemoryOperationEvents.DatasetEnsured:
			return operation.providerDatasetId === null || operation.providerDatasetId === event.providerDatasetId ? { providerDatasetId: event.providerDatasetId } : null;
		case PersonalMemoryOperationEvents.DocumentAdded:
			return event.contentDigest === operation.expectedContentDigest && (operation.documentId === null || operation.documentId === event.documentId) ? { documentId: event.documentId } : null;
		case PersonalMemoryOperationEvents.IndexEvidenceSaved:
			return operation.indexingOperationId === null && operation.expectedInputEvidenceDigest === null ? { indexingOperationId: event.indexingOperationId, expectedInputEvidenceDigest: event.expectedInputEvidenceDigest } : null;
		case PersonalMemoryOperationEvents.IndexingCompleted:
			return event.indexingOperationId === operation.indexingOperationId && event.expectedInputEvidenceDigest === operation.expectedInputEvidenceDigest && operation.pipelineRunId === null ? { pipelineRunId: event.pipelineRunId } : null;
		case PersonalMemoryOperationEvents.PriorDocumentDeleted:
		case PersonalMemoryOperationEvents.DocumentDeleted:
			return event.documentId === operation.targetDocumentId ? {} : null;
		case PersonalMemoryOperationEvents.CatalogCommitted:
		case PersonalMemoryOperationEvents.CatalogFinalized:
			return {};
		case PersonalMemoryOperationEvents.MutationFailed:
		case PersonalMemoryOperationEvents.OperationBlocked:
			return null;
	}
}

function _Advance(operation: PersonalMemoryOperationLifecycle, update: Partial<PersonalMemoryOperationLifecycle>): PersonalMemoryOperationTransitionResult
{
	const next = { ...operation, ...update, revision: operation.revision + 1 };
	return ___PersonalMemoryOperationLifecycleSchema.safeParse(next).success
		? { outcome: PersonalMemoryOperationTransitionOutcomes.Advanced, operation: next }
		: _Denied(PersonalMemoryOperationTransitionDenialReasons.ConflictingEvidence);
}

function _Denied(reason: PersonalMemoryOperationTransitionDenialReasons): PersonalMemoryOperationTransitionResult
{
	return { outcome: PersonalMemoryOperationTransitionOutcomes.Denied, reason };
}

function _Cells(overrides: Partial<_EventPolicy> = {}): _EventPolicy
{
	return {
		[PersonalMemoryOperationEvents.DatasetEnsured]: { action: _PolicyCellActions.Deny },
		[PersonalMemoryOperationEvents.DocumentAdded]: { action: _PolicyCellActions.Deny },
		[PersonalMemoryOperationEvents.IndexEvidenceSaved]: { action: _PolicyCellActions.Deny },
		[PersonalMemoryOperationEvents.IndexingCompleted]: { action: _PolicyCellActions.Deny },
		[PersonalMemoryOperationEvents.CatalogCommitted]: { action: _PolicyCellActions.Deny },
		[PersonalMemoryOperationEvents.PriorDocumentDeleted]: { action: _PolicyCellActions.Deny },
		[PersonalMemoryOperationEvents.DocumentDeleted]: { action: _PolicyCellActions.Deny },
		[PersonalMemoryOperationEvents.CatalogFinalized]: { action: _PolicyCellActions.Deny },
		[PersonalMemoryOperationEvents.MutationFailed]: { action: _PolicyCellActions.Deny },
		[PersonalMemoryOperationEvents.OperationBlocked]: { action: _PolicyCellActions.Deny },
		...overrides,
	};
}

function _Blocked(): _PolicyCell
{
	return { action: _PolicyCellActions.Blocked };
}

function _Mutation(): _PolicyCell
{
	return { action: _PolicyCellActions.Mutation };
}

function _AdvanceTo(nextPhase: PersonalMemoryOperationPhases): _PolicyCell
{
	return { action: _PolicyCellActions.Advance, nextPhase };
}

const _REMEMBER_POLICY: _PhasePolicy = {
	[PersonalMemoryOperationPhases.DatasetEnsurePending]: _Cells({ [PersonalMemoryOperationEvents.DatasetEnsured]: _AdvanceTo(PersonalMemoryOperationPhases.DocumentAddPending), [PersonalMemoryOperationEvents.MutationFailed]: _Mutation(), [PersonalMemoryOperationEvents.OperationBlocked]: _Blocked() }),
	[PersonalMemoryOperationPhases.DocumentAddPending]: _Cells({ [PersonalMemoryOperationEvents.DocumentAdded]: _AdvanceTo(PersonalMemoryOperationPhases.CognifyPending), [PersonalMemoryOperationEvents.MutationFailed]: _Mutation(), [PersonalMemoryOperationEvents.OperationBlocked]: _Blocked() }),
	[PersonalMemoryOperationPhases.CognifyPending]: _Cells({ [PersonalMemoryOperationEvents.IndexEvidenceSaved]: _AdvanceTo(PersonalMemoryOperationPhases.CognifyPending), [PersonalMemoryOperationEvents.IndexingCompleted]: _AdvanceTo(PersonalMemoryOperationPhases.CatalogCommitPending), [PersonalMemoryOperationEvents.MutationFailed]: _Mutation(), [PersonalMemoryOperationEvents.OperationBlocked]: _Blocked() }),
	[PersonalMemoryOperationPhases.CatalogCommitPending]: _Cells({ [PersonalMemoryOperationEvents.CatalogCommitted]: _AdvanceTo(PersonalMemoryOperationPhases.Completed), [PersonalMemoryOperationEvents.OperationBlocked]: _Blocked() }),
	[PersonalMemoryOperationPhases.PriorDocumentDeletePending]: _Cells(),
	[PersonalMemoryOperationPhases.DocumentDeletePending]: _Cells(),
	[PersonalMemoryOperationPhases.CatalogFinalizePending]: _Cells(),
	[PersonalMemoryOperationPhases.RecoveryRequired]: _Cells(),
	[PersonalMemoryOperationPhases.Completed]: _Cells(),
};

const _CORRECT_POLICY: _PhasePolicy = {
	[PersonalMemoryOperationPhases.DatasetEnsurePending]: _Cells(),
	[PersonalMemoryOperationPhases.DocumentAddPending]: _Cells({ [PersonalMemoryOperationEvents.DocumentAdded]: _AdvanceTo(PersonalMemoryOperationPhases.CognifyPending), [PersonalMemoryOperationEvents.MutationFailed]: _Mutation(), [PersonalMemoryOperationEvents.OperationBlocked]: _Blocked() }),
	[PersonalMemoryOperationPhases.CognifyPending]: _Cells({ [PersonalMemoryOperationEvents.IndexEvidenceSaved]: _AdvanceTo(PersonalMemoryOperationPhases.CognifyPending), [PersonalMemoryOperationEvents.IndexingCompleted]: _AdvanceTo(PersonalMemoryOperationPhases.CatalogCommitPending), [PersonalMemoryOperationEvents.MutationFailed]: _Mutation(), [PersonalMemoryOperationEvents.OperationBlocked]: _Blocked() }),
	[PersonalMemoryOperationPhases.CatalogCommitPending]: _Cells({ [PersonalMemoryOperationEvents.CatalogCommitted]: _AdvanceTo(PersonalMemoryOperationPhases.PriorDocumentDeletePending), [PersonalMemoryOperationEvents.OperationBlocked]: _Blocked() }),
	[PersonalMemoryOperationPhases.PriorDocumentDeletePending]: _Cells({ [PersonalMemoryOperationEvents.PriorDocumentDeleted]: _AdvanceTo(PersonalMemoryOperationPhases.Completed), [PersonalMemoryOperationEvents.MutationFailed]: _Mutation(), [PersonalMemoryOperationEvents.OperationBlocked]: _Blocked() }),
	[PersonalMemoryOperationPhases.DocumentDeletePending]: _Cells(),
	[PersonalMemoryOperationPhases.CatalogFinalizePending]: _Cells(),
	[PersonalMemoryOperationPhases.RecoveryRequired]: _Cells(),
	[PersonalMemoryOperationPhases.Completed]: _Cells(),
};

const _FORGET_POLICY: _PhasePolicy = {
	[PersonalMemoryOperationPhases.DatasetEnsurePending]: _Cells(),
	[PersonalMemoryOperationPhases.DocumentAddPending]: _Cells(),
	[PersonalMemoryOperationPhases.CognifyPending]: _Cells(),
	[PersonalMemoryOperationPhases.CatalogCommitPending]: _Cells(),
	[PersonalMemoryOperationPhases.PriorDocumentDeletePending]: _Cells(),
	[PersonalMemoryOperationPhases.DocumentDeletePending]: _Cells({ [PersonalMemoryOperationEvents.DocumentDeleted]: _AdvanceTo(PersonalMemoryOperationPhases.CatalogFinalizePending), [PersonalMemoryOperationEvents.MutationFailed]: _Mutation(), [PersonalMemoryOperationEvents.OperationBlocked]: _Blocked() }),
	[PersonalMemoryOperationPhases.CatalogFinalizePending]: _Cells({ [PersonalMemoryOperationEvents.CatalogFinalized]: _AdvanceTo(PersonalMemoryOperationPhases.Completed), [PersonalMemoryOperationEvents.OperationBlocked]: _Blocked() }),
	[PersonalMemoryOperationPhases.RecoveryRequired]: _Cells(),
	[PersonalMemoryOperationPhases.Completed]: _Cells(),
};

const _POLICY: Readonly<Record<PersonalMemoryOperationKinds, _PhasePolicy>> = {
	[PersonalMemoryOperationKinds.Remember]: _REMEMBER_POLICY,
	[PersonalMemoryOperationKinds.Correct]: _CORRECT_POLICY,
	[PersonalMemoryOperationKinds.Forget]: _FORGET_POLICY,
};
