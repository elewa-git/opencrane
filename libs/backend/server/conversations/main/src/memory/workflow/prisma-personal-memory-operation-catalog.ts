import { Prisma, type PrismaClient } from "@prisma/client";

import { PersonalMemoryOperationCatalogConflict, PersonalMemoryOperationEvents, PersonalMemoryOperationFailureCodes, PersonalMemoryOperationInvalidState, PersonalMemoryOperationPersistenceOutcomes, PersonalMemoryOperationPhases, PrismaPersonalMemoryOperationRepository, type PersonalMemoryOperationEvent, type PersonalMemoryOperationRecord } from "@opencrane/backend/agents/personal/memory";
import { PrismaAuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";

import { PersonalMemoryOperationAuthorizedCatalogApplyOutcomes, type PersonalMemoryOperationAuthorizedCatalogApplyResult, type PersonalMemoryOperationCatalogUnitOfWork } from "./personal-memory-operation-authority.types";
import { PrismaPersonalMemoryOperationActorRepository } from "./prisma-personal-memory-operation-actor-repository";
import { PrismaPersonalMemoryOperationAuthorizationRepository } from "./prisma-personal-memory-operation-authorization-repository";

/**
 * Applies a personal-memory catalog event with current identity and permission in one transaction.
 *
 * A stale event still reaches the operation repository so its existing concurrent-winner result is
 * preserved. An event at the current revision can write catalog state only after the original
 * external principal, active membership, personal dataset, and MemoryScope action all pass.
 *
 * Called by: {@link PersonalMemoryOperationAuthority} after a saved catalog phase is selected.
 */
export class PrismaPersonalMemoryOperationCatalogUnitOfWork implements PersonalMemoryOperationCatalogUnitOfWork
{
	/** Root product database client used to open the atomic catalog transaction. */
	private readonly prisma: PrismaClient;
	/** Configured silo accepted by this server workflow composition. */
	private readonly siloId: string;

	/**
	 * Creates the catalog transaction owner for one configured silo.
	 * @param prisma - Root product database client supplied by application composition.
	 * @param siloId - Trusted server silo that contains every accepted operation.
	 */
	public constructor(prisma: PrismaClient, siloId: string)
	{
		this.prisma = prisma;
		this.siloId = siloId;
	}

	/** @inheritdoc */
	public async apply(event: PersonalMemoryOperationEvent, recordedAt: Date): Promise<PersonalMemoryOperationAuthorizedCatalogApplyResult>
	{
		if (event.event !== PersonalMemoryOperationEvents.CatalogCommitted && event.event !== PersonalMemoryOperationEvents.CatalogFinalized)
			throw new PersonalMemoryOperationInvalidState("personal-memory authorized catalog owner received a non-catalog event");
		const siloId = this.siloId;
		return ___RunInPrismaUnitOfWork(this.prisma, async function _applyAuthorizedCatalog(transaction)
		{
			const operations = new PrismaPersonalMemoryOperationRepository(transaction);
			const operation = await operations.findById(siloId, event.operationId);
			if (operation === null)
				throw new PersonalMemoryOperationInvalidState("personal-memory catalog event has no saved operation");
			if (operation.kind !== event.kind || operation.revision !== event.expectedRevision)
				return { outcome: PersonalMemoryOperationAuthorizedCatalogApplyOutcomes.Applied, persistence: await operations.apply(event, recordedAt) };

			const actor = await new PrismaPersonalMemoryOperationActorRepository(transaction).resolve(operation.siloId, operation.actorPrincipalId);
			if (actor === null)
				return _authorityEnded(operations, operation, recordedAt);
			const authorization = new PrismaAuthorizationAuthority(transaction);
			const allowed = await new PrismaPersonalMemoryOperationAuthorizationRepository(transaction, authorization).allows(operation, actor, recordedAt);
			if (!allowed)
				return _authorityEnded(operations, operation, recordedAt);
			try
			{
				return { outcome: PersonalMemoryOperationAuthorizedCatalogApplyOutcomes.Applied, persistence: await operations.apply(event, recordedAt) };
			}
			catch (error)
			{
				if (error instanceof PersonalMemoryOperationCatalogConflict)
					return _blocked(operations, operation, recordedAt, PersonalMemoryOperationAuthorizedCatalogApplyOutcomes.CatalogConflict, PersonalMemoryOperationFailureCodes.CatalogConflict);
				throw error;
			}
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, attemptLimit: 3, operation: "personal-memory authorized catalog apply" });
	}
}

/** Saves one authority-ended recovery fence, or leaves an existing recovery row unchanged. */
async function _authorityEnded(operations: PrismaPersonalMemoryOperationRepository, operation: PersonalMemoryOperationRecord, recordedAt: Date): Promise<PersonalMemoryOperationAuthorizedCatalogApplyResult>
{
	return _blocked(operations, operation, recordedAt, PersonalMemoryOperationAuthorizedCatalogApplyOutcomes.AuthorityEnded, PersonalMemoryOperationFailureCodes.AuthorityEnded);
}

/** Saves one content-free catalog recovery fence, or leaves existing recovery unchanged. */
async function _blocked(operations: PrismaPersonalMemoryOperationRepository, operation: PersonalMemoryOperationRecord, recordedAt: Date, outcome: PersonalMemoryOperationAuthorizedCatalogApplyOutcomes.AuthorityEnded | PersonalMemoryOperationAuthorizedCatalogApplyOutcomes.CatalogConflict, failureCode: PersonalMemoryOperationFailureCodes.AuthorityEnded | PersonalMemoryOperationFailureCodes.CatalogConflict): Promise<PersonalMemoryOperationAuthorizedCatalogApplyResult>
{
	if (operation.phase === PersonalMemoryOperationPhases.RecoveryRequired)
	{
		return {
			outcome,
			persistence: { outcome: PersonalMemoryOperationPersistenceOutcomes.Retry, operation },
		};
	}
	const event = { operationId: operation.operationId, kind: operation.kind, expectedRevision: operation.revision, event: PersonalMemoryOperationEvents.OperationBlocked, failureCode } as const;
	return { outcome, persistence: await operations.apply(event, recordedAt) };
}
