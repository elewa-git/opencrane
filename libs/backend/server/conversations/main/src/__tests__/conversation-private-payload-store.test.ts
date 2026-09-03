import type { ConversationPayloadAssociatedData, ConversationPayloadCipher, SealedConversationPayload } from "@opencrane/backend/server/infra/conversation-payloads";
import { describe, expect, it } from "vitest";

import { ConversationPrivatePayloadStore } from "../conversation-private-payload-store";
import type { ConversationPrivatePayloadRecord, ConversationPrivatePayloadRepository, ConversationPrivatePayloadStoreCommand } from "../conversation-private-payload-store.types";

/** Records cipher calls while returning deterministic sealed bytes for store assertions. */
class _Cipher implements ConversationPayloadCipher
{
	/** Counts encryption attempts so exact retries cannot silently re-encrypt a payload. */
	public sealCalls = 0;
	/** Captures the exact ownership coordinates authenticated with the ciphertext. */
	public associatedData: ConversationPayloadAssociatedData | null = null;
	/** Captures the exact ownership coordinates used for a protected read. */
	public openedAssociatedData: ConversationPayloadAssociatedData | null = null;

	/** Seals deterministic test bytes after recording the caller's associated data. */
	async seal(_plaintext: Uint8Array, associatedData: ConversationPayloadAssociatedData): Promise<SealedConversationPayload>
	{
		this.sealCalls += 1;
		this.associatedData = associatedData;
		return { keyId: "key-1", ciphertext: Uint8Array.of(1, 2, 3), nonce: Uint8Array.of(4), authenticationTag: Uint8Array.of(5) };
	}

	/** Returns the fixture body after recording the server-derived decryption coordinates. */
	async open(_sealed: SealedConversationPayload, associatedData: ConversationPayloadAssociatedData): Promise<Uint8Array>
	{
		this.openedAssociatedData = associatedData;
		return Buffer.from("Private agent reply", "utf8");
	}
}

/** Models the database uniqueness key in memory for one storage authority test. */
class _Repository implements ConversationPrivatePayloadRepository
{
	/** Holds the first record accepted for each exact private-payload owner key. */
	private readonly records = new Map<string, ConversationPrivatePayloadRecord>();

	/** Finds the first record for one exact durable owner key. */
	async find(command: Pick<ConversationPrivatePayloadStoreCommand, "siloId" | "conversationId" | "idempotencyKey">): Promise<ConversationPrivatePayloadRecord | null>
	{
		return this.records.get(_Key(command)) ?? null;
	}

	/** Finds the one record whose opaque reference would carry this generated UUID. */
	async findById(id: string): Promise<ConversationPrivatePayloadRecord | null>
	{
		return Array.from(this.records.values()).find(record => record.id === id) ?? null;
	}

	/** Inserts only the first record for one exact durable owner key. */
	async createIfAbsent(record: ConversationPrivatePayloadRecord): Promise<void>
	{
		this.records.set(_Key(record), this.records.get(_Key(record)) ?? record);
	}
}

/** Derives the in-memory mirror of the database's composite uniqueness coordinates. */
function _Key(command: Pick<ConversationPrivatePayloadStoreCommand, "siloId" | "conversationId" | "idempotencyKey">): string
{
	return `${command.siloId}/${command.conversationId}/${command.idempotencyKey}`;
}

/** Supplies one server-derived payload request. */
function _Command(text: string = "Private agent reply"): ConversationPrivatePayloadStoreCommand
{
	return { siloId: "silo-1", conversationId: "conversation-1", idempotencyKey: "command-1", text };
}

describe("ConversationPrivatePayloadStore", function _ConversationPrivatePayloadStore()
{
	it("stores one encrypted winner and returns only its opaque history coordinates", async function _StoreWinner()
	{
		const cipher = new _Cipher();
		const store = new ConversationPrivatePayloadStore(new _Repository(), cipher);
		const stored = await store.storeText(_Command());
		expect(stored.payloadRef).toMatch(/^payload:\/\/[A-Za-z0-9-]+$/u);
		expect(stored.ciphertextDigest).toBe("sha256:039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81");
		expect(cipher.associatedData).toMatchObject({ siloId: "silo-1", conversationId: "conversation-1", idempotencyKey: "command-1" });
	});

	it("returns the first exact winner without encrypting a retry again", async function _ExactRetry()
	{
		const cipher = new _Cipher();
		const store = new ConversationPrivatePayloadStore(new _Repository(), cipher);
		const first = await store.storeText(_Command());
		const retry = await store.storeText(_Command());
		expect(retry).toEqual(first);
		expect(cipher.sealCalls).toBe(1);
	});

	it("rejects changed text reused under an existing durable command key", async function _ChangedRetry()
	{
		const cipher = new _Cipher();
		const store = new ConversationPrivatePayloadStore(new _Repository(), cipher);
		await store.storeText(_Command());
		await expect(store.storeText(_Command("Changed agent reply"))).rejects.toThrow("Conversation private payload idempotency key already owns different text");
		expect(cipher.sealCalls).toBe(1);
	});

	it("redeems only a row whose opaque reference, owner key, and ciphertext digest all match", async function _RedeemsExactPayload()
	{
		const cipher = new _Cipher();
		const store = new ConversationPrivatePayloadStore(new _Repository(), cipher);
		const stored = await store.storeText(_Command());

		await expect(store.readText({ siloId: "silo-1", conversationId: "conversation-1", idempotencyKey: "command-1", payloadRef: stored.payloadRef, ciphertextDigest: stored.ciphertextDigest })).resolves.toBe("Private agent reply");
		expect(cipher.openedAssociatedData).toMatchObject({ siloId: "silo-1", conversationId: "conversation-1", idempotencyKey: "command-1" });
	});

	it("refuses a copied payload reference before decrypting its body", async function _RefusesCopiedPayload()
	{
		const cipher = new _Cipher();
		const store = new ConversationPrivatePayloadStore(new _Repository(), cipher);
		const stored = await store.storeText(_Command());

		await expect(store.readText({ siloId: "silo-1", conversationId: "conversation-2", idempotencyKey: "command-1", payloadRef: stored.payloadRef, ciphertextDigest: stored.ciphertextDigest })).rejects.toThrow("Conversation private payload does not match its command");
		expect(cipher.openedAssociatedData).toBeNull();
	});
});
