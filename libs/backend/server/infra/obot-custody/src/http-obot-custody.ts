import { ObotProtocolError, ObotTransportError } from "./obot-http";
import type { ObotSession } from "./obot-http.types";
import type { ObotCustodyPort, ProvisionObotCustodyCommand, ProvisionedObotCustody } from "./obot-custody.types";

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
 * Create the HTTP custody adapter that talks to Obot over one authenticated session.
 *
 * Provisioning is two calls: create the remote MCP server, then configure it with the credential.
 * The credential values travel ONLY inside the configure request body — they are never logged,
 * stored, or put into any thrown error. If configure fails, the adapter deletes the server it just
 * created so no half-configured custody is left behind in Obot, and it still throws the ORIGINAL
 * configure failure even when that delete also fails. Revoking is safe to repeat: a 404 from
 * deconfigure or delete counts as success.
 *
 * The exact Obot response shapes are not pinned by any contract (live qualification is gated on
 * issue #337), so every field this adapter reads is checked, and anything unexpected raises
 * {@link ObotProtocolError} rather than being trusted.
 *
 * Called by: apps/opencrane/src/infra/obot/obot-adapters.factory.ts, which passes the port to
 * libs/backend/server/gateways/integrations/main/src/integration-custody-provisioning.ts.
 *
 * @param session - Authenticated Obot management session; see `__CreateObotSession` in obot-http.ts.
 * @returns The production {@link ObotCustodyPort} implementation.
 * @throws ObotProtocolError From `provision`, when Obot's create response carries no MCP server id.
 * @throws ObotTransportError From either method, when Obot cannot be reached or refuses a call.
 * @throws Error From `provision`, when a credential entry has a blank name.
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
				// 3. Delete the server we just created, so a failed configure leaves nothing usable in
				// Obot. The original configure failure is still the one thrown, even if this delete fails.
				try
				{
					await session.request(`/api/mcp-servers/${encodeURIComponent(mcpServerId)}`, "DELETE");
				}
				catch { /* Compensation is best effort; the original configure failure is rethrown below. */ }
				throw error;
			}

			// 4. Return only the ids Obot gave us, plus the far-future fallback expiry explained at the top.
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
