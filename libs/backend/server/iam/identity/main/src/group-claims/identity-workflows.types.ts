import type { Logger } from "pino";

/** Dependencies and identity claims used to mirror group membership after login. */
export interface MirrorGroupsOnLoginOptions
{
	/** Silo derived from the trusted login request host. */
	siloId: string | undefined;
	/** IdP issuer that namespaces the verified subject. */
	issuer: string | undefined;
  /** IdP-verified subject. */
  subject: string | undefined;
	/** Verified email retained as profile data, never as an identity key. */
	email: string | undefined;
	/** Provider display name retained as profile data, never as authority. */
	displayName: string | undefined;
  /** Group claims carried by the verified identity token. */
  groups: readonly string[] | undefined;
  /** Scoped logger. */
  log: Logger;
}

/** Validated identity and parsed group IDs passed into one projection transaction. */
export interface GroupClaimProjectionCommand
{
	/** Silo that owns the Principal and groups. */
	readonly siloId: string;
	/** Identity-provider issuer that namespaces the subject. */
	readonly issuer: string;
	/** Identity-provider subject projected as the Principal. */
	readonly subject: string;
	/** Optional verified email stored as profile data. */
	readonly email: string | undefined;
	/** Optional provider display name stored as profile data. */
	readonly displayName: string | undefined;
	/** Parsed stable group IDs claimed by the verified identity. */
	readonly groupIds: readonly string[];
	/** Scoped logger used for unresolved claim warnings. */
	readonly log: Logger;
}

/** Transaction boundary that reconciles verified external group claims. */
export interface GroupClaimProjectionUnitOfWork
{
	/** Project one verified identity and replace its direct external memberships. */
	reconcile(options: MirrorGroupsOnLoginOptions): Promise<void>;
}

/** Transaction-scoped repository that writes the Principal projection and direct memberships. */
export interface GroupClaimProjectionRepository
{
	/** Reconcile one validated identity and its parsed stable group IDs. */
	reconcile(command: GroupClaimProjectionCommand): Promise<void>;
}
