import type { Prisma, PrismaClient } from "@prisma/client";
import type { Logger } from "@opencrane/backend/observability";
import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";
import type { IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";
import type { ConversationPrivatePayloadCipher } from "@opencrane/backend/server/conversations/history";
import type { GroupChildAgentResolver, GroupChildAuthority, GroupChildCreateCommand, GroupChildShareCommand, GroupChildTaskInput } from "./group-child.types";
import type { ConversationCaller } from "../authorization/conversation-caller.types";
import type { SelfConversationHistoryAuthority } from "../messages/self-conversation-history.types";
import { ConversationHistoryAuthority } from "@opencrane/backend/server/conversations/history";
import { GroupChildHistory } from "./group-child-history";
import { PrismaGroupChildLifecycleUnitOfWork } from "./prisma-group-child-lifecycle";
import { PrismaGroupChildShareUnitOfWork } from "./prisma-group-child-share";

/** Exposes the small group-child journey and its durable worker through the conversation owner. */
export class PrismaGroupChildAuthority implements GroupChildAuthority
{
	private readonly lifecycle: PrismaGroupChildLifecycleUnitOfWork;
	private readonly sharing: PrismaGroupChildShareUnitOfWork;
	public constructor(prisma: PrismaClient, history: Pick<HistoryStore, "readStream" | "readHead" | "append" | "appendAtomic">, cipher: ConversationPrivatePayloadCipher, agents: GroupChildAgentResolver<Prisma.TransactionClient>, workflows: Pick<IWorkflowEngine, "spawn">, participantHistory: Pick<SelfConversationHistoryAuthority, "read">, logger: Pick<Logger, "warn">)
	{
		const writer = new ConversationHistoryAuthority(history);
		this.lifecycle = new PrismaGroupChildLifecycleUnitOfWork(prisma, new GroupChildHistory(history, writer), cipher, agents, workflows, participantHistory, logger);
		this.sharing = new PrismaGroupChildShareUnitOfWork(prisma, history, cipher, participantHistory, agents, workflows, writer);
	}
	/** Admits one exact selected group request. */
	public create(caller: ConversationCaller, parentId: string, command: GroupChildCreateCommand) { return this.lifecycle.create(caller, parentId, command); }
	/** Lists only currently visible admitted requests. */
	public list(caller: ConversationCaller, parentId: string) { return this.lifecycle.list(caller, parentId); }
	/** Posts reviewed text as the human who explicitly shares it. */
	public share(caller: ConversationCaller, childId: string, command: GroupChildShareCommand) { return this.sharing.share(caller, childId, command); }
	/** Resumes admitted creation after worker restart. */
	public run(input: GroupChildTaskInput, attempt = 1) { return this.lifecycle.run(input, attempt); }
}
