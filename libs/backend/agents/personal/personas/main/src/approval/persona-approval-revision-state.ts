import { PersonaApprovalDenialReasons, PersonaApprovalInterviewStates, PersonaApprovalPersistenceStatuses, PersonaApprovalRevisionStates } from "./persona-authority.types.js";
import { PersonaLifecycleOutcomes } from "../profile/persona-lifecycle.types.js";
import type { ApprovePersonaCommand, ApprovePersonaResult, PersonaApprovalSnapshot, PersonaAuthorityRepository } from "./persona-authority.types.js";

/** Dispatch approval behaviour through the durable revision state in a verified snapshot. */
export async function _ApprovePersonaRevisionState(repository: PersonaAuthorityRepository, snapshot: PersonaApprovalSnapshot, command: ApprovePersonaCommand): Promise<ApprovePersonaResult>
{
	return _REVISION_STATES[snapshot.revisionState].approve(repository, snapshot, command);
}

/** Validate immutable owner and reviewed-source evidence before a revision state may act. */
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

/** State-owned approval behaviour for one durable revision state. */
abstract class _PersonaApprovalRevisionState
{
	/** Attempt approval from this state using only an authority-owned repository. */
	abstract approve(repository: PersonaAuthorityRepository, snapshot: PersonaApprovalSnapshot, command: ApprovePersonaCommand): Promise<ApprovePersonaResult>;

	/** Interpret a durable snapshot re-read after a losing atomic compare-and-set. */
	abstract reconcile(snapshot: PersonaApprovalSnapshot, command: ApprovePersonaCommand): ApprovePersonaResult;

	/** Interpret a durable snapshot after this request lost its atomic compare-and-set. */
	abstract reconcileCompareAndSetConflict(snapshot: PersonaApprovalSnapshot, command: ApprovePersonaCommand): ApprovePersonaResult;
}

/** State behaviour for the only revision state that may enter the atomic approval transition. */
class _DraftRevisionState extends _PersonaApprovalRevisionState
{
	/** Commit approval while every reviewed snapshot precondition still matches. */
	async approve(repository: PersonaAuthorityRepository, snapshot: PersonaApprovalSnapshot, command: ApprovePersonaCommand): Promise<ApprovePersonaResult>
	{
		const result = await repository.approveAndActivateAtomically({ ...command, expectedRevisionState: PersonaApprovalRevisionStates.Draft, expectedInterviewState: PersonaApprovalInterviewStates.Completed, expectedInsightCount: snapshot.insightCount });
		return _PERSISTENCE_OUTCOMES[result.status].resolve(repository, command);
	}

	/** Report conflict because the revision remained draft after another writer won or changed evidence. */
	reconcile(snapshot: PersonaApprovalSnapshot, command: ApprovePersonaCommand): ApprovePersonaResult
	{
		return _Denied(PersonaApprovalDenialReasons.Conflict);
	}

	/** Preserve conflict because the requested draft did not become the observed durable winner. */
	reconcileCompareAndSetConflict(snapshot: PersonaApprovalSnapshot, command: ApprovePersonaCommand): ApprovePersonaResult
	{
		return _Denied(PersonaApprovalDenialReasons.Conflict);
	}
}

/** State behaviour for an immutable revision that has already passed approval. */
class _ApprovedRevisionState extends _PersonaApprovalRevisionState
{
	/** Resume only the exact active revision; another approved revision cannot be activated again here. */
	async approve(repository: PersonaAuthorityRepository, snapshot: PersonaApprovalSnapshot, command: ApprovePersonaCommand): Promise<ApprovePersonaResult>
	{
		return this.reconcile(snapshot, command);
	}

	/** Treat only the exact active revision as an idempotent approval result. */
	reconcile(snapshot: PersonaApprovalSnapshot, command: ApprovePersonaCommand): ApprovePersonaResult
	{
		return snapshot.activeRevisionId === command.personaRevisionId ? { outcome: PersonaLifecycleOutcomes.Approved } : _Denied(PersonaApprovalDenialReasons.NotDraft);
	}

	/** Resume only this request's committed active revision; a later winner remains a CAS conflict. */
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

/** Strategy for one atomic persistence outcome, separate from the revision lifecycle. */
abstract class _PersonaApprovalPersistenceOutcome
{
	/** Translate the exact persistence outcome without concealing the re-read authority fence. */
	abstract resolve(repository: PersonaAuthorityRepository, command: ApprovePersonaCommand): Promise<ApprovePersonaResult>;
}

/** Successful atomic transaction outcome. */
class _ApprovedPersistenceOutcome extends _PersonaApprovalPersistenceOutcome
{
	/** Report the completed lifecycle transition. */
	async resolve(repository: PersonaAuthorityRepository, command: ApprovePersonaCommand): Promise<ApprovePersonaResult>
	{
		return { outcome: PersonaLifecycleOutcomes.Approved };
	}
}

/** Missing owner profile outcome at the atomic persistence boundary. */
class _NotFoundPersistenceOutcome extends _PersonaApprovalPersistenceOutcome
{
	/** Report the bounded missing-owner denial. */
	async resolve(repository: PersonaAuthorityRepository, command: ApprovePersonaCommand): Promise<ApprovePersonaResult>
	{
		return _Denied(PersonaApprovalDenialReasons.NotFound);
	}
}

/** Losing atomic compare-and-set outcome that must be interpreted through a new durable snapshot. */
class _ConflictPersistenceOutcome extends _PersonaApprovalPersistenceOutcome
{
	/** Re-read and revalidate the durable winner before admitting idempotent recovery. */
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
