import type { Prisma, PrismaClient } from "@prisma/client";

import { ___RunSerializableAuthorizationTransaction, type AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import { AuthorizationDecisionOutcomes, ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { GroupNotFoundError, PrismaGroupRepository } from "./groups.logic";
import type { GroupAuthorizationAuthorityFactory, GroupCreateCommand, GroupMutationResponse, GroupOperationCaller, GroupRepository, GroupResponse, GroupUpdateCommand } from "./groups.logic.types";

/** Signals that the central authority denied one group operation. */
export class GroupAuthorizationError extends Error {}

/**
 * Opens each group operation in a database transaction shared with the authorization authority.
 *
 * The HTTP router supplies the authenticated Principal and this class owns the ordering: load the
 * current resource when needed, admit the product action, then delegate the protected database
 * change. A denial rolls back the same transaction that would have changed the group.
 *
 * Called by: `groupsRouter` in `../routes/groups.ts`.
 * @see PrismaGroupRepository for the group persistence boundary used inside each transaction.
 */
export class PrismaGroupUnitOfWork implements GroupRepository
{
	/** Prisma client that creates repository transactions. */
	private readonly prisma: PrismaClient;
	/** Constructs the central authority over each operation transaction. */
	private readonly createAuthorization: GroupAuthorizationAuthorityFactory<Prisma.TransactionClient> | undefined;

	/** Stores the Prisma client and optional authority factory used by the HTTP composition root. */
	constructor(prisma: PrismaClient, createAuthorization?: GroupAuthorizationAuthorityFactory<Prisma.TransactionClient>)
	{
		this.prisma = prisma;
		this.createAuthorization = createAuthorization;
	}

	/** Lists the groups that survive lifecycle and current authorization checks. */
	list(caller: GroupOperationCaller): Promise<GroupResponse[]>
	{
		return this._WithRepository(async function _List(repository, authorization)
		{
			const groups = await repository.list(caller.siloId);
			const resources = groups.map(group => ({ kind: ProductAuthorizationResourceKinds.Group, id: group.id }));
			const allowed = await authorization.listPrincipalEntitled({ siloId: caller.siloId, principalId: caller.principalId, action: ProductAuthorizationActions.Read, resources, nowEpochMs: Date.now() });
			const allowedIds = new Set(allowed.map(resource => resource.id));
			return groups.filter(group => allowedIds.has(group.id));
		});
	}

	/** Reads a group only when its lifecycle and current authorization checks both pass. */
	get(caller: GroupOperationCaller, groupId: string): Promise<GroupResponse | null>
	{
		return this._WithRepository(async function _Get(repository, authorization)
		{
			const group = await repository.get(caller.siloId, groupId);
			if (group === null)
			{
				return null;
			}
			const resources = [{ kind: ProductAuthorizationResourceKinds.Group, id: group.id }] as const;
			const allowed = await authorization.listPrincipalEntitled({ siloId: caller.siloId, principalId: caller.principalId, action: ProductAuthorizationActions.Read, resources, nowEpochMs: Date.now() });
			return allowed.length === 1 ? group : null;
		});
	}

	/** Admits and creates the group, direct memberships, and audit evidence atomically. */
	create(caller: GroupOperationCaller, body: GroupCreateCommand): Promise<GroupMutationResponse>
	{
		return this._WithRepository(async function _Create(repository, authorization)
		{
			await _RequireAdministration(authorization, caller, body);
			return repository.create(caller.siloId, body);
		});
	}

	/** Admits and updates the group, direct memberships, and audit evidence atomically. */
	update(caller: GroupOperationCaller, groupId: string, body: GroupUpdateCommand): Promise<GroupMutationResponse>
	{
		return this._WithRepository(async function _Update(repository, authorization)
		{
			const current = await repository.get(caller.siloId, groupId);
			if (current === null)
			{
				throw new GroupNotFoundError("Group not found");
			}
			await _RequireAdministration(authorization, caller, { groupId, body });
			return repository.update(caller.siloId, groupId, body);
		});
	}

	/** Admits and deletes the group with domain and authorization evidence atomically. */
	delete(caller: GroupOperationCaller, groupId: string): Promise<GroupMutationResponse>
	{
		return this._WithRepository(async function _Delete(repository, authorization)
		{
			const current = await repository.get(caller.siloId, groupId);
			if (current === null)
			{
				throw new GroupNotFoundError("Group not found");
			}
			await _RequireAdministration(authorization, caller, { groupId });
			return repository.delete(caller.siloId, groupId);
		});
	}

	/** Binds persistence and authorization to the same Prisma transaction client. */
	private _WithRepository<Result>(operation: (repository: PrismaGroupRepository, authorization: AuthorizationAuthority) => Promise<Result>): Promise<Result>
	{
		const createAuthorization = this.createAuthorization;
		return ___RunSerializableAuthorizationTransaction(this.prisma, async function _Run(transaction, authorization)
		{
			const repository = new PrismaGroupRepository(transaction);
			return operation(repository, authorization);
		}, createAuthorization);
	}
}

/** Requires the current organisation administration grant inside the protected transaction. */
async function _RequireAdministration(authorization: AuthorizationAuthority, caller: GroupOperationCaller, argumentsValue: unknown): Promise<void>
{
	const admission = await authorization.admitPrincipal({ siloId: caller.siloId, principalId: caller.principalId, actorKind: "user", actorId: caller.principalId, resource: { kind: ProductAuthorizationResourceKinds.Organization, id: caller.siloId }, action: ProductAuthorizationActions.Administer, argumentsDigest: ___DigestCanonicalJson(argumentsValue as JsonValue), nowEpochMs: Date.now() });
	if (admission.outcome !== AuthorizationDecisionOutcomes.Allow)
	{
		throw new GroupAuthorizationError("Group operation is not authorized");
	}
}
