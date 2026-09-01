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

	/** Seals deterministic test bytes after recording the caller's associated data. */
	async seal(_plaintext: Uint8Array, associatedData: ConversationPayloadAssociatedData): Promise<SealedConversationPayload>
	{
		this.sealCalls += 1;
		this.associatedData = associatedData;
		return { keyId: "key-1", ciphertext: Uint8Array.of(1, 2, 3), nonce: Uint8Array.of(4), authenticationTag: Uint8Array.of(5) };
	}

	/** Satisfies the cipher port; this store-only suite never reads ciphertext. */
	async open(_sealed: SealedConversationPayload, _associatedData: ConversationPayloadAssociatedData): Promise<Uint8Array>
	{
		return new Uint8Array();
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
});
