import { PersonaApprovalDenialReasons, PersonaApprovalInterviewStates, PersonaApprovalPersistenceStatuses, PersonaApprovalRevisionStates } from "./persona-authority.types.js";
import { PersonaLifecycleOutcomes } from "../profile/persona-lifecycle.types.js";
import type { ApprovePersonaCommand, ApprovePersonaResult, PersonaApprovalSnapshot, PersonaAuthorityRepository } from "./persona-authority.types.js";

/** Runs the approval step that belongs to the revision state in this snapshot. */
export async function _ApprovePersonaRevisionState(repository: PersonaAuthorityRepository, snapshot: PersonaApprovalSnapshot, command: ApprovePersonaCommand): Promise<ApprovePersonaResult>
{
	return _REVISION_STATES[snapshot.revisionState].approve(repository, snapshot, command);
}

/** Checks owner, interview state, insight count, template digest, template selection, and SOUL policy. Returns the first failing reason, or null when approval may go ahead. */
export function _ApprovalEvidenceDenial(snapshot: PersonaApprovalSnapshot, command: ApprovePersonaCommand): PersonaApprovalDenialReasons | null
{
	if (snapshot.profileUserId !== command.userId || snapshot.revisionProfileId !== command.personaProfileId) return PersonaApprovalDenialReasons.WrongOwner;
	if (snapshot.interviewState !== PersonaApprovalInterviewStates.Completed) return PersonaApprovalDenialReasons.InterviewIncomplete;
	if (snapshot.insightCount < 3 || snapshot.insightCount > 5) return PersonaApprovalDenialReasons.InvalidInsights;
	if (!snapshot.templateDigestMatches) return PersonaApprovalDenialReasons.TemplateMismatch;
	if (!snapshot.templateSelectionMatches) return PersonaApprovalDenialReasons.TemplateSelectionMismatch;
	if (snapshot.durableSoulMutationPolicy !== "forbidden") return PersonaApprovalDenialReasons.MutableSoulPolicy;
	return null;
}

/** Base class for the approval behaviour of one revision state. */
abstract class _PersonaApprovalRevisionState
{
	/** Tries to approve from this state, using only the injected repository. */
	abstract approve(repository: PersonaAuthorityRepository, snapshot: PersonaApprovalSnapshot, command: ApprovePersonaCommand): Promise<ApprovePersonaResult>;

	/** Interpret a durable snapshot re-read after a losing atomic compare-and-set. */
	abstract reconcile(snapshot: PersonaApprovalSnapshot, command: ApprovePersonaCommand): ApprovePersonaResult;

	/** Turns a freshly re-read snapshot into a result after this request lost the compare-and-set. */
	abstract reconcileCompareAndSetConflict(snapshot: PersonaApprovalSnapshot, command: ApprovePersonaCommand): ApprovePersonaResult;
}

/** Approval behaviour for a draft revision — the only state that may attempt the update. */
class _DraftRevisionState extends _PersonaApprovalRevisionState
{
	/** Runs the approval update, passing the snapshot values that must still hold. */
	async approve(repository: PersonaAuthorityRepository, snapshot: PersonaApprovalSnapshot, command: ApprovePersonaCommand): Promise<ApprovePersonaResult>
	{
		const result = await repository.approveAndActivateAtomically({ ...command, expectedRevisionState: PersonaApprovalRevisionStates.Draft, expectedInterviewState: PersonaApprovalInterviewStates.Completed, expectedInsightCount: snapshot.insightCount });
		return _PERSISTENCE_OUTCOMES[result.status].resolve(repository, command);
	}

	/** Still a draft, so another writer got there first or the evidence changed: report a conflict. */
	reconcile(snapshot: PersonaApprovalSnapshot, command: ApprovePersonaCommand): ApprovePersonaResult
	{
		return _Denied(PersonaApprovalDenialReasons.Conflict);
	}

	/** The revision is still a draft after this request lost the compare-and-set, so report a conflict. */
	reconcileCompareAndSetConflict(snapshot: PersonaApprovalSnapshot, command: ApprovePersonaCommand): ApprovePersonaResult
	{
		return _Denied(PersonaApprovalDenialReasons.Conflict);
	}
}

