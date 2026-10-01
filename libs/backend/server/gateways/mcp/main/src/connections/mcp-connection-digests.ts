import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

/** Digest a client key without retaining it in a claim or connection row. */
export function __McpConnectionRequestKeyDigest(idempotencyKey: string): `sha256:${string}`
{
	return ___DigestCanonicalJson({ idempotencyKey } as JsonValue);
}

/** Bind one command to its non-secret target plus the HMAC verifier of any bearer material. */
export function __McpConnectionCommandDigest(value: { readonly serverId: string; readonly ownerPrincipalId: string; readonly agentServiceId: string | null; readonly credentialKind: string; readonly materialVerifier: string | null }): `sha256:${string}`
{
	return ___DigestCanonicalJson(value as JsonValue);
}

/** Bind discovery and execution to the registered endpoint without saving it on connection rows. */
export function __McpConnectionEndpointDigest(endpoint: string): `sha256:${string}`
{
	return ___DigestCanonicalJson({ endpoint } as JsonValue);
}

/** Build a stable workflow key from one non-secret immutable generation. */
export function __McpConnectionTaskKey(kind: "activate" | "revoke", value: { readonly siloId: string; readonly connectionId: string; readonly generation: number; readonly commandDigest: string }): string
{
	return `workflows:mcp-connection-${kind}:${___DigestCanonicalJson(value as JsonValue).slice("sha256:".length)}`;
}

/** Build the managed-grant editor identity owned by one immutable connection row. */
export function __McpConnectionGrantManagerId(connectionId: string): string
{
	return `mcp-connection:${connectionId}`;
}
