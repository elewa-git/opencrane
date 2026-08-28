import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { MountedRuntimeContinuationCipher } from "../mounted-runtime-continuation-cipher";

/** Write a small rotating keyring fixture into a fresh temporary directory. */
async function _Keyring(): Promise<{ readonly path: string; readonly first: string; readonly second: string }>
{
	const directory = await mkdtemp(join(tmpdir(), "opencrane-continuation-keyring-"));
	const path = join(directory, "keyring.json");
	const first = Buffer.alloc(32, 1).toString("base64");
	const second = Buffer.alloc(32, 2).toString("base64");
	await writeFile(path, JSON.stringify({ activeKeyId: "key-1", keys: { "key-1": first, "key-2": second } }), "utf8");
	return { path, first, second };
}

describe("mounted runtime continuation cipher", function _Suite()
{
	it("round-trips only with the exact associated data", async function _RoundTrip()
	{
		const keyring = await _Keyring();
		const cipher = new MountedRuntimeContinuationCipher(keyring.path);
		const associatedData = { formatVersion: "continuation/v1", runId: "run-1", attempt: 1, inputGeneration: 2, revision: 3 };
		const sealed = await cipher.seal(Buffer.from("secret continuation", "utf8"), associatedData);
		expect(Buffer.from(await cipher.open(sealed, associatedData)).toString("utf8")).toBe("secret continuation");
		await expect(cipher.open(sealed, { ...associatedData, revision: 4 })).rejects.toThrow();
	});

	it("re-reads the mounted keyring and retains old key decryption", async function _Rotation()
	{
		const keyring = await _Keyring();
		const cipher = new MountedRuntimeContinuationCipher(keyring.path);
		const associatedData = { formatVersion: "continuation/v1", runId: "run-1", attempt: 1, inputGeneration: 0, revision: 1 };
		const oldSealed = await cipher.seal(Buffer.from("old", "utf8"), associatedData);
		await writeFile(keyring.path, JSON.stringify({ activeKeyId: "key-2", keys: { "key-1": keyring.first, "key-2": keyring.second } }), "utf8");
		const newSealed = await cipher.seal(Buffer.from("new", "utf8"), associatedData);
		expect(oldSealed.keyId).toBe("key-1");
		expect(newSealed.keyId).toBe("key-2");
		expect(Buffer.from(await cipher.open(oldSealed, associatedData)).toString("utf8")).toBe("old");
	});
});
