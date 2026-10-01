import { Prisma, type PrismaClient } from "@prisma/client";

import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";

import type { ConversationCaller } from "../../authorization/conversation-caller.types";
import type { PersonalMemoryOperationActorResolver } from "./personal-memory-operation-authority.types";
import { PrismaPersonalMemoryOperationActorRepository } from "./prisma-personal-memory-operation-actor-repository";

/** Maximum current-actor read time reserved inside a renewed workflow checkpoint lease. */
const _ACTOR_READ_TIMEOUT_MS = 5_000;

/** Resolves the saved external principal and active organisation membership in one read transaction. */
export class PrismaPersonalMemoryOperationActorUnitOfWork implements PersonalMemoryOperationActorResolver
{
	/** Root client used only to open the current actor read transaction. */
	private readonly prisma: PrismaClient;

	/**
	 * Creates the current personal-memory actor adapter.
	 * @param prisma - Root product database client supplied by application composition.
	 */
	public constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/** @inheritdoc */
	public async resolve(siloId: string, actorPrincipalId: string): Promise<ConversationCaller | null>
	{
		return ___RunInPrismaUnitOfWork(this.prisma, async function _resolve(transaction): Promise<ConversationCaller | null>
		{
			return new PrismaPersonalMemoryOperationActorRepository(transaction).resolve(siloId, actorPrincipalId);
		}, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, attemptLimit: 1, timeout: _ACTOR_READ_TIMEOUT_MS, operation: "personal-memory operation actor" });
	}
}
