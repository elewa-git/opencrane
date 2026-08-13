/**
 * One credential entry — a name and its secret value — handed to Obot while custody is set up.
 *
 * The value is accepted for exactly one request and is never written anywhere in OpenCrane: not
 * stored in Postgres, not logged, not put in a trace attribute, and not returned to the caller.
 * It travels only inside the body of the Obot configure call made by `ObotCustodyPort.provision`;
 * afterwards OpenCrane holds nothing but the opaque reference in {@link ProvisionedObotCustody}.
 * A caller therefore cannot read a credential back — to change one, revoke the custody reference
 * and provision again.
 *
 * Called by: libs/backend/server/gateways/integrations/main/src/integration-custody.router.ts
 * (parsed out of the POST body by `_isCredentialEntry`) and integration-custody-provisioning.types.ts.
 */
export interface ObotCustodyCredential
{
	/** Header name or provider-specific credential field. */
	readonly name: string;
	/** Secret value that must never be persisted, logged, or returned. */
	readonly value: string;
}

/**
 * Everything needed to set up one remote Obot MCP server that holds an integration's credential.
 *
 * `siloId` and `integrationId` are correlation context only — they name the product-side owner for
 * logs and traces. Obot itself is addressed solely by `obotCatalogEntryId`. The `credential` array
 * is the sensitive part; see {@link ObotCustodyCredential} for the rule that its values are sent
 * once and never kept.
 *
 * Called by: libs/backend/server/gateways/integrations/main/src/integration-custody.router.ts and
 * integration-custody-provisioning.ts, through `ObotCustodyPort.provision`.
 */
export interface ProvisionObotCustodyCommand
{
	/** Silo that owns the integration. */
	readonly siloId: string;
	/** Product integration identity used as remote correlation context. */
	readonly integrationId: string;
	/** Obot catalogue entry to configure. */
	readonly obotCatalogEntryId: string;
	/** Write-only credential material passed directly to Obot. */
	readonly credential: readonly ObotCustodyCredential[];
}

/**
 * What Obot gave back after it created and configured the remote MCP server.
 *
 * Every field except `expiresAt` comes from Obot; OpenCrane never invents a reference. A caller
 * stores these as the product's record of the custody and checks them before trusting the result:
 * integration-custody-provisioning.ts revokes and reports the integration as unavailable when the
 * catalogue entry does not match what it asked for, the reference is blank, or `expiresAt` is
 * already in the past.
 */
export interface ProvisionedObotCustody
{
	/** The catalogue entry Obot confirmed. Compare it against the one you asked for. */
	readonly obotCatalogEntryId: string;
	/** Opaque reference minted by Obot; OpenCrane never builds one itself. */
	readonly obotCustodyReference: string;
	/**
	 * When the custody stops being usable.
	 *
	 * Obot v0.23.1 never expires a configured MCP server, so the HTTP adapter fills this with a
	 * far-future date and revoking is the real way to end custody. A caller must still treat a past
	 * date as unusable and fail closed.
	 */
	readonly expiresAt: Date;
}

/**
 * Creates and destroys the remote Obot MCP servers that hold integration credentials.
 *
 * OpenCrane deliberately never holds an integration credential itself: it hands the secret to Obot
 * once and afterwards keeps only the opaque reference Obot minted. Two implementations exist —
 * `__CreateHttpObotCustodyAdapter` in http-obot-custody.ts talks to Obot over HTTP, and
 * `__UnavailableObotCustodyAdapter` refuses every call when no Obot is configured, so a deployment
 * without Obot fails visibly instead of faking custody.
 *
 * Called by: libs/backend/server/gateways/integrations/main/src/integration-custody-provisioning.ts
 * and integration-custody.router.ts; composed in
 * apps/opencrane/src/infra/obot/obot-adapters.factory.ts and threaded through
 * apps/opencrane/src/app/routes.ts and public-app.ts.
 */
export interface ObotCustodyPort
{
	/**
	 * Sets up the remote MCP server and hands Obot the credential.
	 *
	 * @param command - Silo/integration context, the Obot catalogue entry, and the credential entries.
	 * @returns The catalogue entry, opaque reference, and expiry — nothing derived locally, so the
	 *   caller can compare them against what it asked for.
	 * @throws ObotCustodyUnavailableError When no Obot transport is configured.
	 * @throws ObotProtocolError When Obot's create response carries no usable MCP server id.
	 * @throws ObotTransportError When Obot cannot be reached or refuses an exchange.
	 * @throws Error When a credential entry has a blank name.
	 */
	provision(command: ProvisionObotCustodyCommand): Promise<ProvisionedObotCustody>;
	/**
	 * Destroys the stored credential and then the remote MCP server.
	 *
	 * Safe to call twice: the HTTP adapter treats a 404 from either step as already-done. Callers use
	 * it both to end a custody normally and to clean up after a failed provisioning.
	 *
	 * @param obotCustodyReference - The opaque reference Obot minted for this custody.
	 * @throws ObotCustodyUnavailableError When no Obot transport is configured.
	 * @throws ObotTransportError When Obot cannot be reached, or refuses with anything but a 404.
	 */
	revoke(obotCustodyReference: string): Promise<void>;
}
