import { Prisma, type PrismaClient } from "@prisma/client";

import { ConversationAgentBindingVerificationResolver } from "../conversation-agent-binding-authority";
import type { ConversationAgentBindingCommand, ConversationAgentBindingVerificationResult, ConversationAgentBindingVerifier, ConversationManagedAgentPrincipalValidator } from "../conversation-agent-binding.types";
import { PrismaConversationAgentBindingRepository } from "./prisma-conversation-agent-binding-repository";

/**
 * Reads a verified managed-service snapshot in the serializable transaction that owns it.
 *
 * The outer binding resolver uses this verifier without constructing the repository against the root
 * Prisma client. The transaction contains the service, revision, and Principal read. Profile
 * selection and identity provisioning occur after that transaction closes because they may use their
 * own histories and must not extend a PostgreSQL transaction.
 * @implements ConversationAgentBindingVerifier
 */
export class PrismaConversationAgentBindingUnitOfWork implements ConversationAgentBindingVerifier
{
	/** Holds the product database client and the AgentService Principal validator. */
	public constructor(private readonly prisma: PrismaClient, private readonly managedPrincipalValidator: ConversationManagedAgentPrincipalValidator) {}

/**
 * Verifies service facts against one serializable database snapshot.
 *
 * The unit of work builds its repository inside the transaction so the service and active revision
 * cannot be read separately. It closes the transaction before the verifier returns checked facts.
 * @returns A verified service snapshot or the reason the later creation flow must not continue.
 */
	public async verify(command: ConversationAgentBindingCommand): Promise<ConversationAgentBindingVerificationResult>
	{
		// 1. Snapshot — reads the service and active revision under serializable isolation before later ports run.
		const candidate = await this.prisma.$transaction(async function _LoadConversationAgentBinding(transaction)
		{
			const repository = new PrismaConversationAgentBindingRepository(transaction);
			return repository.load(command);
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
		// 2. Closure — creates the verifier after the transaction resolves so Principal validation cannot extend it.
		const resolver = new ConversationAgentBindingVerificationResolver({ load: async () => candidate }, this.managedPrincipalValidator);
		// 3. Verification — preserves the checked snapshot for the outer resolver's later profile and identity work.
		return resolver.verify(command);
	}
}
