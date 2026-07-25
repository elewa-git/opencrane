import { ConversationMessageState, ConversationThreadState } from "@prisma/client";

import type { InitialRunAuthority, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";

import type { SessionAssemblyCommand, SessionAssemblyLoad, ThreadContextInput, ThreadContextSource } from "./session-assembly.types.js";

/** Transaction-fenced source for the exact completed transcript admitted into one run snapshot. */
export class PrismaThreadContextSource implements ThreadContextSource
{
	/** Load completed messages only from the active bound thread the execution subject participates in. */
	async load(command: SessionAssemblyCommand, run: InitialRunAuthority, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<ThreadContextInput>>
	{
		if (command.threadId === null) return { outcome: "loaded", value: { messageIds: [] } };

		// 1. Bind the thread to its silo, exact service, active lifecycle, and authenticated participant.
		const thread = await transaction.prisma.conversationThread.findFirst({
			where: { id: command.threadId, siloId: command.siloId, agentServiceId: run.agentServiceId, state: ConversationThreadState.Active, participants: { some: { userId: command.executionSubjectId } } },
			select: { id: true },
		});
		if (thread === null) return { outcome: "denied", reason: "thread_unavailable" };

		// 2. Freeze only terminal message coordinates; streaming and pending blocks remain mutable.
		const messages = await transaction.prisma.conversationMessage.findMany({
			where: { threadId: thread.id, state: ConversationMessageState.Completed },
			orderBy: [{ createdAt: "asc" }, { id: "asc" }],
			select: { id: true },
		});
		return { outcome: "loaded", value: { messageIds: messages.map(function _messageId(message) { return message.id; }) } };
	}
}
