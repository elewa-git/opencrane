import { ConversationLifecycle, ConversationMode, OrgMemberStatus, type Prisma } from "@prisma/client";

import { ProductAuthorizationActions } from "@opencrane/models/authorization";

import type { EncryptedConversationPrivatePayload } from "../conversation-private-payload.types";
import type { ConversationCaller } from "../types/conversation-caller.types";
import { PrismaConversationProductAuthorizationRepository } from "./conversation-product-authorization";
import type { AuthorizedConversationProjection, ConversationHistoryRepository, StoredConversationPrivatePayload } from "./prisma-conversation-history-repository.types";

/** Persists only encrypted private payload bytes behind current participant authorization. */
export class PrismaConversationHistoryRepository implements ConversationHistoryRepository
{
	/** Transaction-scoped Prisma delegates used by every repository operation. */
	private readonly transaction: Prisma.TransactionClient;
	/** Central product authorization constructed over the same transaction client. */
	private readonly authorization: PrismaConversationProductAuthorizationRepository;

	/** Connects all participant and encrypted-payload checks to one transaction. */
	public constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
		this.authorization = new PrismaConversationProductAuthorizationRepository(transaction);
	}

	/** Rechecks active membership, participation, and central Read authority. */
	public async authorizeRead(caller: ConversationCaller, conversationId: string): Promise<AuthorizedConversationProjection | null>
	{
		return this._authorize(caller, conversationId, ProductAuthorizationActions.Read, false);
	}

	/** Rechecks active membership, participation, open lifecycle, and central Use authority. */
	public async authorizeWrite(caller: ConversationCaller, conversationId: string): Promise<AuthorizedConversationProjection | null>
	{
		return this._authorize(caller, conversationId, ProductAuthorizationActions.Use, true);
	}

	/** Stores ciphertext once per participant retry key, moves the conversation to the top of every list, and returns the winning encrypted row. */
	public async createOrReadPayload(caller: ConversationCaller, conversationId: string, idempotencyKey: string, payloadRef: string, payload: EncryptedConversationPrivatePayload): Promise<{ readonly created: boolean; readonly payload: StoredConversationPrivatePayload }>
	{
		const existing = await this.transaction.conversationPrivatePayload.findUnique({ where: { conversationId_authorSubject_idempotencyKey: { conversationId, authorSubject: caller.subjectId, idempotencyKey } } });
		if (existing !== null)
			return { created: false, payload: _Stored(existing) };
		const created = await this.transaction.conversationPrivatePayload.create({ data: { id: payloadRef, siloId: caller.siloId, conversationId, authorSubject: caller.subjectId, idempotencyKey, keyId: payload.keyId, nonce: Buffer.from(payload.nonce), authTag: Buffer.from(payload.authTag), ciphertext: Buffer.from(payload.ciphertext), ciphertextDigest: payload.ciphertextDigest } });
		// The conversation trigger accepts this move only because the payload above was stored in the same transaction, and stamps the real database time.
		await this.transaction.conversation.update({ where: { id_siloId: { id: conversationId, siloId: caller.siloId } }, data: { updatedAt: new Date() }, select: { id: true } });
		return { created: true, payload: _Stored(created) };
	}

	/** Loads the exact encrypted rows referenced by already-filtered participant-visible entries. */
	public async readPayloads(caller: ConversationCaller, conversationId: string, payloadRefs: readonly string[]): Promise<readonly StoredConversationPrivatePayload[]>
	{
		if (payloadRefs.length === 0)
			return [];
		const rows = await this.transaction.conversationPrivatePayload.findMany({ where: { id: { in: [...new Set(payloadRefs)] }, siloId: caller.siloId, conversationId } });
		return rows.map(_Stored);
	}

	/** Evaluates current relational projection and central authorization in this repository transaction. */
	private async _authorize(caller: ConversationCaller, conversationId: string, action: ProductAuthorizationActions, requireOpen: boolean): Promise<AuthorizedConversationProjection | null>
	{
		const membership = await this.transaction.orgMembership.findUnique({ where: { clusterTenant_subject: { clusterTenant: caller.siloId, subject: caller.subjectId } }, select: { displayName: true, status: true } });
		if (membership === null || membership.status !== OrgMemberStatus.Active)
			return null;
		const conversation = await this.transaction.conversation.findFirst({ where: { id: conversationId, siloId: caller.siloId, ...(requireOpen ? { lifecycle: ConversationLifecycle.Open } : {}), participants: { some: { userId: caller.subjectId, accessEndedPosition: null } } }, select: { mode: true, computerId: true, computerAgentIdentityId: true, computerProfileRevisionId: true, participants: { where: { userId: caller.subjectId, accessEndedPosition: null }, select: { visibleFromPosition: true } } } });
		if (conversation === null || !await this.authorization.canAccess(caller, conversationId, action))
			return null;
		if (conversation.participants.length !== 1 || conversation.participants[0]!.visibleFromPosition < 0n)
			return null;
		if (conversation.mode === ConversationMode.AgentSession && (conversation.computerId === null || conversation.computerAgentIdentityId === null || conversation.computerProfileRevisionId === null))
			throw new Error("Agent conversation projection requires complete computer coordinates");
		if (conversation.mode !== ConversationMode.AgentSession && (conversation.computerId !== null || conversation.computerAgentIdentityId !== null || conversation.computerProfileRevisionId !== null))
			throw new Error("Direct or group conversation projection cannot reference a computer");
		return { authorName: membership.displayName?.trim() || "Participant", mode: conversation.mode, computerId: conversation.computerId, computerAgentIdentityId: conversation.computerAgentIdentityId, computerProfileRevisionId: conversation.computerProfileRevisionId, visibleFromPosition: conversation.participants[0]!.visibleFromPosition };
	}
}

/** Maps Prisma byte buffers into the narrow encrypted payload contract. */
function _Stored(row: { readonly id: string; readonly siloId: string; readonly conversationId: string; readonly authorSubject: string; readonly idempotencyKey: string; readonly keyId: string; readonly nonce: Uint8Array; readonly authTag: Uint8Array; readonly ciphertext: Uint8Array; readonly ciphertextDigest: string }): StoredConversationPrivatePayload
{
	return { coordinates: { siloId: row.siloId, conversationId: row.conversationId, payloadRef: row.id, authorSubject: row.authorSubject }, idempotencyKey: row.idempotencyKey, keyId: row.keyId, nonce: row.nonce, authTag: row.authTag, ciphertext: row.ciphertext, ciphertextDigest: row.ciphertextDigest };
}
