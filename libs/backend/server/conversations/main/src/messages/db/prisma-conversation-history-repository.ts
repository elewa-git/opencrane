import { ConversationLifecycle, ConversationMode, OrgMemberStatus, type Prisma } from "@prisma/client";

import { ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";

import type { EncryptedConversationPrivatePayload } from "@opencrane/backend/server/conversations/history";
import { ConversationMessageActivations } from "../self-conversation-history.types";
import type { ConversationCaller } from "../../authorization/conversation-caller.types";
import { PrismaConversationProductAuthorizationRepository } from "../../authorization/db/conversation-product-authorization";
import type { AdmittedConversationMessagePayload, AuthorizedConversationProjection, ConversationHistoryRepository, ConversationMessagePayloadAdmissionCommand, StoredConversationPrivatePayload } from "./prisma-conversation-history-repository.types";
import { PrismaGroupChildAccessRepository } from "../../children/db/prisma-group-child-access-repository";

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

	/**
	 * Rechecks current participant authority and records Use before storing a human message.
	 * The caller owns a Serializable transaction covering membership, child access, grants, admission,
	 * ciphertext and list ordering. A retry selects the stored ciphertext before computing evidence;
	 * the caller must compare its decrypted text inside this same callback so conflicts roll back.
	 */
	public async admitMessagePayload(caller: ConversationCaller, conversationId: string, command: ConversationMessagePayloadAdmissionCommand): Promise<AdmittedConversationMessagePayload | null>
	{
		// 1. Recheck current membership and lifecycle in the transaction that will store the message.
		const projection = await this.authorizeWrite(caller, conversationId);
		if (projection === null)
			return null;
		if (projection.mode !== ConversationMode.AgentSession && command.activation !== ConversationMessageActivations.None)
			throw new Error("Direct and group conversation messages cannot activate a computer");
		if (command.activation === ConversationMessageActivations.Interrupt)
			throw new Error("Conversation computer interrupt authority is unavailable");
		// 2. Bind admission to the stored retry winner, never the new ciphertext discarded on a retry.
		const existing = await this._readPayload(caller, conversationId, command.idempotencyKey);
		const payloadRef = existing?.coordinates.payloadRef ?? command.payloadRef;
		const ciphertextDigest = existing?.ciphertextDigest ?? command.payload.ciphertextDigest;
		const admitted = await this.authorization.admit(caller, { kind: ProductAuthorizationResourceKinds.Conversation, id: conversationId }, ProductAuthorizationActions.Use, { payloadRef, ciphertextDigest, idempotencyKey: command.idempotencyKey, activation: command.activation });
		if (!admitted)
			return null;
		// 3. Commit evidence, encrypted content and ordering together, or let the caller roll them back.
		const payload = existing ?? await this._createPayload(caller, conversationId, command.idempotencyKey, payloadRef, command.payload);
		return { projection, payload };
	}

	/** Stores ciphertext once per participant retry key, moves the conversation to the top of every list, and returns the winning encrypted row. */
	public async createOrReadPayload(caller: ConversationCaller, conversationId: string, idempotencyKey: string, payloadRef: string, payload: EncryptedConversationPrivatePayload): Promise<{ readonly created: boolean; readonly payload: StoredConversationPrivatePayload }>
	{
		const existing = await this._readPayload(caller, conversationId, idempotencyKey);
		if (existing !== null)
			return { created: false, payload: existing };
		return { created: true, payload: await this._createPayload(caller, conversationId, idempotencyKey, payloadRef, payload) };
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
		if (conversation === null)
			return null;
		const allowed = requireOpen ? await this.authorization.isCurrentlyEligible(caller, conversationId, action) : await this.authorization.canAccess(caller, conversationId, action);
		const childAccess = new PrismaGroupChildAccessRepository(this.transaction);
		if (!allowed || !await childAccess.mayAccess(caller, conversationId))
			return null;
		if (conversation.participants.length !== 1 || conversation.participants[0]!.visibleFromPosition < 0n)
			return null;
		if (conversation.mode === ConversationMode.AgentSession && (conversation.computerId === null || conversation.computerAgentIdentityId === null || conversation.computerProfileRevisionId === null))
			throw new Error("Agent conversation projection requires complete computer coordinates");
		if (conversation.mode !== ConversationMode.AgentSession && (conversation.computerId !== null || conversation.computerAgentIdentityId !== null || conversation.computerProfileRevisionId !== null))
			throw new Error("Direct or group conversation projection cannot reference a computer");
		return { authorName: membership.displayName?.trim() || "Participant", mode: conversation.mode, computerId: conversation.computerId, computerAgentIdentityId: conversation.computerAgentIdentityId, computerProfileRevisionId: conversation.computerProfileRevisionId, visibleFromPosition: conversation.participants[0]!.visibleFromPosition };
	}

	/** Reads the winning encrypted row for this participant's retry key. */
	private async _readPayload(caller: ConversationCaller, conversationId: string, idempotencyKey: string): Promise<StoredConversationPrivatePayload | null>
	{
		const row = await this.transaction.conversationPrivatePayload.findUnique({ where: { conversationId_authorSubject_idempotencyKey: { conversationId, authorSubject: caller.subjectId, idempotencyKey } } });
		return row === null ? null : _Stored(row);
	}

	/** Stores admitted ciphertext and updates list ordering in the same transaction. */
	private async _createPayload(caller: ConversationCaller, conversationId: string, idempotencyKey: string, payloadRef: string, payload: EncryptedConversationPrivatePayload): Promise<StoredConversationPrivatePayload>
	{
		const created = await this.transaction.conversationPrivatePayload.create({ data: { id: payloadRef, siloId: caller.siloId, conversationId, authorSubject: caller.subjectId, idempotencyKey, keyId: payload.keyId, nonce: Buffer.from(payload.nonce), authTag: Buffer.from(payload.authTag), ciphertext: Buffer.from(payload.ciphertext), ciphertextDigest: payload.ciphertextDigest } });
		// The trigger requires the ciphertext from this transaction and stamps the database time.
		await this.transaction.conversation.update({ where: { id_siloId: { id: conversationId, siloId: caller.siloId } }, data: { updatedAt: new Date() }, select: { id: true } });
		return _Stored(created);
	}
}

/** Maps Prisma byte buffers into the narrow encrypted payload contract. */
function _Stored(row: { readonly id: string; readonly siloId: string; readonly conversationId: string; readonly authorSubject: string; readonly idempotencyKey: string; readonly keyId: string; readonly nonce: Uint8Array; readonly authTag: Uint8Array; readonly ciphertext: Uint8Array; readonly ciphertextDigest: string }): StoredConversationPrivatePayload
{
	return { coordinates: { siloId: row.siloId, conversationId: row.conversationId, payloadRef: row.id, authorSubject: row.authorSubject }, idempotencyKey: row.idempotencyKey, keyId: row.keyId, nonce: row.nonce, authTag: row.authTag, ciphertext: row.ciphertext, ciphertextDigest: row.ciphertextDigest };
}
