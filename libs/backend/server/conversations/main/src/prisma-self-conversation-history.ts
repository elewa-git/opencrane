import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

import { ConversationMode, Prisma, type PrismaClient } from "@prisma/client";
import { HistoryExpectedRevisions, type HistoryStore } from "@opencrane/backend/server/infra/history-store";
import type { ConversationEntry, MessageEntry } from "@opencrane/contracts";

import { ConversationHistoryAuthority } from "./conversation-history-authority";
import { ConversationHistoryAppendOutcomes } from "./conversation-history-authority.types";
import { ConversationHistoryReader } from "./conversation-history-reader";
import type { ConversationCaller } from "./types/conversation-caller.types";
import { PrismaConversationHistoryRepository } from "./db/prisma-conversation-history-repository";
import type { AuthorizedConversationProjection, StoredConversationPrivatePayload } from "./db/prisma-conversation-history-repository.types";
import { ConversationMessageActivations, ConversationMessageAdmissionOutcomes, type ConversationMessageAdmissionResult, type ConversationMessageCommand, type PrismaSelfConversationHistoryDependencies, type SelfConversationHistoryAuthority, type SelfConversationHistoryResult } from "./self-conversation-history.types";

/** Limits checked-append retries without silently dropping a contending participant message. */
const _APPEND_ATTEMPTS = 4;

/** Participant authority joining PostgreSQL policy and encrypted payloads to KurrentDB history. */
export class PrismaSelfConversationHistory implements SelfConversationHistoryAuthority
{
	/** KurrentDB append boundary that accepts only complete server-stamped entries. */
	private readonly historyAuthority: ConversationHistoryAuthority;
	/** KurrentDB read boundary that validates every immutable event envelope. */
	private readonly historyReader: ConversationHistoryReader;

	/** Connects the authority to its transaction owner, HistoryStore, payload cipher, and computer reader. */
	public constructor(private readonly prisma: PrismaClient, private readonly historyStore: Pick<HistoryStore, "append" | "appendAtomic" | "readHead" | "readStream">, private readonly dependencies: PrismaSelfConversationHistoryDependencies)
	{
		this.historyAuthority = new ConversationHistoryAuthority(historyStore);
		this.historyReader = new ConversationHistoryReader(historyStore);
	}

	/** Rechecks participant access around one KurrentDB read and decrypts only referenced visible payloads. */
	public async read(caller: ConversationCaller, conversationId: string, afterPosition?: bigint): Promise<SelfConversationHistoryResult | null>
	{
		// 1. Check current membership and participant authority before accessing immutable history.
		const projection = await this._transaction(function _Authorize(repository) { return repository.authorizeRead(caller, conversationId); });
		if (projection === null)
			return null;
		// 2. Read from the position after the exclusive browser cursor and filter subset visibility.
		const fromRevision = afterPosition === undefined ? undefined : afterPosition + 1n;
		const history = await this.historyReader.read(fromRevision === undefined ? { siloId: caller.siloId, conversationId } : { siloId: caller.siloId, conversationId, fromRevision });
		const entries = history.entries.filter(function _Visible(entry) { return _MaySee(entry, caller.subjectId); });
		const payloadRefs = _PayloadRefs(entries);
		// 3. Recheck access while loading ciphertext so revocation cannot turn an old authorization into plaintext access.
		const stored = await this._transaction(async function _ReadPayloads(repository)
		{
			if (await repository.authorizeRead(caller, conversationId) === null)
				return null;
			return repository.readPayloads(caller, conversationId, payloadRefs);
		});
		if (stored === null)
			return null;
		const payloads = this._decrypt(payloadRefs, stored);
		const computer = await this._computer(caller, conversationId, projection);
		const nextPosition = entries.at(-1)?.position ?? afterPosition?.toString() ?? "0";
		return { entries, payloads, nextPosition, computer };
	}

