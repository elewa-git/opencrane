import { ConversationMessageState, ConversationThreadState, Prisma } from "@prisma/client";
import type { InitialRunAuthority, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";

import type { SessionAssemblyCommand, SessionAssemblyLoad, ThreadContextInput, ThreadContextSource } from "./session-assembly.types.js";

/** Loads only the execution subject's completed messages from the exact active conversation thread. */
export class PrismaThreadContextSource implements ThreadContextSource
{
	/** Returns an empty transcript for non-conversational work or freezes the participant-authorized thread order. */
	async load(command: SessionAssemblyCommand, run: InitialRunAuthority, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<ThreadContextInput>>
	{
		// 1. Non-conversational work carries no transcript and must not trigger a broad message query.
		if (command.threadId === null) return { outcome: "loaded", value: { messageIds: [] } };
		await transaction.prisma.$queryRaw(Prisma.sql`SELECT "id" FROM "conversation_threads" WHERE "id" = ${command.threadId} AND "silo_id" = ${command.siloId} AND "agent_service_id" = ${run.agentServiceId} AND "state" = 'active'::"ConversationThreadState" FOR UPDATE`);
		const participants = await transaction.prisma.$queryRaw<readonly { readonly userId: string }[]>(Prisma.sql`SELECT "user_id" AS "userId" FROM "conversation_participants" WHERE "thread_id" = ${command.threadId} AND "user_id" = ${command.executionSubjectId} FOR UPDATE`);
		// 2. Revalidate exact silo, service, activity, and participant authority before exposing any message identifier.
		const thread = await transaction.prisma.conversationThread.findFirst({
			where: { id: command.threadId, siloId: command.siloId, agentServiceId: run.agentServiceId, state: ConversationThreadState.Active, participants: { some: { userId: command.executionSubjectId } } },
			select: { messages: { where: { state: ConversationMessageState.Completed }, select: { id: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
		});
		// 3. Freeze only completed canonical messages so partial or cancelled output cannot leak into a run input.
		if (participants.length !== 1 || thread === null) return { outcome: "denied", reason: "thread_unavailable" };
		return { outcome: "loaded", value: { messageIds: thread.messages.map(function _messageId(message): string { return message.id; }) } };
	}
}
