/**
 * Development-only application compositions selected before any OpenCrane process starts.
 *
 * These stable values let the coordinator, server, and controller agree on which external
 * boundaries exist. They grant no authority and production entrypoints do not import them.
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