	/** Encrypts a participant message and appends its opaque reference at a checked KurrentDB head. */
	public async postMessage(caller: ConversationCaller, conversationId: string, command: ConversationMessageCommand): Promise<ConversationMessageAdmissionResult | null>
	{
		// 1. Recheck current membership, participant state, lifecycle, and product Use authority.
		const projection = await this._transaction(function _Authorize(repository) { return repository.authorizeWrite(caller, conversationId); });
		if (projection === null)
			return null;
		if (projection.mode !== ConversationMode.AgentSession && command.activation !== "none")
			throw new Error("Direct and group conversation messages cannot activate a computer");
		if (command.activation === ConversationMessageActivations.Interrupt)
			throw new Error("Conversation computer interrupt authority is unavailable");
		// 2. Encrypt before persistence, then let the serializable payload transaction select the winning retry row.
		const payloadRef = randomUUID();
		const coordinates = { siloId: caller.siloId, conversationId, payloadRef, authorSubject: caller.subjectId };
		const encrypted = this.dependencies.cipher.encrypt(command.text, coordinates);
		const stored = await this._transaction(function _Store(repository) { return repository.createOrReadPayload(caller, conversationId, command.idempotencyKey, payloadRef, encrypted); }, Prisma.TransactionIsolationLevel.Serializable);
		const priorText = this.dependencies.cipher.decrypt(stored.payload, stored.payload.coordinates);
		if (!_SameText(priorText, command.text))
			throw new Error("Conversation message idempotency key was already used for different text");
		// 3. Append at a freshly observed head, retrying only checked conflicts from other valid writers.
		return this._append(caller, conversationId, command, projection, stored.payload);
	}

	/** Appends or finds the one immutable entry identified by the browser UUID. */
	private async _append(caller: ConversationCaller, conversationId: string, command: ConversationMessageCommand, projection: AuthorizedConversationProjection, payload: StoredConversationPrivatePayload): Promise<ConversationMessageAdmissionResult>
	{
		for (let attempt = 0; attempt < _APPEND_ATTEMPTS; attempt += 1)
		{
			const history = await this.historyReader.read({ siloId: caller.siloId, conversationId });
			const existing = history.entries.find(entry => entry.id === command.idempotencyKey);
			if (existing !== undefined)
				return { outcome: ConversationMessageAdmissionOutcomes.Idempotent, position: existing.position };
			const expectedRevision = history.entries.length === 0 ? 0n : BigInt(history.entries.at(-1)!.position);
			const position = (expectedRevision + 1n).toString();
			const entry = _MessageEntry(caller, conversationId, command, projection, payload, position);
			const result = await this._appendEntry(caller, conversationId, command, projection, entry, expectedRevision);
			if (result.outcome === ConversationHistoryAppendOutcomes.Appended)
				return { outcome: ConversationMessageAdmissionOutcomes.Accepted, position };
			if (await this._transaction(function _Reauthorize(repository) { return repository.authorizeWrite(caller, conversationId); }) === null)
				throw new Error("Conversation message authority ended while resolving a stream conflict");
		}
		throw new Error("Conversation message stream remained contended");
	}

	/** Appends one message alone or atomically with a checked computer activation queue request. */
	private async _appendEntry(caller: ConversationCaller, conversationId: string, command: ConversationMessageCommand, projection: AuthorizedConversationProjection, entry: MessageEntry, expectedRevision: HistoryExpectedRevisions.NoStream | bigint)
	{
		if (command.activation === ConversationMessageActivations.None)
			return this.historyAuthority.append({ siloId: caller.siloId, conversationId, expectedRevision, entry });
		const current = await this.dependencies.computerReader.load({ siloId: caller.siloId, conversationId, computerId: projection.computerId!, agentIdentityId: projection.computerAgentIdentityId!, profileRevisionId: projection.computerProfileRevisionId! });
		if (current === null || current.computer.leaseGeneration < 1)
			throw new Error("Conversation computer activation requires a current checked computer generation");
		const queueStreamName = `computer-activations-${caller.siloId}`;
		const queueHead = await this.historyStore.readHead(queueStreamName);
		if (queueHead.streamName !== queueStreamName)
			throw new Error("Conversation computer activation queue returned a foreign stream head");
		return this.historyAuthority.appendWithActivation({ siloId: caller.siloId, conversationId, expectedRevision, entry, activation: { computerId: current.computer.id, generation: current.computer.leaseGeneration, eventId: _ActivationEventId(command.idempotencyKey), queueExpectedRevision: queueHead.revision ?? HistoryExpectedRevisions.NoStream } });
	}

