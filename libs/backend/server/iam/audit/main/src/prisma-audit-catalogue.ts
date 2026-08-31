import { type Prisma, type PrismaClient } from "@prisma/client";

import { ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";

import type { AuditAuthorizationAuthorityFactory, AuditCatalogue, AuditCatalogueCandidate, AuditCatalogueTransactionRepository, AuditEntry, AuditPage, AuditPageQuery, AuditRouteCaller } from "./routes/audit.types";

/** Reads audit candidates through the transaction that owns authorization. */
class PrismaAuditCatalogueRepository implements AuditCatalogueTransactionRepository
{
	/** Prisma transaction used for the protected catalogue query. */
	private readonly transaction: Prisma.TransactionClient;

	/** Stores the transaction that owns this repository. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Lists one lifecycle-eligible candidate batch before item authorization is applied. */
	listCandidates(siloId: string, query: AuditPageQuery): Promise<readonly AuditCatalogueCandidate[]>
	{
		return this.transaction.auditEntry.findMany({
			where: { siloId, ...(query.before === null ? {} : { timestamp: { lt: query.before } }) },
			select: { id: true, timestamp: true, action: true, resource: true, message: true },
			orderBy: [{ timestamp: "desc" }, { id: "desc" }],
			take: query.limit + 1,
		});
	}
}

/** Owns one short transaction for an item-filtered audit catalogue read. */
export class PrismaAuditCatalogueUnitOfWork implements AuditCatalogue
{
	/** Root client used only to open the read transaction. */
	private readonly prisma: PrismaClient;
	/** Builds the shared authority over the same transaction. */
	private readonly createAuthorization: AuditAuthorizationAuthorityFactory<Prisma.TransactionClient>;

	/** Stores the transaction owner and central-authority factory. */
	constructor(prisma: PrismaClient, createAuthorization: AuditAuthorizationAuthorityFactory<Prisma.TransactionClient>)
	{
		this.prisma = prisma;
		this.createAuthorization = createAuthorization;
	}

	/** Returns only audit entries the current Principal may read. */
	list(caller: AuditRouteCaller, query: AuditPageQuery): Promise<AuditPage>
	{
		const createAuthorization = this.createAuthorization;
		return this.prisma.$transaction(async function _List(transaction)
		{
			// 1. Load the page candidates first so the audit domain retains lifecycle and paging ownership.
			const repository = new PrismaAuditCatalogueRepository(transaction);
			const candidates = await repository.listCandidates(caller.siloId, query);
			const hasMore = candidates.length > query.limit;
			const candidatePage = candidates.slice(0, query.limit);

			// 2. Filter the complete candidate batch with one current Principal and grant resolution.
			const authorization = createAuthorization(transaction);
			const resources = candidatePage.map(entry => ({ kind: ProductAuthorizationResourceKinds.AuditLog, id: String(entry.id) }));
			const allowed = await authorization.listPrincipalEntitled({ siloId: caller.siloId, principalId: caller.principalId, action: ProductAuthorizationActions.Read, resources, nowEpochMs: Date.now() });
			const allowedIds = new Set(allowed.map(resource => resource.id));
			const visible = candidatePage.filter(entry => allowedIds.has(String(entry.id)));

			// 3. Map only visible entries while advancing the cursor across denied candidate rows.
			const data = visible.map(function _MapAuditEntry(entry): AuditEntry
			{
				return { timestamp: entry.timestamp.toISOString(), action: entry.action, resource: entry.resource, message: entry.message };
			});
			const nextCursorAt = hasMore ? candidatePage.at(-1)?.timestamp ?? null : null;
			return { data, hasMore, nextCursorAt };
		});
	}
}
