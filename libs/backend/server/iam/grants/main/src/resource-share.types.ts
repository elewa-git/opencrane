import type { Request } from "express";

/** Resource families accepted by direct resource sharing. */
export enum ResourceShareKinds
{
	/** Shares one governed artifact or file record. */
	File = "file",
	/** Shares one governed conversation record. */
	Chat = "chat",
	/** Shares one governed dataset record. */
	Dataset = "dataset",
}

/** Outcomes returned by resource-share commands without exposing persistence failures. */
export enum ResourceShareOutcomes
{
	/** The command completed and changed durable sharing state. */
	Created = "created",
	/** The requested sharing relation already existed. */
	Existing = "existing",
	/** The command completed and revoked durable sharing state. */
	Revoked = "revoked",
	/** The caller did not hold authority to perform the command. */
	Forbidden = "forbidden",
	/** A required principal, capability, share, or recipient did not exist. */
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

/** Command that creates one explicit resource recipient. */
export interface CreateResourceShareCommand
{
	/** Authenticated principal and silo derived outside the request body. */
	readonly caller: ResourceShareCaller;
	/** Governed resource family. */
	readonly resourceKind: ResourceShareKinds;
	/** Exact governed resource identifier. */
	readonly resourceId: string;
	/** Existing same-silo principal that should receive access. */
	readonly recipientPrincipalId: string;
	/** Trusted wall-clock time used by generic grant evaluation. */
	readonly nowEpochMs: number;
}

/** Result of creating or resolving one explicit resource recipient. */
export type CreateResourceShareResult =
	| { readonly outcome: ResourceShareOutcomes.Created; readonly share: ResourceShareRecord }
	| { readonly outcome: ResourceShareOutcomes.Existing; readonly share: ResourceShareRecord }
	| { readonly outcome: ResourceShareOutcomes.Forbidden }
	| { readonly outcome: ResourceShareOutcomes.NotFound };

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
