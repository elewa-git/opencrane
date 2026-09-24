import { readFileSync, statSync } from "node:fs";

import { HmacMcpConnectionMaterialVerifier } from "./mcp-connection-material-verifier";
import type { McpConnectionMaterialVerifier } from "./mcp-connection.types";
import { ___McpConnectionMaterialVerifierKeyringSchema } from "./mcp-connection-material-verifier.validator";

const _MAX_KEYRING_BYTES = 64 * 1024;
const _INVALID_KEYRING_MESSAGE = "MCP connection material keyring is unavailable or invalid.";

/** Read one complete keyring without exposing file or parser failures. */
function _ReadMcpConnectionMaterialVerifier(path: string): HmacMcpConnectionMaterialVerifier
{
	try
	{
		const size = statSync(path).size;
		if (size < 1 || size > _MAX_KEYRING_BYTES)
			throw new Error(_INVALID_KEYRING_MESSAGE);
		const contents = readFileSync(path, "utf8");
		if (Buffer.byteLength(contents, "utf8") > _MAX_KEYRING_BYTES)
			throw new Error(_INVALID_KEYRING_MESSAGE);
		const parsed = ___McpConnectionMaterialVerifierKeyringSchema.safeParse(JSON.parse(contents));
		if (!parsed.success)
			throw new Error(_INVALID_KEYRING_MESSAGE);
		return new HmacMcpConnectionMaterialVerifier(parsed.data);
	}
	catch
	{
		throw new Error(_INVALID_KEYRING_MESSAGE);
	}
}

/**
 * Read the mounted MCP keyring for every verifier operation.
 *
 * Construction validates the initial file so the process fails before accepting traffic. Later reads
 * use one complete snapshot per operation, which lets a mounted Secret rotate its current key while
 * retained keys continue to verify earlier commands. An invalid replacement fails the operation;
 * the verifier never falls back to key material cached at startup.
 */
export function _CreateFileBackedMcpConnectionMaterialVerifier(path: string): McpConnectionMaterialVerifier
{
	_ReadMcpConnectionMaterialVerifier(path);
	return {
		current(material)
		{
			return _ReadMcpConnectionMaterialVerifier(path).current(material);
		},
		verify(keyId, material, expected)
		{
			return _ReadMcpConnectionMaterialVerifier(path).verify(keyId, material, expected);
		},
	};
}