/** Approval behaviour for a revision that is already approved. */
class _ApprovedRevisionState extends _PersonaApprovalRevisionState
{
	/** Treats a repeat call as success only when this revision is the one already active; any other approved revision is refused. */
	async approve(repository: PersonaAuthorityRepository, snapshot: PersonaApprovalSnapshot, command: ApprovePersonaCommand): Promise<ApprovePersonaResult>
	{
		return this.reconcile(snapshot, command);
	}

	/** Reports success when this revision is the profile's active one; otherwise refuses it as not a draft. */
	reconcile(snapshot: PersonaApprovalSnapshot, command: ApprovePersonaCommand): ApprovePersonaResult
	{
		return snapshot.activeRevisionId === command.personaRevisionId ? { outcome: PersonaLifecycleOutcomes.Approved } : _Denied(PersonaApprovalDenialReasons.NotDraft);
	}

	/** Reports success when this request's revision is the active one. If a different revision won instead, reports a conflict. */
	reconcileCompareAndSetConflict(snapshot: PersonaApprovalSnapshot, command: ApprovePersonaCommand): ApprovePersonaResult
	{
		return snapshot.activeRevisionId === command.personaRevisionId ? { outcome: PersonaLifecycleOutcomes.Approved } : _Denied(PersonaApprovalDenialReasons.Conflict);
	}
}

/** Map every durable revision state to exactly one state object. */
const _REVISION_STATES: Readonly<Record<PersonaApprovalRevisionStates, _PersonaApprovalRevisionState>> = {
	[PersonaApprovalRevisionStates.Draft]: new _DraftRevisionState(),
	[PersonaApprovalRevisionStates.Approved]: new _ApprovedRevisionState(),
};

/** Base class for handling one outcome of the approval transaction. */
abstract class _PersonaApprovalPersistenceOutcome
{
	/** Turns the transaction outcome into a result, re-reading the database where that is needed. */
	abstract resolve(repository: PersonaAuthorityRepository, command: ApprovePersonaCommand): Promise<ApprovePersonaResult>;
}

/** Successful atomic transaction outcome. */
class _ApprovedPersistenceOutcome extends _PersonaApprovalPersistenceOutcome
{
	/** Reports success. */
	async resolve(repository: PersonaAuthorityRepository, command: ApprovePersonaCommand): Promise<ApprovePersonaResult>
	{
		return { outcome: PersonaLifecycleOutcomes.Approved };
	}
}

/** The transaction could not find the owner's profile. */
class _NotFoundPersistenceOutcome extends _PersonaApprovalPersistenceOutcome
{
	/** Reports that the profile was not found. */
	async resolve(repository: PersonaAuthorityRepository, command: ApprovePersonaCommand): Promise<ApprovePersonaResult>
	{
		return _Denied(PersonaApprovalDenialReasons.NotFound);
	}
}

/** The approval update matched no rows, so the database must be re-read before deciding what happened. */
class _ConflictPersistenceOutcome extends _PersonaApprovalPersistenceOutcome
{
	/** Re-reads the snapshot and re-checks every precondition before treating the loss as an already-approved success. */
	async resolve(repository: PersonaAuthorityRepository, command: ApprovePersonaCommand): Promise<ApprovePersonaResult>
	{
		const reconciled = await repository.getApprovalSnapshot(command);
		if (reconciled === null) return _Denied(PersonaApprovalDenialReasons.Conflict);
		const denial = _ApprovalEvidenceDenial(reconciled, command);
		if (denial !== null) return _Denied(denial);
		return _REVISION_STATES[reconciled.revisionState].reconcileCompareAndSetConflict(reconciled, command);
	}
}

/** Map every atomic persistence outcome to its distinct recovery strategy. */
const _PERSISTENCE_OUTCOMES: Readonly<Record<PersonaApprovalPersistenceStatuses, _PersonaApprovalPersistenceOutcome>> = {
	[PersonaApprovalPersistenceStatuses.Approved]: new _ApprovedPersistenceOutcome(),
	[PersonaApprovalPersistenceStatuses.NotFound]: new _NotFoundPersistenceOutcome(),
	[PersonaApprovalPersistenceStatuses.Conflict]: new _ConflictPersistenceOutcome(),
};

/** Build one stable owner-visible denial result. */
function _Denied(reason: PersonaApprovalDenialReasons): ApprovePersonaResult
{
	return { outcome: PersonaLifecycleOutcomes.Denied, reason };
}
