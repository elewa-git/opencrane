import type { Request } from "express";

/**
 * Identifies the persisted resource family of a migrated direct share.
 *
 * The read and revocation API returns these values but exposes no share-creation command. Repository
 * mapping rejects an unknown stored value, so adding or renaming one requires matching storage and
 * API changes.
 */
export enum ResourceShareKinds
{
	/** Shares one governed artifact or file record. */
	File = "file",
	/** Shares one governed conversation record. */
	Chat = "chat",
	/** Shares one governed dataset record. */
	Dataset = "dataset",
}

/**
 * Reports whether a resource-share revocation changed authority.
 *
 * The route maps `Revoked` to 204. `NotFound` also covers a missing share, missing recipient, or a
 * caller who is not its owner, so the API returns 404 without disclosing which check failed. These
 * values are returned in memory and are not persisted.
 */
export enum ResourceShareOutcomes
{
	/** The recipient relation and its linked grant were revoked in one transaction. */
	Revoked = "revoked",
	/** No matching recipient was visible to the caller, including when the caller does not own the share. */
	NotFound = "not_found",
}

/** Authenticated local principal supplied to the transport adapter. */
export interface ResourceShareCaller
{
	/** Silo selected from trusted request and membership evidence. */
	readonly siloId: string;
	/** Stable local principal resolved from the verified OIDC identity. */
	readonly principalId: string;
}

/** Resolves the verified request identity without granting the route database access. */
export type ResourceShareCallerResolver = (request: Request) => Promise<ResourceShareCaller | null>;

/** One durable share and its current recipient projection. */
export interface ResourceShareRecord
{
	/** Stable share identifier used for recipient management. */
	readonly id: string;
	/** Silo that owns every related principal and grant. */
	readonly siloId: string;
	/** Governed resource family. */
	readonly resourceKind: ResourceShareKinds;
	/** Exact governed resource identifier. */
	readonly resourceId: string;
	/** Principal that owns the resource's Personal boundary. */
	readonly ownerPrincipalId: string;
	/** Principals with explicit live recipient relations. */
	readonly recipientPrincipalIds: readonly string[];
}

/** Command that revokes one explicit resource recipient. */
export interface RevokeResourceShareCommand
{
	/** Authenticated principal and silo derived outside route parameters. */
	readonly caller: ResourceShareCaller;
	/** Stable share identifier. */
	readonly shareId: string;
	/** Stable local principal whose recipient relation should be revoked. */
	readonly recipientPrincipalId: string;
}

/** Result of revoking one explicit resource recipient. */
export interface RevokeResourceShareResult
{
	/** Whether the relation was revoked, hidden, or forbidden. */
	readonly outcome: ResourceShareOutcomes.Revoked | ResourceShareOutcomes.NotFound;
}
