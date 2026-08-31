import { ThirdPartySourceItemKind, ThirdPartySourceKind, ThirdPartySourceStatus, type Prisma, type PrismaClient } from "@prisma/client";

import { ThirdPartySourceItemKind as ContractThirdPartySourceItemKind, ThirdPartySourceKind as ContractThirdPartySourceKind, ThirdPartySourceStatus as ContractThirdPartySourceStatus, ThirdPartySourceSyncMode, type ThirdPartySource, type ThirdPartySourceItem } from "@opencrane/contracts";
import { ___RunSerializableAuthorizationTransaction, type AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import { AuthorizationDecisionOutcomes, ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import type { ThirdPartySourceAuthority, ThirdPartySourceAuthorizationAuthorityFactory, ThirdPartySourceItemInput, ThirdPartySourceRouteCaller, ThirdPartySourceRouteKind, ThirdPartySourceRouteStatus, ThirdPartySourceTransactionRepository, ThirdPartySourceWriteRequest } from "./routes/third-party-sources.types";

/** Maps API source kinds to the Prisma enum stored in the product database. */
const _SOURCE_KIND_TO_PRISMA: Readonly<Record<ThirdPartySourceRouteKind, ThirdPartySourceKind>> = { "mcp-registry": ThirdPartySourceKind.McpRegistry, "anthropic-skills": ThirdPartySourceKind.AnthropicSkills, "git-repository": ThirdPartySourceKind.GitRepository, "manual-upload": ThirdPartySourceKind.ManualUpload };

/** Maps stored source kinds back to their API spelling. */
const _SOURCE_KIND_FROM_PRISMA: Readonly<Record<ThirdPartySourceKind, ContractThirdPartySourceKind>> = { [ThirdPartySourceKind.McpRegistry]: ContractThirdPartySourceKind.McpRegistry, [ThirdPartySourceKind.AnthropicSkills]: ContractThirdPartySourceKind.AnthropicSkills, [ThirdPartySourceKind.GitRepository]: ContractThirdPartySourceKind.GitRepository, [ThirdPartySourceKind.ManualUpload]: ContractThirdPartySourceKind.ManualUpload };

/** Maps API source states to the Prisma enum stored in the product database. */
const _SOURCE_STATUS_TO_PRISMA: Readonly<Record<ThirdPartySourceRouteStatus, ThirdPartySourceStatus>> = { healthy: ThirdPartySourceStatus.Healthy, syncing: ThirdPartySourceStatus.Syncing, error: ThirdPartySourceStatus.Error, "pending-approval": ThirdPartySourceStatus.PendingApproval };

/** Maps stored source states back to their API spelling. */
const _SOURCE_STATUS_FROM_PRISMA: Readonly<Record<ThirdPartySourceStatus, ContractThirdPartySourceStatus>> = { [ThirdPartySourceStatus.Healthy]: ContractThirdPartySourceStatus.Healthy, [ThirdPartySourceStatus.Syncing]: ContractThirdPartySourceStatus.Syncing, [ThirdPartySourceStatus.Error]: ContractThirdPartySourceStatus.Error, [ThirdPartySourceStatus.PendingApproval]: ContractThirdPartySourceStatus.PendingApproval };

/** Stored source row with the item relation required by the public projection. */
type _ThirdPartySourceRow = Prisma.ThirdPartySourceGetPayload<{ include: { items: true } }>;

/** Signals that the current Principal lacks organisation source-governance authority. */
export class ThirdPartySourceAuthorizationError extends Error {}

/** Signals that a source is absent from the caller's silo. */
export class ThirdPartySourceNotFoundError extends Error {}

/** Persists third-party sources through the transaction that owns authorization. */
class PrismaThirdPartySourceRepository implements ThirdPartySourceTransactionRepository
{
	/** Prisma transaction used for every source query and write. */
	private readonly transaction: Prisma.TransactionClient;

	/** Stores the transaction supplied by the source unit of work. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Lists every source in newest-first order. */
	async list(siloId: string): Promise<readonly ThirdPartySource[]>
	{
		const sources = await this.transaction.thirdPartySource.findMany({ where: { siloId }, orderBy: { createdAt: "desc" }, include: { items: true } });
		return sources.map(_MapThirdPartySource);
	}

	/** Reads one source and its discovered items. */
	async get(siloId: string, sourceId: string): Promise<ThirdPartySource | null>
	{
		const source = await this.transaction.thirdPartySource.findFirst({ where: { id: sourceId, siloId }, include: { items: true } });
		return source === null ? null : _MapThirdPartySource(source);
	}

	/** Creates one source, its item inventory, and the operator audit event. */
	async create(siloId: string, body: ThirdPartySourceWriteRequest): Promise<{ readonly id: string; readonly status: "created" }>
	{
		const createdSource = await this.transaction.thirdPartySource.create({ data: _CreateSourceData(siloId, body) });
		const items = _CreateItemRows(createdSource.id, body.items);
		if (items.length > 0)
		{
			await this.transaction.thirdPartySourceItem.createMany({ data: items });
		}
		await this.transaction.auditEntry.create({ data: { siloId, action: "Created", resource: `ThirdPartySource/${createdSource.id}`, message: `Third-party source ${createdSource.name} created` } });
		return { id: createdSource.id, status: "created" };
	}

	/** Updates one source, replaces its items, and appends the operator audit event. */
	async update(siloId: string, sourceId: string, body: Partial<ThirdPartySourceWriteRequest>): Promise<{ readonly id: string; readonly status: "updated" }>
	{
		const changed = await this.transaction.thirdPartySource.updateMany({ where: { id: sourceId, siloId }, data: _UpdateSourceData(body) });
		if (changed.count !== 1)
		{
			throw new ThirdPartySourceNotFoundError("Third-party source not found");
		}
		await this.transaction.thirdPartySourceItem.deleteMany({ where: { sourceId } });
		const items = _CreateItemRows(sourceId, body.items);
		if (items.length > 0)
		{
			await this.transaction.thirdPartySourceItem.createMany({ data: items });
		}
		await this.transaction.auditEntry.create({ data: { siloId, action: "Updated", resource: `ThirdPartySource/${sourceId}`, message: `Third-party source ${sourceId} updated` } });
		return { id: sourceId, status: "updated" };
	}

	/** Deletes one source and appends the operator audit event. */
	async delete(siloId: string, sourceId: string): Promise<{ readonly id: string; readonly status: "deleted" }>
	{
		const deleted = await this.transaction.thirdPartySource.deleteMany({ where: { id: sourceId, siloId } });
		if (deleted.count !== 1)
		{
			throw new ThirdPartySourceNotFoundError("Third-party source not found");
		}
		await this.transaction.auditEntry.create({ data: { siloId, action: "Deleted", resource: `ThirdPartySource/${sourceId}`, message: `Third-party source ${sourceId} deleted` } });
		return { id: sourceId, status: "deleted" };
	}
}

/** Owns transaction-bound central authorization for third-party source governance. */
export class PrismaThirdPartySourceUnitOfWork implements ThirdPartySourceAuthority
{
	/** Root client used only to open operation transactions. */
	private readonly prisma: PrismaClient;
	/** Builds the central authority over each operation transaction. */
	private readonly createAuthorization: ThirdPartySourceAuthorizationAuthorityFactory<Prisma.TransactionClient> | null;

	/** Stores the transaction owner and optional test authority factory. */
	constructor(prisma: PrismaClient, createAuthorization?: ThirdPartySourceAuthorizationAuthorityFactory<Prisma.TransactionClient>)
	{
		this.prisma = prisma;
		this.createAuthorization = createAuthorization ?? null;
	}

	/** Lists sources after checking current organisation administration. */
	list(caller: ThirdPartySourceRouteCaller): Promise<readonly ThirdPartySource[]>
	{
		return this._WithAuthority(async function _List(repository, authorization) { await _AdmitOrganizationAdministration(authorization, caller, { operation: "list-third-party-sources" }); return repository.list(caller.siloId); });
	}

	/** Reads one source after checking current organisation administration. */
	get(caller: ThirdPartySourceRouteCaller, sourceId: string): Promise<ThirdPartySource | null>
	{
		return this._WithAuthority(async function _Get(repository, authorization) { await _AdmitOrganizationAdministration(authorization, caller, { operation: "get-third-party-source", sourceId }); return repository.get(caller.siloId, sourceId); });
	}

	/** Creates one source after transaction-bound organisation administration admission. */
	create(caller: ThirdPartySourceRouteCaller, body: ThirdPartySourceWriteRequest): Promise<{ readonly id: string; readonly status: "created" }>
	{
		return this._WithAuthority(async function _Create(repository, authorization) { await _AdmitOrganizationAdministration(authorization, caller, { operation: "create-third-party-source", body } as unknown as JsonValue); return repository.create(caller.siloId, body); });
	}

	/** Updates one source after transaction-bound organisation administration admission. */
	update(caller: ThirdPartySourceRouteCaller, sourceId: string, body: Partial<ThirdPartySourceWriteRequest>): Promise<{ readonly id: string; readonly status: "updated" }>
	{
		return this._WithAuthority(async function _Update(repository, authorization) { await _AdmitOrganizationAdministration(authorization, caller, { operation: "update-third-party-source", sourceId, body } as unknown as JsonValue); return repository.update(caller.siloId, sourceId, body); });
	}

	/** Deletes one source after transaction-bound organisation administration admission. */
	delete(caller: ThirdPartySourceRouteCaller, sourceId: string): Promise<{ readonly id: string; readonly status: "deleted" }>
	{
		return this._WithAuthority(async function _Delete(repository, authorization) { await _AdmitOrganizationAdministration(authorization, caller, { operation: "delete-third-party-source", sourceId }); return repository.delete(caller.siloId, sourceId); });
	}

	/** Binds source persistence and the central authority to one Prisma transaction. */
	private _WithAuthority<Result>(operation: (repository: PrismaThirdPartySourceRepository, authorization: AuthorizationAuthority) => Promise<Result>): Promise<Result>
	{
		const createAuthorization = this.createAuthorization;
		return ___RunSerializableAuthorizationTransaction(this.prisma, async function _Run(transaction, authorization)
		{
			const repository = new PrismaThirdPartySourceRepository(transaction);
			return operation(repository, authorization);
		}, createAuthorization ?? undefined);
	}
}

/** Admits the exact organisation administration action before a source write. */
async function _AdmitOrganizationAdministration(authorization: AuthorizationAuthority, caller: ThirdPartySourceRouteCaller, argumentsValue: JsonValue): Promise<void>
{
	const admission = await authorization.admitPrincipal({ siloId: caller.siloId, principalId: caller.principalId, actorKind: "user", actorId: caller.principalId, resource: { kind: ProductAuthorizationResourceKinds.Organization, id: caller.siloId }, action: ProductAuthorizationActions.Administer, argumentsDigest: ___DigestCanonicalJson(argumentsValue), nowEpochMs: Date.now() });
	if (admission.outcome !== AuthorizationDecisionOutcomes.Allow)
	{
		throw new ThirdPartySourceAuthorizationError("Organisation administration authority is required");
	}
}

/** Converts the optional API timestamp into the stored update value. */
function _OptionalTimestamp(value: string | null | undefined): Date | null | undefined
{
	if (value === undefined)
	{
		return undefined;
	}
	if (value === null || value.length === 0)
	{
		return null;
	}
	return new Date(value);
}

/** Builds Prisma create data from one source request. */
function _CreateSourceData(siloId: string, body: ThirdPartySourceWriteRequest): Prisma.ThirdPartySourceCreateInput
{
	return { siloId, name: body.name, kind: _SOURCE_KIND_TO_PRISMA[body.kind], status: _SOURCE_STATUS_TO_PRISMA[body.status ?? "pending-approval"], originUrl: body.originUrl, syncMode: body.syncMode, lastSyncedAt: _OptionalTimestamp(body.lastSyncedAt), nextRunAt: _OptionalTimestamp(body.nextRunAt), notes: body.notes };
}

/** Builds Prisma update data from one partial source request. */
function _UpdateSourceData(body: Partial<ThirdPartySourceWriteRequest>): Prisma.ThirdPartySourceUpdateManyMutationInput
{
	const lastSyncedAt = _OptionalTimestamp(body.lastSyncedAt);
	const nextRunAt = _OptionalTimestamp(body.nextRunAt);
	return {
		...(body.name === undefined ? {} : { name: body.name }),
		...(body.kind === undefined ? {} : { kind: _SOURCE_KIND_TO_PRISMA[body.kind] }),
		...(body.status === undefined ? {} : { status: _SOURCE_STATUS_TO_PRISMA[body.status] }),
		...(body.originUrl === undefined ? {} : { originUrl: body.originUrl }),
		...(body.syncMode === undefined ? {} : { syncMode: body.syncMode }),
		...(lastSyncedAt === undefined ? {} : { lastSyncedAt }),
		...(nextRunAt === undefined ? {} : { nextRunAt }),
		...(body.notes === undefined ? {} : { notes: body.notes }),
	};
}

/** Builds stored item rows for one complete source inventory. */
function _CreateItemRows(sourceId: string, items: readonly ThirdPartySourceItemInput[] | undefined): Prisma.ThirdPartySourceItemCreateManyInput[]
{
	return (items ?? []).map(function _MapItem(item) { return { sourceId, kind: ThirdPartySourceItemKind.McpServer, name: item.name, upstreamId: item.upstreamId, version: item.version, digest: item.digest, metadata: item.metadata as Prisma.InputJsonValue | undefined }; });
}

/** Maps one stored source and item inventory to the public contract. */
function _MapThirdPartySource(source: _ThirdPartySourceRow): ThirdPartySource
{
	const syncMode = source.syncMode === ThirdPartySourceSyncMode.Scheduled ? ThirdPartySourceSyncMode.Scheduled : ThirdPartySourceSyncMode.Manual;
	return {
		id: source.id,
		name: source.name,
		kind: _SOURCE_KIND_FROM_PRISMA[source.kind],
		status: _SOURCE_STATUS_FROM_PRISMA[source.status],
		originUrl: source.originUrl,
		syncMode,
		managedItemCount: source.items.length,
		...(source.lastSyncedAt === null ? {} : { lastSyncedAt: source.lastSyncedAt.toISOString() }),
		...(source.nextRunAt === null ? {} : { nextRunAt: source.nextRunAt.toISOString() }),
		...(source.notes === null ? {} : { notes: source.notes }),
		items: source.items.map(function _MapItem(item): ThirdPartySourceItem
		{
			return {
				id: item.id,
				kind: ContractThirdPartySourceItemKind.McpServer,
				name: item.name,
				upstreamId: item.upstreamId,
				...(item.version === null ? {} : { version: item.version }),
				...(item.digest === null ? {} : { digest: item.digest }),
				...(item.metadata === null ? {} : { metadata: item.metadata as Record<string, unknown> }),
			};
		}),
	};
}
