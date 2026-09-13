import { randomUUID, timingSafeEqual } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";
import { HistoryExpectedRevisions, type HistoryStore } from "@opencrane/backend/server/infra/history-store";
import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";
import { ComputerLeaseStates, ConversationAuthorKinds, ConversationEntryKinds, ConversationMessageContentBlockKinds, type ArtifactMessageContentBlock, type MessageEntry } from "@opencrane/contracts";
import { ___DigestCanonicalJson } from "@opencrane/util";

import { ConversationHistoryAppendOutcomes, ConversationHistoryAuthority, ConversationHistoryReader } from "@opencrane/backend/server/conversations/history";
import type { ConversationCaller } from "../authorization/conversation-caller.types";
import { _DeterministicUuid } from "../sessions/agent-session-identifiers";
import type { AdmittedConversationMessagePayload, AuthorizedConversationProjection, StoredConversationPrivatePayload } from "./db/prisma-conversation-history-repository.types";
import { PrismaConversationHistoryRepository } from "./db/prisma-conversation-history-repository";
import type { ConversationMessageAdmission, ConversationMessageAttachment, ConversationMessageAttachmentAdmissionFactory } from "./conversation-message-admission.types";
import { _CanonicalConversationMessageAssetIds } from "./conversation-message-admission.validator";
import { ConversationMessageActivations, ConversationMessageAdmissionOutcomes, type ConversationMessageAdmissionResult, type ConversationMessageCommand, type PrismaSelfConversationHistoryDependencies } from "./self-conversation-history.types";

/** Limits checked-append retries without silently dropping a contending participant message. */
const _APPEND_ATTEMPTS = 4;

/** Rolls back the SQL transaction when attachment authority disappears after earlier message writes. */
class ConversationMessageAttachmentUnavailableError extends Error {}

/** Commits one encrypted participant message and its selected artifacts before KurrentDB append. */
export class PrismaConversationMessageAdmissionUnitOfWork implements ConversationMessageAdmission
{
	/** KurrentDB read boundary used to recover a committed append. */
	private readonly historyReader: ConversationHistoryReader;

	/** Connects SQL admission, attachment binding and checked KurrentDB append. */
	public constructor(private readonly prisma: PrismaClient, private readonly historyStore: Pick<HistoryStore, "append" | "appendAtomic" | "readHead" | "readStream">, private readonly dependencies: PrismaSelfConversationHistoryDependencies, private readonly historyAuthority: ConversationHistoryAuthority, private readonly createAttachmentAdmission: ConversationMessageAttachmentAdmissionFactory)
	{
		this.historyReader = new ConversationHistoryReader(historyStore);
	}

