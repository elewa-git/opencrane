import type { ManagedAuthorizationGrantRepository, ManagedAuthorizationGrantRestrictionRepository } from "@opencrane/backend/server/iam/authorization";
import { AuthorizationBoundaryCoverages, AuthorizationBoundaryKinds, AuthorizationSubjectKinds, ProductAuthorizationActions, ProductAuthorizationResourceKinds, __ProductAuthorizationCapability, type ProductAuthorizationResourceLocator } from "@opencrane/models/authorization";

/** Isolates grants that mirror the creator-confirmed fixed routine audience. */
const _ROUTINE_CONFIRMED_ACCESS_MANAGER_ID = "routine-confirmed-access";

/** Projects exact owner and audience grants after collection creation was admitted. */
export async function _ProjectRoutineGrants(repository: ManagedAuthorizationGrantRepository, siloId: string, routineId: string, ownerPrincipalId: string, audiencePrincipalIds: readonly string[], now: Date): Promise<void>
{
	const resource = { kind: ProductAuthorizationResourceKinds.Routine, id: routineId } as const;
	const grants = new Map<string, ReturnType<typeof _Grant>>();
	for (const principalId of audiencePrincipalIds)
	{
		const grant = _Grant(principalId, ownerPrincipalId, resource, ProductAuthorizationActions.Read);
		grants.set(`${principalId}:${ProductAuthorizationActions.Read}`, grant);
	}
	for (const action of [ProductAuthorizationActions.Read, ProductAuthorizationActions.Edit, ProductAuthorizationActions.Use, ProductAuthorizationActions.Retire])
	{
		const grant = _Grant(ownerPrincipalId, ownerPrincipalId, resource, action);
		grants.set(`${ownerPrincipalId}:${action}`, grant);
	}
	await repository.reconcileManagedResourceGrants({ siloId, managerId: _ROUTINE_CONFIRMED_ACCESS_MANAGER_ID, resource, grants: [...grants.values()], now });
}

/** Retains existing unrevoked fixed-audience Read grants without creating grants or changing validity dates. */
export async function _RetireRoutineGrants(repository: ManagedAuthorizationGrantRestrictionRepository, siloId: string, routineId: string, ownerPrincipalId: string, audiencePrincipalIds: readonly string[], now: Date): Promise<void>
{
	const resource = { kind: ProductAuthorizationResourceKinds.Routine, id: routineId } as const;
	const retainedGrants = audiencePrincipalIds.map(principalId => _Grant(principalId, ownerPrincipalId, resource, ProductAuthorizationActions.Read));
	await repository.restrictManagedResourceGrants({ siloId, managerId: _ROUTINE_CONFIRMED_ACCESS_MANAGER_ID, resource, retainedGrants, now });
}

/** Builds one exact Personal-boundary grant from the routine's confirmed participants. */
function _Grant(principalId: string, createdByPrincipalId: string, resource: ProductAuthorizationResourceLocator, action: ProductAuthorizationActions)
{
	const capability = __ProductAuthorizationCapability(resource.kind, action);
	if (capability === null)
	{
		throw new Error(`routine capability ${resource.kind}:${action} is unavailable`);
	}
	return { subject: { kind: AuthorizationSubjectKinds.Principal, principalId }, boundary: { kind: AuthorizationBoundaryKinds.Personal, principalId }, boundaryCoverage: AuthorizationBoundaryCoverages.Exact, capability, resource, priority: 0, createdByPrincipalId } as const;
}
