import { ElicitationApprovalScopes, ElicitationBodyKinds, type ElicitationBody, type ElicitationResponseValue } from "@opencrane/contracts";

/*
 * Rules for the three answers an approval question can take: once, this session, or every time.
 *
 * "Once" is the old behaviour and records nothing beyond the per-invocation receipt. The other two
 * additionally write an ElicitationApprovalGrant, which a later call reads so it can skip asking the
 * same person the same question again.
 *
 * Nothing here grants capability. A subject who may not perform an action still may not perform it
 * after answering "every time" — admission resolves that through AuthorizationGrant as it always did.
 * These rules only decide whether the person is asked.
 */

/** Resource kind recorded on a grant minted for a personal-memory recall. */
export const MEMORY_DATASET_RESOURCE_KIND = "memory_dataset";

/** Action recorded on a grant minted for a personal-memory recall. */
export const MEMORY_RECALL_ACTION = "recall";

/** Scopes offered when the subject recalls their own ordinary memory. */
const _STANDARD_SCOPES: readonly ElicitationApprovalScopes[] = [ElicitationApprovalScopes.Once, ElicitationApprovalScopes.Session, ElicitationApprovalScopes.Always];

/** Scopes offered when the dataset is sensitive, or when no owned dataset was found. */
const _SENSITIVE_SCOPES: readonly ElicitationApprovalScopes[] = [ElicitationApprovalScopes.Once, ElicitationApprovalScopes.Session];

/**
 * The scope an answer actually carries.
 *
 * An answer that names no scope means `Once`, which is what every client sent before scopes existed.
 * A denial is always `Once` whatever it claims: refusing a call cannot authorise later ones, so a
 * denial carrying `Always` must not leave a grant behind.
 */
export function _ApprovalScopeOf(response: ElicitationResponseValue): ElicitationApprovalScopes
{
	if (response.kind !== ElicitationBodyKinds.Approval || !response.approved)
		return ElicitationApprovalScopes.Once;
	return response.scope ?? ElicitationApprovalScopes.Once;
}

/**
 * Whether the answer's scope is one the server actually offered.
 *
 * The browser chooses among the scopes listed on the persisted body and cannot widen beyond them, so
 * a question that offered only `Once` cannot be answered `Always` by an altered client. A body with
 * no `offeredScopes` offers `Once` alone.
 */
export function _ApprovalScopeIsOffered(body: ElicitationBody, response: ElicitationResponseValue): boolean
{
	if (body.kind !== ElicitationBodyKinds.Approval || response.kind !== ElicitationBodyKinds.Approval)
		return false;
	const scope = response.scope;
	if (scope === undefined || scope === ElicitationApprovalScopes.Once)
		return true;
	if (!response.approved)
		return false;
	return (body.offeredScopes ?? []).includes(scope);
}

/**
 * Scopes a personal-memory question may be answered with.
 *
 * A sensitive dataset can still be recalled, but the question cannot be silenced permanently — the
 * person is asked again next session. The same restriction covers the case where no owned dataset was
 * found, because a grant needs a dataset to be keyed to and guessing one would widen the answer.
 */
export function _MemoryOfferedScopes(sensitive: boolean): readonly ElicitationApprovalScopes[]
{
	return sensitive ? _SENSITIVE_SCOPES : _STANDARD_SCOPES;
}
