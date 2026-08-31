import type { Prisma } from "@prisma/client";

import { PrismaAuthorizationAuthority, PrismaManagedAuthorizationGrantRepository, type AuthorizationAuthority, type ManagedAuthorizationGrantRepository, type ManagedAuthorizationGrantSpec } from "@opencrane/backend/server/iam/authorization";
import { AuthorizationBoundaryCoverages, AuthorizationBoundaryKinds, AuthorizationDecisionOutcomes, AuthorizationSubjectKinds, ProductAuthorizationActions, ProductAuthorizationResourceKinds, __ProductAuthorizationCapability } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import type { PersonaProductAuthorizationCaller, PersonaProductAuthorizationRepository } from "./persona-product-authorization.types";

/** Isolates grants that follow the durable creator relation of a personal persona profile. */
export const PERSONA_CREATOR_GRANT_MANAGER_ID = "persona-creator-access";

/** Transaction-scoped central authority adapter for the personal persona lifecycle. */
export class PrismaPersonaProductAuthorizationRepository implements PersonaProductAuthorizationRepository
{
	/** Central authority sharing the persona operation's transaction. */
	private readonly authorization: AuthorizationAuthority;
	/** Shared grant writer used to project the creator relation. */
	private readonly managedGrants: ManagedAuthorizationGrantRepository;

	/** Binds persona decisions and creator grants to the owning domain transaction. */
	constructor(transaction: Prisma.TransactionClient, authorization: AuthorizationAuthority | null = null, managedGrants: ManagedAuthorizationGrantRepository | null = null)
	{
		this.authorization = authorization ?? new PrismaAuthorizationAuthority(transaction);
		this.managedGrants = managedGrants ?? new PrismaManagedAuthorizationGrantRepository(transaction);
	}

	/** Returns whether the caller can read one owner-narrowed persona profile. */
	async canRead(caller: PersonaProductAuthorizationCaller, personaProfileId: string): Promise<boolean>
	{
		const entitled = await this.authorization.listPrincipalEntitled({ siloId: caller.siloId, principalId: caller.principalId, action: ProductAuthorizationActions.Read, resources: [{ kind: ProductAuthorizationResourceKinds.Persona, id: personaProfileId }], nowEpochMs: Date.now() });
		return entitled.length === 1;
	}

	/** Records one persona profile mutation admission before the protected write. */
	async admitEdit(caller: PersonaProductAuthorizationCaller, personaProfileId: string, argumentsValue: JsonValue): Promise<boolean>
	{
		const result = await this.authorization.admitPrincipal({ siloId: caller.siloId, principalId: caller.principalId, actorKind: "user", actorId: caller.principalId, resource: { kind: ProductAuthorizationResourceKinds.Persona, id: personaProfileId }, action: ProductAuthorizationActions.Edit, argumentsDigest: ___DigestCanonicalJson(argumentsValue), nowEpochMs: Date.now() });
		return result.outcome === AuthorizationDecisionOutcomes.Allow;
	}

	/** Records permission to create a personal persona before a profile identifier exists. */
	async admitCollectionCreate(caller: PersonaProductAuthorizationCaller): Promise<boolean>
	{
		const result = await this.authorization.admitPrincipal({ siloId: caller.siloId, principalId: caller.principalId, actorKind: "user", actorId: caller.principalId, resource: { kind: ProductAuthorizationResourceKinds.PersonaCollection, id: caller.siloId }, action: ProductAuthorizationActions.Create, argumentsDigest: ___DigestCanonicalJson({ siloId: caller.siloId }), nowEpochMs: Date.now() });
		return result.outcome === AuthorizationDecisionOutcomes.Allow;
	}

	/** Projects the exact creator permissions for one newly created personal persona profile. */
	async reconcileCreator(caller: PersonaProductAuthorizationCaller, personaProfileId: string, now: Date): Promise<void>
	{
		const resource = { kind: ProductAuthorizationResourceKinds.Persona, id: personaProfileId } as const;
		const actions = [ProductAuthorizationActions.Discover, ProductAuthorizationActions.Read, ProductAuthorizationActions.Create, ProductAuthorizationActions.Edit, ProductAuthorizationActions.Use, ProductAuthorizationActions.Delete] as const;
		const grants = actions.map(function _Grant(action): ManagedAuthorizationGrantSpec
		{
			const capability = __ProductAuthorizationCapability(resource.kind, action);
			if (capability === null)
				throw new Error(`persona capability ${action} is unavailable`);
			return { subject: { kind: AuthorizationSubjectKinds.Principal, principalId: caller.principalId }, boundary: { kind: AuthorizationBoundaryKinds.Personal, principalId: caller.principalId }, boundaryCoverage: AuthorizationBoundaryCoverages.Exact, capability, resource, priority: 0, createdByPrincipalId: caller.principalId };
		});
		await this.managedGrants.reconcileManagedResourceGrants({ siloId: caller.siloId, managerId: PERSONA_CREATOR_GRANT_MANAGER_ID, resource, grants, now });
	}
}
