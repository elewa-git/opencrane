import type { AgentServiceId, SiloId } from "@opencrane/models/agents";

/** Stable overlap policies shared by schedule APIs, persistence, and tick evaluation. */
export enum AgentScheduleOverlapPolicies
{
	/** Admit at most one due slot when no earlier scheduled run remains active. */
	Skip = "skip",
	/** Admit every due slot through the shared idempotent run-admission authority. */
	Allow = "allow",
}

/** Serialized overlap-policy values derived from the canonical schedule vocabulary. */
export type AgentScheduleOverlapPolicy = `${AgentScheduleOverlapPolicies}`;

/** A stored recurring schedule for one managed AgentService. */
export interface AgentServiceScheduleRecord
{
	/** Stable schedule identifier. */
	readonly id: string;
	/** Silo owning the schedule and its service. */
	readonly siloId: SiloId;
	/** Managed service whose active revision each due slot admits. */
	readonly agentServiceId: AgentServiceId;
	/** Standard 5-field cron expression evaluated in `timezone`. */
	readonly cron: string;
	/** IANA timezone the cron expression is evaluated in. */
	readonly timezone: string;
	/** Behaviour when a prior scheduled run is still active. */
	readonly overlapPolicy: AgentScheduleOverlapPolicy;
	/** Whether evaluation is active; `false` suspends the schedule without deleting it. */
	readonly enabled: boolean;
	/** Bounded catch-up horizon in seconds. */
	readonly catchupWindowSeconds: number;
	/** Newest slot already admitted, or null when the schedule has never fired. */
	readonly lastScheduledAt: string | null;
	/** ISO-8601 creation instant. */
	readonly createdAt: string;
	/** ISO-8601 last-update instant. */
	readonly updatedAt: string;
}

/** Command that creates one schedule for a managed service. */
export interface CreateAgentScheduleCommand
{
	/** Silo the caller is operating within; a service in another silo must not resolve. */
	readonly siloId: SiloId;
	/** Managed service the schedule drives. */
	readonly agentServiceId: AgentServiceId;
	/** Cron expression. */
	readonly cron: string;
	/** IANA timezone. */
	readonly timezone: string;
	/** Overlap policy. */
	readonly overlapPolicy: AgentScheduleOverlapPolicy;
	/** Whether the schedule is enabled at creation. */
	readonly enabled: boolean;
	/** Bounded catch-up horizon in seconds. */
	readonly catchupWindowSeconds: number;
}

/** Command that updates one existing schedule's mutable fields. */
export interface UpdateAgentScheduleCommand
{
	/** Silo the caller is operating within. */
	readonly siloId: SiloId;
	/** Service the schedule belongs to. */
	readonly agentServiceId: AgentServiceId;
	/** Schedule being updated. */
	readonly scheduleId: string;
	/** Replacement cron expression. */
	readonly cron: string;
	/** Replacement IANA timezone. */
	readonly timezone: string;
	/** Replacement overlap policy. */
	readonly overlapPolicy: AgentScheduleOverlapPolicy;
	/** Replacement enabled flag. */
	readonly enabled: boolean;
	/** Replacement catch-up horizon in seconds. */
	readonly catchupWindowSeconds: number;
}

/** Stable reason a schedule command was refused. */
export type AgentScheduleDenial =
	| "invalid_command"
	| "invalid_cron"
	| "invalid_timezone"
	| "service_not_found"
	| "service_not_managed"
	| "schedule_not_found";

/** Result of creating or updating a schedule. */
export type AgentScheduleMutationResult =
	| { readonly outcome: "ok"; readonly schedule: AgentServiceScheduleRecord }
	| { readonly outcome: "denied"; readonly reason: AgentScheduleDenial };

/** Result of deleting a schedule. */
export type AgentScheduleDeletionResult =
	| { readonly outcome: "deleted" }
	| { readonly outcome: "denied"; readonly reason: AgentScheduleDenial };

/** Silo-scoped persistence boundary for the schedule plane. */
export interface AgentScheduleRepository
{
	/** Creates one schedule for a managed service in the caller's silo. */
	createSchedule(command: CreateAgentScheduleCommand, createdAt: string): Promise<AgentScheduleMutationResult>;
	/** Updates one schedule's mutable fields, silo-scoped. */
	updateSchedule(command: UpdateAgentScheduleCommand, updatedAt: string): Promise<AgentScheduleMutationResult>;
	/** Deletes one schedule, silo-scoped. */
	deleteSchedule(agentServiceId: AgentServiceId, scheduleId: string, siloId: SiloId): Promise<AgentScheduleDeletionResult>;
	/** Lists the schedules of one service, silo-scoped. */
	listSchedules(agentServiceId: AgentServiceId, siloId: SiloId): Promise<readonly AgentServiceScheduleRecord[]>;
}
