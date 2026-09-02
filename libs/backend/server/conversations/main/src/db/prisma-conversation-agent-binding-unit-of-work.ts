import { Prisma, type PrismaClient } from "@prisma/client";

import { ConversationAgentBindingVerificationResolver } from "../conversation-agent-binding-authority";
import type { ConversationAgentBindingCommand, ConversationAgentBindingVerificationResult, ConversationAgentBindingVerifier, ConversationManagedAgentPrincipalValidator } from "../conversation-agent-binding.types";
import { PrismaConversationAgentBindingRepository } from "./prisma-conversation-agent-binding-repository";

/**
 * Runs binding resolution in the serializable transaction that owns its service snapshot.
 *
 * A later creation composition can use this public authority port without constructing the
 * repository against the root Prisma client. The transaction contains the service, revision, and
 * Principal read; profile and identity selectors remain injected policy ports because this
 * checkpoint does not own their data.
 * @implements ConversationAgentBindingAuthority
 */
export class PrismaConversationAgentBindingUnitOfWork implements ConversationAgentBindingVerifier
{
	/** Holds the product database client and the non-database authorities used by the resolver. */
	public constructor(private readonly prisma: PrismaClient, private readonly managedPrincipalValidator: ConversationManagedAgentPrincipalValidator) {}

/**
 * Resolves a binding against one serializable database snapshot.
 *
 * The unit of work builds its repository inside the transaction so the service and active revision
 * cannot be read separately. A returned denial leaves no creation history to persist.
 * @returns A complete binding or the reason the later creation flow must not continue.
 */
	public async verify(command: ConversationAgentBindingCommand): Promise<ConversationAgentBindingVerificationResult>
	{
		const candidate = await this.prisma.$transaction(async function _LoadConversationAgentBinding(transaction)
		{
			const repository = new PrismaConversationAgentBindingRepository(transaction);
			return repository.load(command);
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
		return new ConversationAgentBindingVerificationResolver({ load: async () => candidate }, this.managedPrincipalValidator).verify(command);
	}
}
