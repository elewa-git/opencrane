import { Prisma, type PrismaClient } from "@prisma/client";
import { ___CreateLogger, ___DoWithTrace, type Logger } from "@opencrane/observability";

import type { AtomicSubmitConversationUserInputResult, ConversationUserInputRepository, SubmitConversationUserInputCommand } from "./conversation-authority.types.js";

/** Canonical Postgres writer for one completed user input and all of its artifact references. */
export class PrismaConversationUserInputRepository implements ConversationUserInputRepository
{
	/** Canonical OpenCrane product database. */
	private readonly prisma: PrismaClient;
	/** Redacted structured logger for durable submission failures. */
	private readonly logger: Logger;

	/** Create the user-input authority over the canonical product database. */
	constructor(prisma: PrismaClient, logger: Logger = ___CreateLogger("personal-conversation-input"))
	{
		this.prisma = prisma;
		this.logger = logger;
	}

	/** Lock thread, participant, revisions, and artifacts before making the completed message visible. */
	async submitAtomically(command: SubmitConversationUserInputCommand): Promise<AtomicSubmitConversationUserInputResult>
	{
		const prisma = this.prisma;
		try
		{
			return await ___DoWithTrace("personal_conversation.submit_input", { siloId: command.siloId, threadId: command.threadId, userId: command.userId, messageId: command.messageId, attachmentCount: command.artifactRevisionIds.length }, async function _traceSubmission()
			{
				return prisma.$transaction(async function _submit(transaction)
				{
					const thread = await transaction.$queryRaw<readonly { readonly id: string }[]>(Prisma.sql`SELECT "id" FROM "conversation_threads" WHERE "id" = ${command.threadId} AND "silo_id" = ${command.siloId} AND "state" = 'active' FOR UPDATE`);
					if (thread[0] === undefined) return { status: "thread_unavailable" } as const;
					const participant = await transaction.$queryRaw<readonly { readonly threadId: string }[]>(Prisma.sql`SELECT "thread_id" AS "threadId" FROM "conversation_participants" WHERE "thread_id" = ${command.threadId} AND "user_id" = ${command.userId} FOR UPDATE`);
					if (participant[0] === undefined) return { status: "thread_unavailable" } as const;
					const requestedIds = [...command.artifactRevisionIds].sort();
					const revisions = requestedIds.length === 0 ? [] : await transaction.$queryRaw<readonly { readonly id: string; readonly state: string; readonly artifactState: string; readonly siloId: string; readonly ownerPrincipalId: string }[]>(Prisma.sql`SELECT revision."id", revision."state"::text AS "state", artifact."state"::text AS "artifactState", artifact."silo_id" AS "siloId", artifact."owner_principal_id" AS "ownerPrincipalId" FROM "artifact_revisions" revision JOIN "artifacts" artifact ON artifact."id" = revision."artifact_id" WHERE revision."id" IN (${Prisma.join(requestedIds)}) ORDER BY revision."id" FOR UPDATE OF revision, artifact`);
					if (revisions.length !== requestedIds.length || revisions.some(function _unavailable(revision): boolean { return revision.state !== "published" || revision.artifactState !== "active" || revision.siloId !== command.siloId || revision.ownerPrincipalId !== command.userId; })) return { status: "artifact_unavailable" } as const;
					const message = await transaction.conversationMessage.create({ data: { id: command.messageId, threadId: command.threadId, userId: command.userId, role: "User", state: "Pending", source: "user_input", blocks: command.text.trim().length === 0 ? [] : [{ id: "text-1", type: "text", value: command.text }], artifactAttachments: { create: command.artifactRevisionIds.map(function _attachment(artifactRevisionId, ordinal) { return { artifactRevisionId, ordinal, attachedBy: command.userId }; }) } } });
					await transaction.conversationMessage.update({ where: { id: message.id }, data: { state: "Completed", completedAt: new Date() } });
					return { status: "submitted" } as const;
				});
			});
		}
		catch (error)
		{
			this.logger.error({ err: error, operation: "personal_conversation.submit_input", siloId: command.siloId, threadId: command.threadId, userId: command.userId, messageId: command.messageId }, "Conversation user input persistence failed");
			return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" ? { status: "conflict" } : { status: "persistence_unavailable" };
		}
	}
}
