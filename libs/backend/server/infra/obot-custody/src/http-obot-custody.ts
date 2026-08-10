import { ObotProtocolError, ObotTransportError } from "./obot-http.js";
import type { ObotSession } from "./obot-http.types.js";
import type { ObotCustodyPort, ProvisionObotCustodyCommand, ProvisionedObotCustody } from "./obot-custody.types.js";

/**
 * Fallback custody lifetime when Obot reports no expiry of its own.
 *
 * Obot MCP server configurations do not expire server-side (v0.23.1); the remote credential lives
 * until it is deconfigured. The product schema still requires an expiry to fail closed on, so a
 * far-future bound is recorded and revocation remains the real lifecycle control.
 */
const _DEFAULT_CUSTODY_LIFETIME_MILLISECONDS = 365 * 24 * 60 * 60 * 1_000;

/** Return a plain object suitable for security-boundary parsing. */
function _AsObject(value: unknown): Record<string, unknown> | null
{
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Extract the Obot-minted MCP server id, refusing any unrecognised creation response. */
function _McpServerId(payload: unknown): string
{
	const record = _AsObject(payload);
	const id = record?.["id"];
	if (typeof id !== "string" || id.trim().length === 0) throw new ObotProtocolError("Obot MCP server creation returned no id");
	return id;
}

/** Read an optional remote expiry field, accepting only a parseable future instant. */
function _RemoteExpiry(payload: unknown, now: Date): Date | null
{
	const record = _AsObject(payload);
	const candidate = record?.["expiresAt"];
	if (typeof candidate !== "string") return null;
	const epochMilliseconds = Date.parse(candidate);
	if (!Number.isFinite(epochMilliseconds) || epochMilliseconds <= now.getTime()) return null;
	return new Date(epochMilliseconds);
}

/** Build the flat configure payload from write-only credential entries; values are never logged. */
function _ConfigurePayload(command: ProvisionObotCustodyCommand): Record<string, string>
{
	const payload: Record<string, string> = {};
	for (const entry of command.credential)
	{
		if (typeof entry.name !== "string" || entry.name.trim().length === 0) throw new Error("Obot custody credential entries require a non-empty name");
		payload[entry.name] = entry.value;
	}
	return payload;
}

/** Return whether an error is the idempotent-success 404 of an already-removed remote resource. */
function _IsNotFound(error: unknown): boolean
{
	return error instanceof ObotTransportError && error.code === "http_404";
}

/**
 * Create the authenticated HTTP custody adapter over one Obot management session.
 *
 * Provisioning creates the remote MCP server, then configures it with the write-only credential.
 * The credential values travel ONLY inside the configure request body — they are never logged,
 * persisted, or included in any thrown error. A configure failure is compensated by deleting the
 * just-created server so no half-configured remote custody survives, and the original failure is
 * rethrown. Revocation is idempotent: a 404 on deconfigure or delete counts as success.
 *
 * The exact Obot response shapes are not pinned by contract (live qualification is gated on issue
 * #337), so every consumed field is validated and anything unrecognised raises a typed
 * {@link ObotProtocolError} instead of being trusted.
 *
 * @param session - Authenticated bounded Obot management exchange.
 * @returns The production {@link ObotCustodyPort} implementation.
 */
export function __CreateHttpObotCustodyAdapter(session: ObotSession): ObotCustodyPort
{
	return {
		async provision(command: ProvisionObotCustodyCommand): Promise<ProvisionedObotCustody>
		{
			// 1. Create the remote MCP server from the catalogue entry; only Obot mints the id.
			const created = await session.request("/api/mcp-servers", "POST", { catalogEntryID: command.obotCatalogEntryId });
			const mcpServerId = _McpServerId(created);

			// 2. Configure the credential. This is the only exchange that carries secret values.
			let configured: unknown;
			try
			{
				configured = await session.request(`/api/mcp-servers/${encodeURIComponent(mcpServerId)}/configure`, "POST", _ConfigurePayload(command));
			}
			catch (error)
			{
				// 3. Compensate the unconfigured server so a failed configure leaves nothing usable
				// remotely; the original failure stays authoritative even if compensation also fails.
				try
				{
					await session.request(`/api/mcp-servers/${encodeURIComponent(mcpServerId)}`, "DELETE");
				}
				catch { /* Compensation is best effort; the original configure failure is rethrown below. */ }
				throw error;
			}

			// 4. Return only Obot-originated coordinates plus the documented far-future fallback expiry.
			const now = new Date();
			return {
				obotCatalogEntryId: command.obotCatalogEntryId,
				obotCustodyReference: mcpServerId,
				expiresAt: _RemoteExpiry(configured, now) ?? new Date(now.getTime() + _DEFAULT_CUSTODY_LIFETIME_MILLISECONDS),
			};
		},

		async revoke(obotCustodyReference: string): Promise<void>
		{
			// 1. Deconfigure first so the stored credential is destroyed even if deletion fails.
			try
			{
				await session.request(`/api/mcp-servers/${encodeURIComponent(obotCustodyReference)}/deconfigure`, "POST");
			}
			catch (error)
			{
				if (!_IsNotFound(error)) throw error;
			}

			// 2. Delete the remote server; a 404 means the reference is already gone (idempotent).
			try
			{
				await session.request(`/api/mcp-servers/${encodeURIComponent(obotCustodyReference)}`, "DELETE");
			}
			catch (error)
			{
				if (!_IsNotFound(error)) throw error;
			}
		},
	};
}
