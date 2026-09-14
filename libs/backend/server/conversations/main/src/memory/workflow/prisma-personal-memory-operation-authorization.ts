import { Prisma, type PrismaClient } from "@prisma/client";

import type { PersonalMemoryOperationRecord } from "@opencrane/backend/agents/personal/memory";
import { PrismaAuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";

import type { ConversationCaller } from "../../authorization/conversation-caller.types";
import type { PersonalMemoryOperationAuthorization } from "./personal-memory-operation-authority.types";
import { PrismaPersonalMemoryOperationAuthorizationRepository } from "./prisma-personal-memory-operation-authorization-repository";

/** Maximum dataset and product-authorization read time inside a renewed checkpoint lease. */
const _AUTHORIZATION_READ_TIMEOUT_MS = 5_000;

/** Rechecks the saved operation's exact MemoryScope action through central product authorization. */
export class PrismaPersonalMemoryOperationAuthorizationUnitOfWork implements PersonalMemoryOperationAuthorization
{
	/** Root client used only to open the current authorization read transaction. */
	private readonly prisma: PrismaClient;

	/**
	 * Creates the current MemoryScope decision adapter without adding or replacing grants.
	 * @param prisma - Root product database client supplied by application composition.
	 */
	public constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/** @inheritdoc */
	public async allows(operation: PersonalMemoryOperationRecord, actor: ConversationCaller, now: Date): Promise<boolean>
	{
		return ___RunInPrismaUnitOfWork(this.prisma, async function _decide(transaction): Promise<boolean>
		{
			const authorization = new PrismaAuthorizationAuthority(transaction);
			return new PrismaPersonalMemoryOperationAuthorizationRepository(transaction, authorization).allows(operation, actor, now);
		}, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, attemptLimit: 1, timeout: _AUTHORIZATION_READ_TIMEOUT_MS, operation: "personal-memory operation authorization" });
	}
}
