import { ConversationMessageState, ConversationThreadState } from "@prisma/client";

import type { InitialRunAuthority, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";

import type { SessionAssemblyCommand, SessionAssemblyLoad, ThreadContextInput, ThreadContextSource } from "./session-assembly.types.js";

/** Freezes one active, same-service participant transcript into ordered message coordinates. */
export class PrismaThreadContextSource implements ThreadContextSource
{
	/** Returns no messages for work without a thread, otherwise only completed messages from its authorized thread. */
	async load(command: SessionAssemblyCommand, run: InitialRunAuthority, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<ThreadContextInput>>
	{
		// 1. Avoid an unnecessary conversation lookup for scheduled and other non-conversational work.
		if (command.threadId === null) return { outcome: "loaded", value: { messageIds: [] } };
		if (command.identityKind !== "user") return { outcome: "denied", reason: "thread_unavailable" };

		// 2. Bind the thread to its silo, service, active state, and execution-subject participation before reading messages.
		const thread = await transaction.prisma.conversationThread.findFirst({
			where: { id: command.threadId, siloId: command.siloId, agentServiceId: run.agentServiceId, state: ConversationThreadState.Active, participants: { some: { userId: command.executionSubjectId } } },
			select: { id: true },
		});
		if (thread === null) return { outcome: "denied", reason: "thread_unavailable" };

		// 3. Seal only terminal message identifiers in their deterministic transcript order; mutable turns remain outside the snapshot.
		const messages = await transaction.prisma.conversationMessage.findMany({
			where: { threadId: thread.id, state: ConversationMessageState.Completed },
			orderBy: [{ createdAt: "asc" }, { id: "asc" }],
			select: { id: true },
		});
		return { outcome: "loaded", value: { messageIds: messages.map(function _MessageId(message): string { return message.id; }) } };
	}
}
