/** One active or retained HMAC key loaded from the dedicated MCP material keyring. */
export interface McpConnectionMaterialVerifierKey
{
	/** Stable identifier stored beside each verifier so key rotation preserves replay checks. */
	readonly id: string;
	/** Base64-encoded random key material held only by server configuration. */
	readonly secretBase64: string;
}

/** Dedicated keyring configuration for MCP connection material verification. */
export interface McpConnectionMaterialVerifierKeyringConfig
{
	/** Key used for newly admitted material. */
	readonly currentKeyId: string;
	/** Current and retained verification keys. */
	readonly keys: readonly McpConnectionMaterialVerifierKey[];
}
