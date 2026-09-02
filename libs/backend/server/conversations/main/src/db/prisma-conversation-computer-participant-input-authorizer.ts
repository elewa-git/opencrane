import { createHash } from "node:crypto";

import { ConversationCreationReservationState, ConversationLifecycle, ConversationMode, OrgMemberStatus, type Prisma } from "@prisma/client";

import { ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";

import type { AuthorizedConversationComputerParticipantInput, ConversationComputerParticipantInputAuthorizer, ConversationComputerParticipantInputRequest } from "../conversation-computers/conversation-computer-participant-input-admission.types";
import type { ConversationCaller } from "../types/conversation-caller.types";
import { PrismaConversationProductAuthorizationRepository } from "./conversation-product-authorization";

/** Recognizes the UUID input identifiers that immutable conversation history accepts. */
const _UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/**
 * Rechecks current PostgreSQL facts before participant input reaches immutable history.
 *
 * The caller uses this while its serializable transaction is open, so a membership, participant,
 * conversation, or creation-reservation change cannot be accepted from an earlier read. It returns
 * the creation-bound computer and server-owned author facts after it records `Conversation/Use`; it
 * returns `null` without saying which current condition prevented the append.
 *
 * Called by: {@link PrismaConversationComputerParticipantInputAuthorizerUnitOfWork}.
 * @implements {ConversationComputerParticipantInputAuthorizer}
 * @see ConversationComputerParticipantInputAuthorizer for the public admission contract.
 */
export class PrismaConversationComputerParticipantInputAuthorizationAuthority implements ConversationComputerParticipantInputAuthorizer
{
	/** Holds the serializable transaction that binds membership and decision evidence together. */
	public constructor(private readonly transaction: Prisma.TransactionClient)
	{
	}

	/**
	 * Checks a participant input against the current conversation and returns its append coordinates.
	 *
	 * `null` keeps the refusal private; a non-null result is the creation-bound computer and the
	 * server-derived author metadata that immutable history may retain.
	 *
	 * @param caller - Identifies the authenticated principal and subject in the requesting silo.
	 * @param conversationId - Names the conversation whose current access and creation binding must match.
	 * @param request - Supplies the UUID retry key and plaintext that is digested before audit storage.
	 * @returns The history append coordinates after `Conversation/Use` is recorded, or `null` on refusal.
	 */
	public async authorize(caller: ConversationCaller, conversationId: string, request: ConversationComputerParticipantInputRequest): Promise<AuthorizedConversationComputerParticipantInput | null>
	{
		if (!_ValidRequest(request))
			return null;

		// 1. Require current organisation membership before exposing a conversation's creation binding.
		const membership = await this.transaction.orgMembership.findFirst({ where: { clusterTenant: caller.siloId, subject: caller.subjectId, status: OrgMemberStatus.Active }, select: { displayName: true } });
		if (membership === null)
			return null;

		// 2. Bind the open Agent conversation to its projected creation reservation and continuing participant.
		const conversation = await this.transaction.conversation.findFirst({
			where: { id: conversationId, siloId: caller.siloId, mode: ConversationMode.AgentSession, lifecycle: ConversationLifecycle.Open, participants: { some: { userId: caller.subjectId, accessEndedPosition: null } } },
			select: { agentServiceId: true },
		});
		if (conversation === null)
			return null;
		const reservation = await this.transaction.conversationCreationReservation.findFirst({
			where: { siloId: caller.siloId, conversationId, state: ConversationCreationReservationState.Projected, mode: ConversationMode.AgentSession, computerId: { not: null } },
			select: { computerId: true, agentServiceId: true },
		});
		if (reservation?.computerId === null || reservation?.computerId === undefined || reservation.agentServiceId !== conversation.agentServiceId)
			return null;

		// 3. Commit current `Use` evidence without retaining the participant's plaintext in the audit log.
		const authorization = new PrismaConversationProductAuthorizationRepository(this.transaction);
		const admitted = await authorization.admit(caller, { kind: ProductAuthorizationResourceKinds.Conversation, id: conversationId }, ProductAuthorizationActions.Use, _Arguments(request));
		if (!admitted)
			return null;
		return { computerId: reservation.computerId, author: { principalId: caller.principalId, participantId: caller.subjectId, name: _DisplayName(membership.displayName, caller.subjectId), avatarArtifactRevisionId: null } };
	}
}

/** Builds non-plaintext protected-action arguments for the authorization audit decision. */
function _Arguments(request: ConversationComputerParticipantInputRequest): { readonly inputId: string; readonly textDigest: `sha256:${string}` }
{
	return { inputId: request.inputId, textDigest: `sha256:${createHash("sha256").update(request.text, "utf8").digest("hex")}` };
}

/** Returns a peer-visible author name without depending on an optional profile field. */
function _DisplayName(displayName: string | null, subjectId: string): string
{
	if (displayName !== null && displayName.trim().length > 0)
		return displayName.trim();
	return subjectId;
}

/** Rejects malformed input before a protected-action decision can reach the audit log. */
function _ValidRequest(request: ConversationComputerParticipantInputRequest): boolean
{
	return _UUID_PATTERN.test(request.inputId) && request.text.trim().length > 0 && Buffer.byteLength(request.text, "utf8") <= 64 * 1024;
}
