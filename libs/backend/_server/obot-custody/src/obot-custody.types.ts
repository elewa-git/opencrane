/** Write-only credential material accepted only for the duration of a custody request. */
export interface ObotCustodyCredential
{
	/** Header name or provider-specific credential field. */
	readonly name: string;
	/** Secret value that must never be persisted, logged, or returned. */
	readonly value: string;
}

/** Request to provision one remote Obot custody reference. */
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

/** Remote-only custody result issued by Obot after successful configuration. */
export interface ProvisionedObotCustody
{
	/** Obot catalogue entry confirmed by the remote authority. */
	readonly obotCatalogEntryId: string;
	/** Opaque reference minted by Obot; never locally synthesized. */
	readonly obotCustodyReference: string;
	/** Remote expiry governing later redemption. */
	readonly expiresAt: Date;
}

/** Runtime-neutral boundary for the Obot credential custody authority. */
export interface ObotCustodyPort
{
	/** Provisions custody remotely and returns only Obot-originated opaque coordinates. */
	provision(command: ProvisionObotCustodyCommand): Promise<ProvisionedObotCustody>;
	/** Revokes one remotely issued custody reference. */
	revoke(obotCustodyReference: string): Promise<void>;
}
