import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { MountedConversationPayloadCipher } from "../mounted-conversation-payload-cipher";
import type { ConversationPayloadAssociatedData } from "../conversation-payload-cipher.types";

/** Tracks temporary Secret projections created by this suite. */
const _TemporaryDirectories: string[] = [];

/** Creates one isolated mounted keyring fixture with a valid AES-256 key. */
async function _Keyring(encodedKey: string = randomBytes(32).toString("base64")): Promise<string>
{
	const directory = await mkdtemp(join(tmpdir(), "opencrane-conversation-payload-"));
	_TemporaryDirectories.push(directory);
	const path = join(directory, "keyring.json");
	await writeFile(path, JSON.stringify({ activeKeyId: "key-1", keys: { "key-1": encodedKey } }), "utf8");
	return path;
}

/** Supplies one fully server-derived payload identity for cipher tests. */
function _AssociatedData(): ConversationPayloadAssociatedData
{
	return { formatVersion: "conversation-payload/v1", siloId: "silo-1", conversationId: "conversation-1", idempotencyKey: "command-1", plaintextDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" };
}

describe("MountedConversationPayloadCipher", function _MountedConversationPayloadCipher()
{
	afterEach(async function _RemoveTemporaryDirectories()
	{
		await Promise.all(_TemporaryDirectories.splice(0).map(function _RemoveDirectory(directory) { return rm(directory, { recursive: true, force: true }); }));
	});

	it("decrypts only payload bytes bound to their exact server-derived coordinates", async function _ExactCoordinates()
	{
		const cipher = new MountedConversationPayloadCipher(await _Keyring());
		const associatedData = _AssociatedData();
		const sealed = await cipher.seal(Buffer.from("private agent reply", "utf8"), associatedData);
		expect(Buffer.from(await cipher.open(sealed, associatedData)).toString("utf8")).toBe("private agent reply");
		await expect(cipher.open(sealed, { ...associatedData, idempotencyKey: "command-2" })).rejects.toThrow();
		await expect(cipher.open(sealed, { ...associatedData, conversationId: "conversation-2" })).rejects.toThrow();
	});

	it("rejects construction without a Secret-mounted absolute path", function _AbsolutePath()
	{
		expect(function _CreateCipher() { return new MountedConversationPayloadCipher("keyring.json"); }).toThrow("conversation payload keyring path must be absolute");
	});

	it("rejects non-canonical base64 that Node would otherwise decode", async function _NonCanonicalKey()
	{
		const keyringPath = await _Keyring(`${randomBytes(32).toString("base64")}#`);
		const cipher = new MountedConversationPayloadCipher(keyringPath);
		await expect(cipher.seal(Buffer.from("private agent reply", "utf8"), _AssociatedData())).rejects.toThrow("conversation payload key must be canonical 256-bit base64");
	});

	it("rejects a malformed retained key before it can break an old ciphertext read", async function _MalformedRetainedKey()
	{
		const keyringPath = await _Keyring();
		await writeFile(keyringPath, JSON.stringify({ activeKeyId: "key-1", keys: { "key-1": randomBytes(32).toString("base64"), "key-old": `${randomBytes(32).toString("base64")}#` } }), "utf8");
		const cipher = new MountedConversationPayloadCipher(keyringPath);
		await expect(cipher.seal(Buffer.from("private agent reply", "utf8"), _AssociatedData())).rejects.toThrow("conversation payload key must be canonical 256-bit base64");
	});

	it("retains a previous canonical key for stored payload decryption after rotation", async function _KeyRotation()
	{
		const firstKey = randomBytes(32).toString("base64");
		const keyringPath = await _Keyring(firstKey);
		const cipher = new MountedConversationPayloadCipher(keyringPath);
		const associatedData = _AssociatedData();
		const sealed = await cipher.seal(Buffer.from("private agent reply", "utf8"), associatedData);
		await writeFile(keyringPath, JSON.stringify({ activeKeyId: "key-2", keys: { "key-1": firstKey, "key-2": randomBytes(32).toString("base64") } }), "utf8");
		expect(Buffer.from(await cipher.open(sealed, associatedData)).toString("utf8")).toBe("private agent reply");
	});

	it("rejects altered ciphertext before a private payload can be returned", async function _AlteredCiphertext()
	{
		const cipher = new MountedConversationPayloadCipher(await _Keyring());
		const associatedData = _AssociatedData();
		const sealed = await cipher.seal(Buffer.from("private agent reply", "utf8"), associatedData);
		const alteredCiphertext = Uint8Array.from(sealed.ciphertext);
		alteredCiphertext[0] ^= 1;
		await expect(cipher.open({ ...sealed, ciphertext: alteredCiphertext }, associatedData)).rejects.toThrow();
	});
});
