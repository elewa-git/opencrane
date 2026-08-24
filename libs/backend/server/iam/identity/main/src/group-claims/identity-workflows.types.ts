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

/** Transaction boundary that reconciles verified external group claims. */
export interface GroupClaimProjectionUnitOfWork
{
	/** Project one verified identity and replace its direct external memberships. */
	reconcile(options: MirrorGroupsOnLoginOptions): Promise<void>;
}

/** Transaction-scoped repository that writes the Principal projection and direct memberships. */
export interface GroupClaimProjectionRepository
{
	/** Reconcile already parsed stable group IDs for one verified identity. */
	reconcile(options: MirrorGroupsOnLoginOptions, claimedGroupIds: readonly string[]): Promise<void>;
}
