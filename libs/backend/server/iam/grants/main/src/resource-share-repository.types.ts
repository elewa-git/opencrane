import type { ResourceShareRecord } from "./resource-share.types";

/** Stored recipient evidence needed to revoke its linked grant. */
export interface ResourceShareRecipientRecord
{
	/** Stable share identifier. */
	readonly shareId: string;
	/** Silo that owns the share and recipient. */
	readonly siloId: string;
	/** Principal that owns the resource boundary. */
	readonly ownerPrincipalId: string;
	/** Principal receiving the share. */
	readonly recipientPrincipalId: string;
	/** Exact generic grant paired with the recipient relation. */
	readonly grantId: string;
}

/** Transaction-scoped persistence port for explicit resource-share relations. */
export interface ResourceShareRepository
{
	/** Finds one recipient together with its owner and linked grant. */
	findRecipient(siloId: string, shareId: string, recipientPrincipalId: string): Promise<ResourceShareRecipientRecord | null>;
	/** Removes one exact recipient relation and reports whether it was present. */
	revokeRecipient(siloId: string, shareId: string, recipientPrincipalId: string): Promise<boolean>;
	/** Lists shares owned by or granted to one authenticated principal. */
	listVisible(siloId: string, principalId: string): Promise<readonly ResourceShareRecord[]>;
}
