import { Prisma, type PrismaClient } from "@prisma/client";

import { PrismaAuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import type { AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import { ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";

import type { SelfRunStatus, SelfRunStatusCaller, SelfRunStatusRepository } from "./self-run-status.router.types";

/** Reads lifecycle-eligible owner runs and filters them through central authorization. */
export class PrismaSelfRunStatusRepository implements SelfRunStatusRepository
{
	/** Transaction shared by the owner query and authorization decision. */
	private readonly _prisma: Prisma.TransactionClient;
	/** Central product authority bound to the same read transaction. */
	private readonly _authorization: Pick<AuthorizationAuthority, "listPrincipalEntitled">;

	/** Constructs the read adapter inside its caller's transaction. */
	constructor(prisma: Prisma.TransactionClient, authorization: Pick<AuthorizationAuthority, "listPrincipalEntitled">)
	{
		this._prisma = prisma;
		this._authorization = authorization;
	}

	/** List the latest fifty personal runs owned by one session subject in one silo. */
	async listOwned(caller: SelfRunStatusCaller): Promise<readonly SelfRunStatus[]>
	{
		const runs = await this._prisma.agentRun.findMany({ where: { siloId: caller.siloId, delegatedUserId: { equals: caller.subjectId } }, orderBy: [{ acceptedAt: "desc" }, { id: "desc" }], take: 200, select: { id: true, attempt: true, state: true, conversationId: true, agentRevisionId: true, acceptedAt: true, finishedAt: true } });
		const resources = runs.map(run => ({ kind: ProductAuthorizationResourceKinds.AgentRun, id: run.id }));
		const allowed = await this._authorization.listPrincipalEntitled({ siloId: caller.siloId, principalId: caller.principalId, action: ProductAuthorizationActions.Read, resources, nowEpochMs: Date.now() });
		const allowedIds = new Set(allowed.map(resource => resource.id));
		return runs.filter(run => allowedIds.has(run.id)).slice(0, 50).map(_toSelfRunStatus);
	}

	/** Read only the exact run owned by the session subject in the selected silo. */
	async readOwned(caller: SelfRunStatusCaller, runId: string): Promise<SelfRunStatus | null>
	{
		const run = await this._prisma.agentRun.findFirst({ where: { id: runId, siloId: caller.siloId, delegatedUserId: { equals: caller.subjectId } }, select: { id: true, attempt: true, state: true, conversationId: true, agentRevisionId: true, acceptedAt: true, finishedAt: true } });
		if (run === null)
		{
			return null;
		}
		const resources = [{ kind: ProductAuthorizationResourceKinds.AgentRun, id: run.id }] as const;
		const allowed = await this._authorization.listPrincipalEntitled({ siloId: caller.siloId, principalId: caller.principalId, action: ProductAuthorizationActions.Read, resources, nowEpochMs: Date.now() });
		return allowed.length === 1 ? _toSelfRunStatus(run) : null;
	}
}

/** Opens repeatable-read transactions for the self-run status route. */
export class PrismaSelfRunStatusUnitOfWork implements SelfRunStatusRepository
{
	/** Product database client that owns status-read transactions. */
	private readonly _prisma: PrismaClient;

	/** Constructs the transaction owner around the app client. */
	constructor(prisma: PrismaClient)
	{
		this._prisma = prisma;
	}

	/** Lists lifecycle-eligible and currently entitled runs from one database snapshot. */
	listOwned(caller: SelfRunStatusCaller): Promise<readonly SelfRunStatus[]>
	{
		return this._Run(function _List(repository) { return repository.listOwned(caller); });
	}

	/** Reads one lifecycle-eligible run and its current entitlement from one snapshot. */
	readOwned(caller: SelfRunStatusCaller, runId: string): Promise<SelfRunStatus | null>
	{
		return this._Run(function _Read(repository) { return repository.readOwned(caller, runId); });
	}

	/** Binds the status repository to one repeatable-read database transaction. */
	private _Run<Result>(operation: (repository: PrismaSelfRunStatusRepository) => Promise<Result>): Promise<Result>
	{
		return this._prisma.$transaction(async function _Read(transaction)
		{
			const authorization = new PrismaAuthorizationAuthority(transaction);
			const repository = new PrismaSelfRunStatusRepository(transaction, authorization);
			return operation(repository);
		}, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
	}
}

/** Convert the selected canonical Prisma fields into the stable product status shape. */
function _toSelfRunStatus(run: { id: string; attempt: number; state: { toString(): string }; conversationId: string | null; agentRevisionId: string; acceptedAt: Date; finishedAt: Date | null }): SelfRunStatus
{
	return { runId: run.id, attempt: run.attempt, state: _state(run.state.toString()), conversationId: run.conversationId, agentRevisionId: run.agentRevisionId, acceptedAt: run.acceptedAt.toISOString(), finishedAt: run.finishedAt?.toISOString() ?? null };
}

/** Map Prisma's PascalCase lifecycle enum to the product API's stable lowercase spelling. */
function _state(value: string): string
{
	if (value === "WaitingForInput")
		return "waiting_for_input";
	return value.replace(/([a-z])([A-Z])/gu, "$1_$2").toLowerCase();
}
