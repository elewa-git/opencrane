/**
 * Development-only application compositions selected before any OpenCrane process starts.
 *
 * These stable values let the coordinator, server, and controller agree on which external
 * boundaries exist. They travel through process environments rather than persistence or public
 * APIs, grant no authority, and production entrypoints do not import them. Configuration parsers
 * reject unknown values before they compose an adapter.
 */
export enum LocalDevelopmentProfileKinds
{
	/** Runs the real browser API and PostgreSQL while leaving Agent execution disabled. */
	Core = "core",
	/** Runs the local Agent controller and runtime against a local LiteLLM proxy. */
	AgentLocal = "agent-local",
	/** Runs the local Agent controller and runtime against an explicitly configured remote LiteLLM proxy. */
	AgentRemote = "agent-remote",
	/** Runs admitted Agent work through the deterministic development runtime without model access. */
	AgentSimulated = "agent-simulated",
}

/**
 * Identity class attached to each runtime profile created by local development.
 *
 * The coordinator serializes these values into the Agent controller environment. The controller
 * uses the value to validate that a runtime has the matching ServiceAccount name. These values are
 * process configuration and are not persisted. An unknown value makes the controller reject its
 * configuration before it starts.
 */
export enum LocalDevelopmentRuntimeIdentityProfiles
{
	/** The runtime represents work owned by the local developer and must use a personal runtime ServiceAccount. */
	Personal = "personal",
	/** The runtime represents a managed Agent service and must use a managed runtime ServiceAccount. */
	Managed = "managed",
}

/** Fixed installation-selected human identity used only by the Tier 2 server entrypoint. */
export interface LocalDevelopmentIdentity
{
	/** Stable subject seeded into the disposable local database. */
	readonly subjectId: string;
	/** Verified email displayed by the live frontend and stored with local membership. */
	readonly email: string;
	/** Human-readable name shown by the live session gateway. */
	readonly displayName: string;
	/** Fixed local silo selected from the trusted development host. */
	readonly siloId: string;
}

/** One local runtime identity admitted by the Tier 2 server and controller. */
interface LocalDevelopmentRuntimeIdentity
{
	/** Selects the ServiceAccount naming rules the Agent controller applies to this runtime. */
	readonly identityProfile: LocalDevelopmentRuntimeIdentityProfiles;
	/** Namespace assigned to the local process as its simulated workload boundary. */
	readonly namespace: string;
	/** ServiceAccount name signed into the process token and reconstructed by the server. */
	readonly serviceAccountName: string;
}

/** Shared server, personal-runtime, and managed-runtime coordinates for Tier 2 Agent profiles. */
export interface LocalDevelopmentRuntimeIdentities
{
	/** Simulated control-plane namespace used to construct internal service URLs. */
	readonly serverNamespace: string;
	/** Identity assigned to personal Agent attempts. */
	readonly personal: LocalDevelopmentRuntimeIdentity;
	/** Identity assigned to managed Agent attempts. */
	readonly managed: LocalDevelopmentRuntimeIdentity;
}