	/**
	 * Admits one participant message and recovers retries without changing their saved content.
	 *
	 * The Serializable transaction checks conversation access, reads the conversation-wide retry
	 * winner, records authorization, stores ciphertext and binds or verifies attachments in that
	 * order. The shared unit-of-work runner retries only errors that prove PostgreSQL rolled back the
	 * entire attempt. KurrentDB append begins after commit. A stream conflict reloads history and
	 * accepts only the entry reconstructed from the saved ciphertext and attachment rows.
	 */
	public async post(caller: ConversationCaller, conversationId: string, command: ConversationMessageCommand): Promise<ConversationMessageAdmissionResult | null>
	{
		// 1. Validate identity and the ordered asset set before encryption or persistence.
		if (caller.externalIssuer === undefined || caller.verifiedAuthenticationAt === undefined)
			throw new Error("Conversation message admission requires verified requester evidence");
		const assetIds = _CanonicalConversationMessageAssetIds(command.assetIds);
		if (assetIds === null || !_SameStrings(assetIds, command.assetIds))
			throw new Error("Conversation message asset identifiers require canonical order");
		const payloadRef = randomUUID();
		const coordinates = { siloId: caller.siloId, conversationId, payloadRef, authorSubject: caller.subjectId };
		const cipher = this.dependencies.cipher;
		const createAttachmentAdmission = this.createAttachmentAdmission;
		// 2. Encrypt participant text before any repository receives the command.
		const payload = cipher.encrypt(command.text, coordinates);
		let stored: (AdmittedConversationMessagePayload & { readonly attachments: readonly ConversationMessageAttachment[] }) | null;
		try
		{
			// 3. Commit authorization, the payload winner and attachment bindings in one attempt.
			stored = await ___RunInPrismaUnitOfWork(this.prisma, async function _Transaction(transaction)
			{
				const repository = new PrismaConversationHistoryRepository(transaction);
				const admitted = await repository.admitMessagePayload(caller, conversationId, { idempotencyKey: command.idempotencyKey, activation: command.activation, assetIds, payloadRef, payload });
				if (admitted === null)
					return null;
				const priorText = cipher.decrypt(admitted.payload, admitted.payload.coordinates);
				if (!_SameText(priorText, command.text))
					throw new Error("Conversation message idempotency key was already used for different text");
				const attachments = await createAttachmentAdmission(transaction).bindOrVerify({ caller, conversationId, messageId: command.idempotencyKey, canonicalAssetIds: assetIds, payloadCreated: admitted.created });
				if (attachments === null)
					throw new ConversationMessageAttachmentUnavailableError("Conversation message attachment authority is unavailable");
				return { ...admitted, attachments: _AcceptedAttachments(assetIds, attachments.attachments) };
			}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, attemptLimit: 3, operation: "conversation message admission" });
		}
		catch (error)
		{
			if (error instanceof ConversationMessageAttachmentUnavailableError)
				return null;
			throw error;
		}
		if (stored === null)
			return null;
		// 4. Append the reconstructed entry or adopt the matching KurrentDB winner.
		return this._append(caller, conversationId, command, stored.projection, stored.payload, stored.attachments);
	}

	/** Appends or finds the immutable entry identified by the browser UUID. */
	private async _append(caller: ConversationCaller, conversationId: string, command: ConversationMessageCommand, projection: AuthorizedConversationProjection, payload: StoredConversationPrivatePayload, attachments: readonly ConversationMessageAttachment[]): Promise<ConversationMessageAdmissionResult>
	{
		for (let attempt = 0; attempt < _APPEND_ATTEMPTS; attempt += 1)
		{
			const history = await this.historyReader.read({ siloId: caller.siloId, conversationId });
			const existing = history.entries.find(entry => entry.id === command.idempotencyKey);
			if (existing !== undefined)
			{
				if (existing.kind !== ConversationEntryKinds.Message)
					throw new Error("Conversation message idempotency key was already used for a different command");
				const expected = _MessageEntry(caller, conversationId, command, projection, payload, attachments, existing.position, existing.occurredAt);
				const actualDigest = ___DigestCanonicalJson(existing as unknown as Parameters<typeof ___DigestCanonicalJson>[0]);
				const expectedDigest = ___DigestCanonicalJson(expected as unknown as Parameters<typeof ___DigestCanonicalJson>[0]);
				if (actualDigest !== expectedDigest)
					throw new Error("Conversation message idempotency key was already used for a different command");
				return { outcome: ConversationMessageAdmissionOutcomes.Idempotent, position: existing.position };
			}
			const expectedRevision = history.entries.length === 0 ? 0n : BigInt(history.entries.at(-1)!.position);
			const position = (expectedRevision + 1n).toString();
			const entry = _MessageEntry(caller, conversationId, command, projection, payload, attachments, position, new Date().toISOString());
			const result = await this._appendEntry(caller, conversationId, command, projection, entry, expectedRevision);
			if (result.outcome === ConversationHistoryAppendOutcomes.Appended)
				return { outcome: ConversationMessageAdmissionOutcomes.Accepted, position };
			if (await this._reauthorize(caller, conversationId) === null)
				throw new Error("Conversation message authority ended while resolving a stream conflict");
		}
		throw new Error("Conversation message stream remained contended");
	}

	/** Appends one message alone or atomically with a checked computer activation queue request. */
	private async _appendEntry(caller: ConversationCaller, conversationId: string, command: ConversationMessageCommand, projection: AuthorizedConversationProjection, entry: MessageEntry, expectedRevision: HistoryExpectedRevisions.NoStream | bigint)
	{
		if (command.activation === ConversationMessageActivations.None)
			return this.historyAuthority.append({ siloId: caller.siloId, conversationId, expectedRevision, entry });
		const current = await this.dependencies.computerReader.load({ computer: { siloId: caller.siloId, conversationId, computerId: projection.computerId!, agentIdentityId: projection.computerAgentIdentityId! }, profileRevisionId: projection.computerProfileRevisionId! });
		if (current === null || current.computer.leaseGeneration < 1)
			throw new Error("Conversation computer activation requires a current checked computer generation");
		let generation = current.computer.leaseGeneration;
		if (command.activation === ConversationMessageActivations.Start && (current.lease?.state === ComputerLeaseStates.Released || current.lease?.state === ComputerLeaseStates.Lost))
			generation += 1;
		const queueStreamName = `computer-activations-${caller.siloId}`;
		const queueHead = await this.historyStore.readHead(queueStreamName);
		if (queueHead.streamName !== queueStreamName)
			throw new Error("Conversation computer activation queue returned a foreign stream head");
		return this.historyAuthority.appendWithActivation({ siloId: caller.siloId, conversationId, expectedRevision, entry, activation: { computerId: current.computer.id, generation, eventId: _DeterministicUuid("conversation-activation", command.idempotencyKey), queueExpectedRevision: queueHead.revision ?? HistoryExpectedRevisions.NoStream } });
	}

	/** Rechecks current message authority after a contended stream append. */
	private _reauthorize(caller: ConversationCaller, conversationId: string)
	{
		return ___RunInPrismaUnitOfWork(this.prisma, async function _Transaction(transaction)
		{
			const repository = new PrismaConversationHistoryRepository(transaction);
			return await repository.authorizeWrite(caller, conversationId);
		}, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, operation: "conversation message reauthorization" });
	}
}

