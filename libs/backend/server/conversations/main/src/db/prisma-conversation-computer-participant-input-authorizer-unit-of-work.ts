import type { PrismaClient } from "@prisma/client";

import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";

import type { AuthorizedConversationComputerParticipantInput, ConversationComputerParticipantInputAuthorizer, ConversationComputerParticipantInputRequest } from "../conversation-computers/conversation-computer-participant-input-admission.types";
import type { ConversationCaller } from "../types/conversation-caller.types";
import { PrismaConversationComputerParticipantInputAuthorizationAuthority } from "./prisma-conversation-computer-participant-input-authorizer";

/**
 * Runs participant-input authorization in a serializable PostgreSQL transaction.
 *
 * Current membership, participant access, the open Agent session, its creation reservation, and the
 * `Conversation/Use` evidence must describe the same decision. Retrying serialization conflicts
 * avoids accepting an input from an earlier view; callers receive either a `null` refusal that does
 * not disclose its cause or the coordinates allowed to enter immutable history.
 *
 * @implements {ConversationComputerParticipantInputAuthorizer}
 * @see ConversationComputerParticipantInputAuthorizer for the public admission contract.
 */
export class PrismaConversationComputerParticipantInputAuthorizerUnitOfWork implements ConversationComputerParticipantInputAuthorizer
{
	/** Holds the root client that opens the serializable authorization transaction. */
	public constructor(private readonly prisma: PrismaClient)
	{
	}

	/**
	 * Rechecks one input in the serializable snapshot before immutable history may append it.
	 *
	 * A non-null result carries the computer and author metadata for the append. A `null` result does
	 * not disclose whether membership, participant access, the creation binding, or `Conversation/Use`
	 * refused the request.
	 *
	 * @param caller - Identifies the authenticated principal and subject in the requesting silo.
	 * @param conversationId - Names the conversation that the current PostgreSQL facts must authorize.
	 * @param request - Supplies the UUID retry key and plaintext that is digested before audit storage.
	 * @returns Append coordinates, or `null` when the current authorization check refused the input.
	 */
	public async authorize(caller: ConversationCaller, conversationId: string, request: ConversationComputerParticipantInputRequest): Promise<AuthorizedConversationComputerParticipantInput | null>
	{
		return ___RunInPrismaUnitOfWork(this.prisma, async function _Authorize(transaction): Promise<AuthorizedConversationComputerParticipantInput | null>
		{
			const authorizer = new PrismaConversationComputerParticipantInputAuthorizationAuthority(transaction);
			return authorizer.authorize(caller, conversationId, request);
		}, { isolationLevel: "Serializable", attemptLimit: 3, operation: "conversation computer participant input authorization" });
	}
}
