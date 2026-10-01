import { Buffer } from "node:buffer";
import { createHmac, timingSafeEqual } from "node:crypto";

import type { McpConnectionMaterialVerifier } from "./mcp-connection.types";
import type { McpConnectionMaterialVerifierKeyringConfig } from "./mcp-connection-material-verifier.types";
import { ___McpConnectionMaterialVerifierKeyringSchema } from "./mcp-connection-material-verifier.validator";

const _DOMAIN = "opencrane:mcp-connection-material:v1\0";

/** HMAC verifier backed only by the dedicated MCP connection keyring. */
export class HmacMcpConnectionMaterialVerifier implements McpConnectionMaterialVerifier
{
	private readonly _currentKeyId: string;
	private readonly _keys: ReadonlyMap<string, Buffer>;

	constructor(config: McpConnectionMaterialVerifierKeyringConfig)
	{
		const parsed = ___McpConnectionMaterialVerifierKeyringSchema.safeParse(config);
		if (!parsed.success)
			throw new Error("MCP connection material keyring is invalid.");
		const entries = parsed.data.keys.map(function _Decode(key): readonly [string, Buffer]
		{
			const decoded = Buffer.from(key.secretBase64, "base64");
			if (decoded.length < 32 || decoded.length > 128 || decoded.toString("base64") !== key.secretBase64)
				throw new Error("MCP connection material keyring is invalid.");
			return [key.id, decoded] as const;
		});
		this._currentKeyId = parsed.data.currentKeyId;
		this._keys = new Map(entries);
	}

	current(material: string): { readonly keyId: string; readonly verifier: `hmac-sha256:${string}` }
	{
		const key = this._keys.get(this._currentKeyId);
		if (!key)
			throw new Error("MCP connection material keyring has no current key.");
		return { keyId: this._currentKeyId, verifier: _Verifier(key, material) };
	}

	verify(keyId: string, material: string, expected: `hmac-sha256:${string}`): boolean
	{
		const key = this._keys.get(keyId);
		if (!key)
			return false;
		const actual = _Verifier(key, material);
		const actualBytes = Buffer.from(actual);
		const expectedBytes = Buffer.from(expected);
		return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
	}
}

function _Verifier(key: Buffer, material: string): `hmac-sha256:${string}`
{
	const digest = createHmac("sha256", key).update(_DOMAIN).update(material, "utf8").digest("hex");
	return `hmac-sha256:${digest}`;
}
