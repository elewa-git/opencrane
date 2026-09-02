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
			agentServiceKind: _ConversationComputerAgentServiceKind(service.kind),
			principalId: service.principalId,
			principal: _Principal(service.principal),
		};
	}
}

/** Converts the database enum to the closed set accepted by computer profile selection. */
function _ConversationComputerAgentServiceKind(kind: AgentServiceKind): ConversationAgentBindingCandidate["agentServiceKind"]
{
	return kind === AgentServiceKind.Managed ? "managed" : "personal";
}

/** Maps optional persistent Principal facts without broadening their provenance vocabulary. */
function _Principal(principal: { readonly issuer: string; readonly provenance: string; readonly subject: string } | null): ConversationAgentBindingCandidate["principal"]
{
	if (principal === null)
		return null;
	return {
		issuer: principal.issuer,
		provenance: principal.provenance === "Internal" ? "internal" : "external",
		subject: principal.subject,
	};
}
