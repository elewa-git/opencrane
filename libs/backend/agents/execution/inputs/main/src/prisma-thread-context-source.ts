import { Prisma } from "@prisma/client";

import type { InitialRunAuthority, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";

import type { SessionAssemblyCommand, SessionAssemblyLoad, ThreadContextInput, ThreadContextSource } from "./session-assembly.types.js";

/** Transaction-fenced source for the completed transcript and its exact message artifact references. */
export class PrismaThreadContextSource implements ThreadContextSource
{
	/** Load only a subject's exact active-thread transcript under the admission transaction's thread lock. */
	async load(command: SessionAssemblyCommand, run: InitialRunAuthority, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<ThreadContextInput>>
	{
		if (command.threadId === null) return { outcome: "loaded", value: { messageIds: [], messageArtifactAttachments: [] } };
		const threads = await transaction.prisma.$queryRaw<readonly { readonly id: string }[]>(Prisma.sql`SELECT "id" FROM "conversation_threads" WHERE "id" = ${command.threadId} AND "silo_id" = ${command.siloId} AND "agent_service_id" = ${run.agentServiceId} AND "state" = 'active' FOR UPDATE`);
		if (threads[0] === undefined) return { outcome: "denied", reason: "thread_unavailable" };
		const participants = await transaction.prisma.$queryRaw<readonly { readonly threadId: string }[]>(Prisma.sql`SELECT "thread_id" AS "threadId" FROM "conversation_participants" WHERE "thread_id" = ${command.threadId} AND "user_id" = ${command.executionSubjectId} FOR UPDATE`);
		if (participants[0] === undefined) return { outcome: "denied", reason: "thread_unavailable" };
		const messages = await transaction.prisma.conversationMessage.findMany({
			where: { threadId: command.threadId, state: "Completed" },
			orderBy: [{ createdAt: "asc" }, { id: "asc" }],
			select: { id: true, artifactAttachments: { orderBy: { ordinal: "asc" }, select: { artifactRevisionId: true, ordinal: true } } },
		});
		return {
			outcome: "loaded",
			value: {
				messageIds: messages.map(function _messageId(message): string { return message.id; }),
				messageArtifactAttachments: messages.flatMap(function _attachments(message) { return message.artifactAttachments.map(function _attachment(attachment) { return { messageId: message.id, artifactRevisionId: attachment.artifactRevisionId, ordinal: attachment.ordinal }; }); }),
			},
		};
	}
}
