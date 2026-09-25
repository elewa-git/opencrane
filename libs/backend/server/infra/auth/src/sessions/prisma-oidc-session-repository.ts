import type { Prisma, PrismaClient } from "@prisma/client";

import { ___DoWithTrace } from "@opencrane/backend/observability";
import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";

import type { OidcSessionCoordinates, OidcSessionRepository, SaveOidcSession, StoredOidcSession } from "./oidc-session-repository.types";
import { _OIDC_SESSION_CLOCK_SKEW_MS } from "./oidc-session.constants";

/** Stores session content and logout markers in the caller's database transaction. */
export class PrismaOidcSessionRepository implements OidcSessionRepository
{
	/** Shares the transaction across expiry checks and the protected write. */
	private readonly _transaction: Prisma.TransactionClient;

	/** Binds the repository to its unit of work. */
	constructor(transaction: Prisma.TransactionClient) { this._transaction = transaction; }

	/** Loads active content without exposing expired sessions or logout markers. */
	async read(command: OidcSessionCoordinates): Promise<StoredOidcSession | null>
	{
		const row = await this._transaction.oidcSession.findFirst({ where: { namespace: command.namespace, idDigest: command.idDigest, retainUntil: command.retainUntil, validUntil: { gt: command.now }, payload: { not: null } } });
		if (row?.payload === null || row === null)
			return null;
		return { payload: row.payload, revision: row.revision, validUntil: row.validUntil };
	}

	/** Saves a first session or the loaded revision; neither path can overwrite logout. */
	async save(command: SaveOidcSession): Promise<number>
	{
		if (command.validUntil <= command.now || command.validUntil > command.retainUntil || command.retainUntil <= command.now)
			throw new Error("OIDC session has expired");
		if (command.expectedRevision === null)
		{
			const created = await this._transaction.oidcSession.createMany({ data: [{ namespace: command.namespace, idDigest: command.idDigest, payload: command.payload, revision: 1, validUntil: command.validUntil, retainUntil: command.retainUntil }], skipDuplicates: true });
			if (created.count !== 1)
				throw new Error("OIDC session was already saved or destroyed");
			return 1;
		}
		if (!Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 1 || command.expectedRevision >= 2_147_483_647)
			throw new Error("OIDC session revision is invalid");
		const updated = await this._transaction.oidcSession.updateMany({ where: { namespace: command.namespace, idDigest: command.idDigest, revision: command.expectedRevision, retainUntil: command.retainUntil, payload: { not: null }, validUntil: { gt: command.now, gte: command.validUntil } }, data: { payload: command.payload, validUntil: command.validUntil, revision: { increment: 1 } } });
		if (updated.count !== 1)
			throw new Error("OIDC session changed or expired during this request");
		return command.expectedRevision + 1;
	}

	/** Retains a logout marker even when logout races the session's first save. */
	async destroy(command: OidcSessionCoordinates): Promise<void>
	{
		if (command.retainUntil <= command.now)
			return;
		await this._transaction.oidcSession.upsert({ where: { namespace_idDigest: { namespace: command.namespace, idDigest: command.idDigest } }, create: { namespace: command.namespace, idDigest: command.idDigest, payload: null, validUntil: command.now, retainUntil: command.retainUntil }, update: { payload: null, validUntil: command.now } });
	}

	/** Keeps logout markers until even a slower supported replica rejects their identifiers. */
	async prune(namespace: string, now: Date): Promise<number>
	{
		const cutoff = new Date(now.getTime() - _OIDC_SESSION_CLOCK_SKEW_MS);
		const rows = await this._transaction.oidcSession.findMany({ where: { namespace, retainUntil: { lte: cutoff } }, select: { idDigest: true }, orderBy: [{ retainUntil: "asc" }, { idDigest: "asc" }], take: 100 });
		if (rows.length === 0)
			return 0;
		const deleted = await this._transaction.oidcSession.deleteMany({ where: { namespace, idDigest: { in: rows.map(row => row.idDigest) }, retainUntil: { lte: cutoff } } });
		return deleted.count;
	}
}

/** Opens database transactions for browser-session storage, with no network effects inside. */
export class PrismaOidcSessionUnitOfWork implements OidcSessionRepository
{
	/** Uses the application's existing PostgreSQL client and connection pool. */
	private readonly _prisma: PrismaClient;

	/** Receives the client from the public authentication composition. */
	constructor(prisma: PrismaClient) { this._prisma = prisma; }

	/** Reads the session from a current database snapshot. */
	read(command: OidcSessionCoordinates): Promise<StoredOidcSession | null> { return this._Run(function _Read(repository) { return repository.read(command); }); }
	/** Saves content only if the request's revision is still current. */
	save(command: SaveOidcSession): Promise<number> { return this._Run(function _Save(repository) { return repository.save(command); }); }
	/** Commits logout before its callback can redirect the browser. */
	destroy(command: OidcSessionCoordinates): Promise<void> { return this._Run(function _Destroy(repository) { return repository.destroy(command); }); }
	/** Removes a bounded batch after all possible uses of its identifiers have expired. */
	prune(namespace: string, now: Date): Promise<number> { return this._Run(function _Prune(repository) { return repository.prune(namespace, now); }); }

	/** Constructs the adapter from the transaction opened by the reviewed shared runner. */
	private _Run<Result>(operation: (repository: OidcSessionRepository) => Promise<Result>): Promise<Result>
	{
		const prisma = this._prisma;
		return ___DoWithTrace("oidc-session.database", {}, async function _SessionStorage()
		{
			return ___RunInPrismaUnitOfWork(prisma, async function _Session(transaction)
			{
				const repository = new PrismaOidcSessionRepository(transaction);
				return operation(repository);
			}, { isolationLevel: "ReadCommitted", operation: "OIDC session", attemptLimit: 2 });
		});
	}
}