/** Builds the complete immutable entry with deterministic text and attachment block identifiers. */
function _MessageEntry(caller: ConversationCaller, conversationId: string, command: ConversationMessageCommand, projection: AuthorizedConversationProjection, payload: StoredConversationPrivatePayload, attachments: readonly ConversationMessageAttachment[], position: string, occurredAt: string): MessageEntry
{
	if (caller.externalIssuer === undefined || caller.verifiedAuthenticationAt === undefined)
		throw new Error("Conversation message admission requires verified requester evidence");
	const textBlock = { id: _DeterministicUuid("conversation-message-text-block", command.idempotencyKey), kind: ConversationMessageContentBlockKinds.Text, payloadRef: payload.coordinates.payloadRef, ciphertextDigest: payload.ciphertextDigest } as const;
	const artifactBlocks = attachments.map(function _ArtifactBlock(attachment): ArtifactMessageContentBlock
	{
		return { id: _DeterministicUuid("conversation-message-artifact-block", command.idempotencyKey, attachment.assetId), kind: ConversationMessageContentBlockKinds.Artifact, artifactId: attachment.artifactId, artifactRevisionId: attachment.artifactRevisionId, name: attachment.name, mediaType: attachment.mediaType };
	});
	return { schemaVersion: 1, id: command.idempotencyKey, conversationId, position, author: { kind: ConversationAuthorKinds.Human, principalId: caller.principalId, participantId: caller.subjectId, issuer: caller.externalIssuer, authenticatedAt: caller.verifiedAuthenticationAt, name: projection.authorName, avatarArtifactRevisionId: null }, provenance: "human-authored", visibility: { audience: "conversation" }, runId: null, causationId: command.idempotencyKey, correlationId: command.idempotencyKey, idempotencyKey: command.idempotencyKey, occurredAt, attestation: null, kind: ConversationEntryKinds.Message, state: "completed", blocks: [textBlock, ...artifactBlocks], replyToEntryId: null, addressedAgentIdentityId: projection.computerAgentIdentityId, activation: command.activation };
}

/** Rejects malformed, missing, duplicated or reordered metadata returned by the attachment port. */
function _AcceptedAttachments(assetIds: readonly string[], attachments: readonly ConversationMessageAttachment[]): readonly ConversationMessageAttachment[]
{
	if (attachments.length !== assetIds.length)
		throw new Error("Conversation message attachment result does not match its selected assets");
	for (let index = 0; index < assetIds.length; index += 1)
	{
		const attachment = attachments[index]!;
		if (attachment.assetId !== assetIds[index] || !_BoundedValue(attachment.artifactId, 128) || !_BoundedValue(attachment.artifactRevisionId, 128) || !_BoundedValue(attachment.name, 255) || !_BoundedValue(attachment.mediaType, 255))
			throw new Error("Conversation message attachment result does not match its selected assets");
	}
	return attachments;
}

/** Checks a nonblank UTF-8 value before it enters immutable history. */
function _BoundedValue(value: string, maximumBytes: number): boolean
{
	return value.trim().length > 0 && Buffer.byteLength(value, "utf8") <= maximumBytes;
}

/** Compares retry plaintext without an early-return timing signal. */
function _SameText(left: string, right: string): boolean
{
	const leftBytes = Buffer.from(left, "utf8");
	const rightBytes = Buffer.from(right, "utf8");
	return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

/** Compares two already-bounded string sequences without reordering either side. */
function _SameStrings(left: readonly string[], right: readonly string[]): boolean
{
	return left.length === right.length && left.every(function _Same(value, index) { return value === right[index]; });
}
