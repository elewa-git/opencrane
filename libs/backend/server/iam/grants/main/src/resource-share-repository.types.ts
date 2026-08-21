import type { ResourceShareKinds, ResourceShareRecord } from "./resource-share.types";

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

/** Input used to create a share parent without accepting an owner from HTTP. */
export interface CreateResourceShareRecord
{
	/** Silo derived from authenticated caller evidence. */
	readonly siloId: string;
	/** Governed resource family. */
	readonly resourceKind: ResourceShareKinds;
	/** Exact governed resource identifier. */
	readonly resourceId: string;
	/** Authenticated principal establishing the resource boundary. */
	readonly ownerPrincipalId: string;
}

/** Input that pairs one recipient relation with one exact generic grant. */
export interface CreateResourceShareRecipientRecord
{
	/** Silo shared by the parent, recipient, grantor, and grant. */
	readonly siloId: string;
	/** Stable share parent. */
	readonly shareId: string;
	/** Existing same-silo recipient principal. */
	readonly recipientPrincipalId: string;
	/** Authenticated principal that created the relation. */
	readonly grantedByPrincipalId: string;
	/** Exact generic grant authorising this recipient. */
	readonly grantId: string;
}

/** Transaction-scoped persistence port for explicit resource-share relations. */
export interface ResourceShareRepository
{
	/** Confirms that one principal belongs to the exact silo. */
	principalExists(siloId: string, principalId: string): Promise<boolean>;
	/** Finds a share by its unique silo and resource coordinates. */
	findByResource(siloId: string, resourceKind: ResourceShareKinds, resourceId: string): Promise<ResourceShareRecord | null>;
	/** Creates the share parent or returns the row inserted by an earlier request. */
	createOrFind(input: CreateResourceShareRecord): Promise<ResourceShareRecord>;
	/** Finds one recipient together with its owner and linked grant. */
	findRecipient(siloId: string, shareId: string, recipientPrincipalId: string): Promise<ResourceShareRecipientRecord | null>;
	/** Inserts a recipient relation without duplicating an existing pair. */
	createRecipient(input: CreateResourceShareRecipientRecord): Promise<boolean>;
	/** Removes one exact recipient relation and reports whether it was present. */
	revokeRecipient(siloId: string, shareId: string, recipientPrincipalId: string): Promise<boolean>;
	/** Loads the complete current share projection. */
	findById(siloId: string, shareId: string): Promise<ResourceShareRecord | null>;
	/** Lists shares owned by or granted to one authenticated principal. */
	listVisible(siloId: string, principalId: string): Promise<readonly ResourceShareRecord[]>;
}
