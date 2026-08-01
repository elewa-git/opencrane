import type { AgentRevisionId, AgentServiceId, SiloId } from "./identifiers.types.js";

/** Stable service-kind vocabulary used by agent admission and persistence projections. */
export enum AgentServiceKinds
{
	/** A user-bound personal agent that may use verified personal context. */
	Personal = "personal",
	/** A managed agent service that never inherits an individual's personal context. */
	Managed = "managed",
}

/** Product role performed by an agent service. */
export type AgentServiceKind = AgentServiceKinds;

/** Lifecycle state of a stable agent service identity. */
export type AgentServiceState = "draft" | "active" | "paused" | "retired";

/** Stable product identity for a personal or managed agent. */
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
