import { AgentRevisionState, AgentServiceKind, AgentServiceState, type Prisma } from "@prisma/client";

import type { ConversationAgentBindingCandidate, ConversationAgentBindingCommand, ConversationAgentBindingRepository } from "../conversation-agent-binding.types";

/** Loads active AgentService state and its published revision from one caller-owned Prisma transaction. */
export class PrismaConversationAgentBindingRepository implements ConversationAgentBindingRepository
{
	/** Captures the serializable transaction that must see service, revision, and Principal together. */
	public constructor(private readonly transaction: Prisma.TransactionClient) {}

	/** Returns only a service whose active pointer still names its current published revision. */
	public async load(command: ConversationAgentBindingCommand): Promise<ConversationAgentBindingCandidate | null>
	{
		const service = await this.transaction.agentService.findFirst({
			where: {
				id: command.agentServiceId,
				siloId: command.siloId,
				state: AgentServiceState.Active,
				activeRevisionId: { not: null },
				activeRevision: { is: { siloId: command.siloId, state: AgentRevisionState.Published } },
			},
			select: {
				id: true,
				kind: true,
				activeRevisionId: true,
				principalId: true,
				activeRevision: { select: { id: true } },
				principal: { select: { issuer: true, provenance: true, subject: true } },
			},
		});
		if (service === null || service.activeRevision === null || service.activeRevisionId === null || service.activeRevision.id !== service.activeRevisionId)
			return null;
		return {
			agentServiceId: service.id,
			agentRevisionId: service.activeRevision.id,
			agentServiceKind: service.kind === AgentServiceKind.Managed ? "managed" : "personal",
			principalId: service.principalId,
			principal: service.principal === null ? null : { issuer: service.principal.issuer, provenance: service.principal.provenance === "Internal" ? "internal" : "external", subject: service.principal.subject },
		};
	}
}
