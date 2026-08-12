import type { AgentRevisionId, AgentServiceId, SiloId } from "./identifiers.types.js";

/**
 * Stable product roles assigned to agent services.
 *
 * These serialized values are shared by durable records and lifecycle checks. They classify a
 * service's authority boundary only; a role does not itself authorize a caller or workload.
 */
export enum AgentServiceKinds
{
	/** A person-owned service whose execution is bound to that person's workspace authority. */
	Personal = "personal",
	/** A centrally managed service whose lifecycle is governed by the managed-agent control plane. */
	Managed = "managed",
}

/** Product role performed by an agent service. */
export type AgentServiceKind = AgentServiceKinds;

/** Whether an agent service may take new work. Only `active` may; `paused` can be re-enabled, `retired` never can. */
export enum AgentServiceStates
{
	/** The service has immutable revisions but none may execute yet. */
	Draft = "draft",
	/** The service has a published revision and may accept new runs. */
	Active = "active",
	/** The service remains durable but rejects new work until explicitly enabled again. */
	Paused = "paused",
	/** The service is permanently closed to new runs and has no active revision. This cannot be undone. */
	Retired = "retired",
}

/** Whether an agent service may take new work. Only `active` may; `paused` can be re-enabled, `retired` never can. */
export type AgentServiceState = "draft" | "active" | "paused" | "retired";

/** One agent, personal or managed. The identity survives every revision: `activeRevisionId` says which configuration is currently live, or null before the first publication. */
export interface AgentService
{
	/** Stable agent-service identifier. */
	readonly id: AgentServiceId;
	/** Silo that owns the service. */
	readonly siloId: SiloId;
	/** Product role performed by the service. */
	readonly kind: AgentServiceKind;
	/** Human-readable service name shown in product surfaces. */
	readonly name: string;
	/** Current lifecycle state. */
	readonly state: AgentServiceState;
	/** Immutable revision activated for new runs, or null before publication. */
	readonly activeRevisionId: AgentRevisionId | null;
	/** Named workload profile used to project runtime policy. */
	readonly workloadProfile: string;
	/** ISO-8601 instant at which the service was created. */
	readonly createdAt: string;
	/** ISO-8601 instant at which the service state last changed. */
	readonly updatedAt: string;
}
