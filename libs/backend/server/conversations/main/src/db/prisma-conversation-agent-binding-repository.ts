import { AgentRevisionState, AgentServiceKind, AgentServiceState, type Prisma } from "@prisma/client";

import type { ConversationAgentBindingCandidate, ConversationAgentBindingCommand, ConversationAgentBindingRepository } from "../conversation-agent-binding.types";

/**
 * Loads an active AgentService and its current published revision from the transaction supplied by
 * {@link PrismaConversationAgentBindingUnitOfWork}.
 *
 * The query keeps the service, silo, and active-revision requirements together. It returns a
 * candidate rather than accepting a Principal, profile, or AgentIdentity; those checks belong to
 * the resolver's injected authorities.
 * @implements ConversationAgentBindingRepository
 */
export class PrismaConversationAgentBindingRepository implements ConversationAgentBindingRepository
{
	/** Holds the transaction that reads the service, revision, and Principal as one snapshot. */
	public constructor(private readonly transaction: Prisma.TransactionClient) {}

/**
 * Returns the matching active service only when its active pointer still identifies a published
 * revision in the requested silo.
 *
 * `null` tells the resolver to deny the command. The post-query pointer check defends the mapping
 * from a partial relation result before any later authority sees it.
 * @returns A candidate for further validation, or `null` when the active service/revision pair is unavailable.
 */
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

/** Converts the database enum to the two kinds accepted by computer-profile selection. */
function _ConversationComputerAgentServiceKind(kind: AgentServiceKind): ConversationAgentBindingCandidate["agentServiceKind"]
{
	return kind === AgentServiceKind.Managed ? "managed" : "personal";
}

/** Maps optional stored Principal facts into the two source values accepted by the binding port. */
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