	/** Loads an agent conversation's current checked computer or returns null outside agent mode. */
	private async _computer(caller: ConversationCaller, conversationId: string, projection: AuthorizedConversationProjection)
	{
		if (projection.mode !== ConversationMode.AgentSession)
			return null;
		const current = await this.dependencies.computerReader.load({ siloId: caller.siloId, conversationId, computerId: projection.computerId!, agentIdentityId: projection.computerAgentIdentityId!, profileRevisionId: projection.computerProfileRevisionId! });
		if (current === null)
			throw new Error("Agent conversation computer history is unavailable");
		return current.computer;
	}

	/** Decrypts every referenced payload exactly once and fails on missing or surplus ciphertext. */
	private _decrypt(payloadRefs: readonly string[], stored: readonly StoredConversationPrivatePayload[]): Readonly<Record<string, string>>
	{
		const expected = new Set(payloadRefs);
		const payloads: Record<string, string> = {};
		for (const payload of stored)
		{
			if (!expected.delete(payload.coordinates.payloadRef))
				throw new Error("Conversation history loaded an unreferenced private payload");
			payloads[payload.coordinates.payloadRef] = this.dependencies.cipher.decrypt(payload, payload.coordinates);
		}
		if (expected.size > 0)
			throw new Error("Conversation history references a missing private payload");
		return payloads;
	}

	/** Runs one repository operation in the requested PostgreSQL isolation level. */
	private _transaction<Result>(work: (repository: PrismaConversationHistoryRepository) => Promise<Result>, isolationLevel: Prisma.TransactionIsolationLevel = Prisma.TransactionIsolationLevel.RepeatableRead): Promise<Result>
	{
		return this.prisma.$transaction(async function _Transaction(transaction) { return work(new PrismaConversationHistoryRepository(transaction)); }, { isolationLevel });
	}
}

/** Creates a complete human-authored message entry without embedding plaintext. */
function _MessageEntry(caller: ConversationCaller, conversationId: string, command: ConversationMessageCommand, projection: AuthorizedConversationProjection, payload: StoredConversationPrivatePayload, position: string): MessageEntry
{
	return { schemaVersion: 1, id: command.idempotencyKey, conversationId, position, author: { kind: "human", principalId: caller.principalId, participantId: caller.subjectId, name: projection.authorName, avatarArtifactRevisionId: null }, provenance: "human-authored", visibility: { audience: "conversation" }, runId: null, causationId: command.idempotencyKey, correlationId: command.idempotencyKey, idempotencyKey: command.idempotencyKey, occurredAt: new Date().toISOString(), attestation: null, kind: "message", state: "completed", blocks: [{ id: randomUUID(), kind: "text", payloadRef: payload.coordinates.payloadRef, ciphertextDigest: payload.ciphertextDigest }], replyToEntryId: null, addressedAgentIdentityId: projection.computerAgentIdentityId, activation: command.activation };
}

/** Returns whether an entry's immutable visibility includes this participant. */
function _MaySee(entry: ConversationEntry, subjectId: string): boolean
{
	return entry.visibility.audience === "conversation" || entry.visibility.participantIds.includes(subjectId);
}

/** Collects private text and A2UI payload references without altering the immutable entries. */
function _PayloadRefs(entries: readonly ConversationEntry[]): readonly string[]
{
	const references = entries.flatMap(function _EntryReferences(entry)
	{
		if (entry.kind === "message")
			return entry.blocks.flatMap(block => block.kind === "text" ? [block.payloadRef] : []);
		if (entry.kind === "a2ui" && entry.payloadRef !== null)
			return [entry.payloadRef];
		return [];
	});
	return [...new Set(references)];
}

/** Compares retry plaintext without an early-return timing signal. */
function _SameText(left: string, right: string): boolean
{
	const leftBytes = Buffer.from(left, "utf8");
	const rightBytes = Buffer.from(right, "utf8");
	return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

/** Derives a stable UUID-shaped activation event id from the immutable message retry key. */
function _ActivationEventId(messageId: string): string
{
	const bytes = Buffer.from(createHash("sha256").update(`conversation-activation:${messageId}`, "utf8").digest().subarray(0, 16));
	bytes[6] = (bytes[6]! & 0x0f) | 0x50;
	bytes[8] = (bytes[8]! & 0x3f) | 0x80;
	const hex = bytes.toString("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
