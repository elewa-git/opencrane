import { Prisma, type PrismaClient } from "@prisma/client";

import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";

import type { ConversationToolDispatchDependencies } from "../dispatch/conversation-tool-dispatch.types";
import type { ConversationToolProgressNotificationEvidence, ConversationToolRunningNotificationCommand, ConversationToolRunningNotificationEvidenceReader } from "../../turns/tool-progress-notifications/conversation-tool-progress-notification.types";
import { _PrismaConversationToolRunningNotificationRepository } from "./prisma-conversation-tool-running-evidence-repository";

/** Rechecks one committed MCP claim and the existing conversation dispatch authority in SQL. */
export class PrismaConversationToolRunningNotificationEvidenceReader implements ConversationToolRunningNotificationEvidenceReader
{
	/** Transaction owner that keeps the public composition signature stable. */
	private readonly _unitOfWork: _PrismaConversationToolRunningNotificationEvidenceUnitOfWork;

	/** Bind fresh claim reads to the current dispatch dependencies without claiming or completing work. */
	public constructor(prisma: PrismaClient, dependencies: ConversationToolDispatchDependencies)
	{
		this._unitOfWork = new _PrismaConversationToolRunningNotificationEvidenceUnitOfWork(prisma, dependencies);
	}

	/** Run one bounded current-evidence read in a transaction that never grants provider execution. */
	public readCurrent(command: ConversationToolRunningNotificationCommand): Promise<ConversationToolProgressNotificationEvidence | null>
	{
		return this._unitOfWork.readCurrent(command);
	}
}

/** Owns the bounded transaction used to recheck the current dispatch claim. */
class _PrismaConversationToolRunningNotificationEvidenceUnitOfWork implements ConversationToolRunningNotificationEvidenceReader
{
	/** Opens the bounded current-claim read transaction. */
	private readonly _prisma: PrismaClient;
	/** Supplies existing run, membership and IAM dispatch authorities. */
	private readonly _dependencies: ConversationToolDispatchDependencies;

	/** Bind the root Prisma client and current dispatch dependencies outside repository scope. */
	public constructor(prisma: PrismaClient, dependencies: ConversationToolDispatchDependencies)
	{
		this._prisma = prisma;
		this._dependencies = dependencies;
	}

	/** Recheck one running command through an exact transaction-bound repository. */
	public readCurrent(command: ConversationToolRunningNotificationCommand): Promise<ConversationToolProgressNotificationEvidence | null>
	{
		const dependencies = this._dependencies;
		return ___RunInPrismaUnitOfWork(this._prisma, async function _Read(transaction)
		{
			const repository = new _PrismaConversationToolRunningNotificationRepository(transaction, dependencies);
			return repository.readCurrent(command);
		}, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, operation: "conversation tool running evidence", attemptLimit: 1, timeout: 10_000 });
	}
}
