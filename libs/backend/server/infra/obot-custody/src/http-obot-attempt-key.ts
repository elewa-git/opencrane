import { ObotProtocolError, ObotTransportError } from "./obot-http.js";
import type { ObotSession } from "./obot-http.types.js";
import type { IssueObotAttemptKeyCommand, IssuedObotAttemptKey, ObotAttemptKeyIssuer } from "./http-obot-attempt-key.types.js";

/** Return a plain object suitable for security-boundary parsing. */
function _AsObject(value: unknown): Record<string, unknown> | null
{
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/**
 * Extract the minted bearer key value, accepting either documented field spelling.
 *
 * The Obot key-creation response shape is not contract-pinned (live qualification is gated on
 * issue #337); `key` and `token` are both accepted, validated as non-empty strings, and anything
 * else is a protocol violation rather than a guessed credential.
 */
function _KeyValue(payload: unknown): string
{
	const record = _AsObject(payload);
	const candidate = record?.["key"] ?? record?.["token"];
	if (typeof candidate !== "string" || candidate.trim().length === 0) throw new ObotProtocolError("Obot API key creation returned no key value");
	return candidate;
}

/** Extract the Obot-minted key identifier used for later revocation. */
function _KeyId(payload: unknown): string
{
	const record = _AsObject(payload);
	const candidate = record?.["id"] ?? record?.["keyId"];
	if (typeof candidate !== "string" || candidate.trim().length === 0) throw new ObotProtocolError("Obot API key creation returned no key id");
	return candidate;
}

/**
 * Create the authenticated HTTP attempt-key issuer over one Obot management session.
 *
 * Minting posts the attempt name, the assignment-lease-bounded expiry, and the exact MCP server ids
 * in scope; the returned bearer value is validated and handed straight back to the caller — it is
 * never logged or retained here. Revocation is idempotent: a 404 means the key is already gone.
 *
 * @param session - Authenticated bounded Obot management exchange.
 * @returns The production {@link ObotAttemptKeyIssuer} implementation.
 */
export function __CreateHttpObotAttemptKeyIssuer(session: ObotSession): ObotAttemptKeyIssuer
{
	return {
		async issueAttemptKey(command: IssueObotAttemptKeyCommand): Promise<IssuedObotAttemptKey>
		{
			// 1. Refuse an unscoped mint before any exchange: a key naming no server id would grant
			// broader reach than the attempt's admitted integration assignments.
			if (command.obotCustodyReferences.length === 0 || command.obotCustodyReferences.some(function _blank(reference) { return reference.trim().length === 0; }))
			{
				throw new Error("Obot attempt key requires at least one non-empty MCP server id in scope");
			}

			// 2. Mint the key with its exact scope and lease-bounded expiry.
			const created = await session.request("/api/api-keys", "POST", { name: command.name, expiresAt: command.expiresAt.toISOString(), mcpServerIds: [...command.obotCustodyReferences] });

			// 3. Validate every consumed response field; an unrecognised shape is a protocol error.
			return { key: _KeyValue(created), keyId: _KeyId(created) };
		},

		async revokeAttemptKey(keyId: string): Promise<void>
		{
			try
			{
				await session.request(`/api/api-keys/${encodeURIComponent(keyId)}`, "DELETE");
			}
			catch (error)
			{
				// An already-deleted or expired key is the desired terminal state (idempotent revoke).
				if (error instanceof ObotTransportError && error.code === "http_404") return;
				throw error;
			}
		},
	};
}
