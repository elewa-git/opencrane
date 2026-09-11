import type { OpenCraneHistoryStoreConfig } from "../app/config.types";

/**
 * Selects the Tier 2 application composition that the development entrypoint starts.
 *
 * The coordinator passes these strings through the process environment, `_ReadDevelopmentConfig`
 * rejects unknown values, and the composition root branches on the accepted value. The selection is
 * process configuration, not product state, so it is never persisted.
 */
export enum DevelopmentProfileKinds
{
	/** Runs the browser API without a conversation-computer process. */
	Core = "core",
	/** Runs the current conversation computer against a workstation-hosted model endpoint. */
	AgentLocal = "agent-local",
	/** Runs the current conversation computer against an explicitly configured remote model. */
	AgentRemote = "agent-remote",
	/** Runs the current conversation computer through the deterministic development model transport. */
	AgentSimulated = "agent-simulated",
}

/** Fixed browser identity seeded into the disposable Tier 2 database. */
export interface DevelopmentIdentity
{
	/** Verified email shown by the current session endpoint. */
	readonly email: string;
	/** Human-readable name shown by the current session endpoint. */
	readonly displayName: string;
	/** Stable Principal identifier persisted in PostgreSQL. */
	readonly principalId: string;
	/** Stable identity issuer reserved for the development entrypoint. */
	readonly issuer: string;
	/** Stable issuer-scoped subject persisted in PostgreSQL. */
	readonly subjectId: string;
	/** Disposable silo selected by the exact development hostname. */
	readonly siloId: string;
}

/** Frozen Tier 2 server settings supplied by the repository-owned coordinator. */
export interface DevelopmentConfig
{
	/** Absolute path to the per-launch browser credential delivered through the private URL. */
	readonly browserSessionCredentialPath: string;
	/** Absolute path to the generated development conversation-payload keyring. */
	readonly conversationPrivatePayloadKeyringPath: string;
	/** Loopback PostgreSQL URL holding the clean 0.11 target baseline. */
	readonly databaseUrl: string;
	/** TLS-verifying local KurrentDB coordinates and generated credential files. */
	readonly historyStore: OpenCraneHistoryStoreConfig;
	/** Fixed development browser identity. */
	readonly identity: DevelopmentIdentity;
	/** Workstation-only internal listener port. */
	readonly internalPort: number;
	/** Absolute path to the generated standalone invitation-signing key. */
	readonly invitationSigningKeyPath: string;
	/** Selected core or Agent application composition. */
	readonly profile: DevelopmentProfileKinds;
	/** Workstation-only browser API listener port. */
	readonly publicPort: number;
}
