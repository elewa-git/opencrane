import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { _CreateFileBackedMcpConnectionMaterialVerifier } from "../load-mcp-connection-material-verifier";

const _SECRET = Buffer.alloc(32, 7).toString("base64");

describe("MCP connection material verifier keyring", () =>
{
	const folders: string[] = [];

	afterEach(() =>
	{
		for (const folder of folders)
			rmSync(folder, { recursive: true, force: true });
	});

	it("loads retained keys and verifies only the matching material", () =>
	{
		const path = _WriteKeyring({ currentKeyId: "key-2", keys: [
			{ id: "key-1", secretBase64: Buffer.alloc(32, 3).toString("base64") },
			{ id: "key-2", secretBase64: _SECRET },
		] });
		const verifier = _CreateFileBackedMcpConnectionMaterialVerifier(path);
		const current = verifier.current("bearer-material");

		expect(current.keyId).toBe("key-2");
		expect(verifier.verify(current.keyId, "bearer-material", current.verifier)).toBe(true);
		expect(verifier.verify(current.keyId, "different-material", current.verifier)).toBe(false);
		expect(verifier.verify("missing", "bearer-material", current.verifier)).toBe(false);
	});

	it.each([
		["missing file", undefined],
		["malformed JSON", "{secret-token"],
		["invalid document", JSON.stringify({ currentKeyId: "key-1", keys: [] })],
		["oversized document", "x".repeat((64 * 1024) + 1)],
	])("returns one fixed error for %s", (_case, contents) =>
	{
		const folder = mkdtempSync(join(tmpdir(), "opencrane-mcp-keyring-"));
		folders.push(folder);
		const path = join(folder, "material.json");
		if (contents !== undefined)
			writeFileSync(path, contents, "utf8");

		expect(() => _CreateFileBackedMcpConnectionMaterialVerifier(path)).toThrow("MCP connection material keyring is unavailable or invalid.");
	});

	it("adopts a rotated current key while retaining earlier verification keys", () =>
	{
		const oldSecret = Buffer.alloc(32, 3).toString("base64");
		const path = _WriteKeyring({ currentKeyId: "key-1", keys: [{ id: "key-1", secretBase64: oldSecret }] });
		const verifier = _CreateFileBackedMcpConnectionMaterialVerifier(path);
		const earlier = verifier.current("earlier-material");

		writeFileSync(path, JSON.stringify({ currentKeyId: "key-2", keys: [
			{ id: "key-1", secretBase64: oldSecret },
			{ id: "key-2", secretBase64: _SECRET },
		] }), "utf8");
		const current = verifier.current("current-material");

		expect(current.keyId).toBe("key-2");
		expect(verifier.verify(earlier.keyId, "earlier-material", earlier.verifier)).toBe(true);
	});

	it("rejects an invalid replacement instead of using the startup keyring", () =>
	{
		const path = _WriteKeyring({ currentKeyId: "key-1", keys: [{ id: "key-1", secretBase64: _SECRET }] });
		const verifier = _CreateFileBackedMcpConnectionMaterialVerifier(path);
		const earlier = verifier.current("earlier-material");

		writeFileSync(path, JSON.stringify({ currentKeyId: "key-2", keys: [] }), "utf8");

		expect(() => verifier.current("new-material")).toThrow("MCP connection material keyring is unavailable or invalid.");
		expect(() => verifier.verify(earlier.keyId, "earlier-material", earlier.verifier)).toThrow("MCP connection material keyring is unavailable or invalid.");
	});

	function _WriteKeyring(value: unknown): string
	{
		const folder = mkdtempSync(join(tmpdir(), "opencrane-mcp-keyring-"));
		folders.push(folder);
		const path = join(folder, "material.json");
		writeFileSync(path, JSON.stringify(value), "utf8");
		return path;
	}
});
