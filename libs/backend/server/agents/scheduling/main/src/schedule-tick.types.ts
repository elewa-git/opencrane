import type { ManagedRunAdmissionPort, ManagedRunAdmissionResult } from "@opencrane/backend/server/agents/agent-services";

import type { ScheduleInvalidReasons, ScheduleOverlapPolicies, ScheduledSlotOutcomes, ScheduleTickStatuses } from "./schedule-tick.enums.js";

/** One recurring schedule bound to a managed AgentService's active revision. */
export interface AgentServiceSchedule
{
	/** Stable schedule identifier. */
	readonly id: string;
	/** Silo owning the schedule and its service. */
	readonly siloId: string;
	/** Managed service whose active revision each due slot admits. */
	readonly agentServiceId: string;
	/** Standard 5-field cron expression evaluated in `timezone`. */
	readonly cron: string;
	/** IANA timezone the cron expression is evaluated in. */
	readonly timezone: string;
	/** Behaviour when a prior scheduled run is still active. */
	readonly overlapPolicy: ScheduleOverlapPolicies;
	/** Whether evaluation is active; `false` suspends the schedule without deleting it. */
	readonly enabled: boolean;
	/** Bounded catch-up horizon in seconds. */
	readonly catchupWindowSeconds: number;
	/** Newest slot already admitted, or null when the schedule has never fired. */
	readonly lastScheduledAt: string | null;
}

/** Deterministic delay policy for a transiently unavailable admission. */
export interface RetryBackoffPolicy
{
	/** Delay before the first retry, in milliseconds. */
	readonly baseDelayMs: number;
	/** Multiplier applied per prior attempt. */
	readonly factor: number;
	/** Hard ceiling on any single backoff delay, in milliseconds. */
	readonly maxDelayMs: number;
}

/** Server-owned clock injected so a tick is deterministic in tests. */
export interface ScheduleClock
{
	/** Returns the trusted evaluation instant for one tick. */
	now(): Date;
}

/** Whether a prior scheduled run of one service is still active (for `skip` overlap). */
export interface ActiveScheduledRunLookup
{
	/** Returns true when a non-terminal scheduled run of the service already exists. */
	hasActiveScheduledRun(agentServiceId: string, siloId: string): Promise<boolean>;
}

/** Ports and bounds a schedule tick composes over. */
export interface ScheduleTickDependencies
{
	/** The EXISTING managed run-admission seam; the tick opens no second run-creation path. */
	readonly admission: ManagedRunAdmissionPort;
	/** In-flight scheduled-run lookup consulted only for the `skip` overlap policy. */
	readonly activeRuns: ActiveScheduledRunLookup;
	/** Server-owned evaluation clock. */
	readonly clock: ScheduleClock;
	/** Stable subject recorded as the requester of every scheduled admission. */
	readonly schedulerSubjectId: string;
	/** Maximum slots admitted in one tick (catch-up ceiling). */
	readonly maxSlotsPerTick: number;
	/** Delay policy reported for a transiently unavailable admission. */
	readonly backoff: RetryBackoffPolicy;
}

/** Why a due slot was not admitted, or how it was admitted. */
export type ScheduledSlotOutcome =
	| { readonly slot: string; readonly outcome: ScheduledSlotOutcomes.Accepted | ScheduledSlotOutcomes.Idempotent; readonly runId: string; readonly idempotencyKey: string }
	| { readonly slot: string; readonly outcome: ScheduledSlotOutcomes.SkippedOverlap; readonly idempotencyKey: string }
	| { readonly slot: string; readonly outcome: ScheduledSlotOutcomes.RetryHint; readonly reason: string; readonly retryAfterMs: number; readonly idempotencyKey: string }
	| { readonly slot: string; readonly outcome: ScheduledSlotOutcomes.Denied; readonly reason: string; readonly idempotencyKey: string };

/** Result of evaluating one schedule at one instant. */
export type ScheduleTickResult =
	| { readonly status: ScheduleTickStatuses.Suspended }
	| { readonly status: ScheduleTickStatuses.InvalidSchedule; readonly reason: ScheduleInvalidReasons }
	| { readonly status: ScheduleTickStatuses.Ticked; readonly outcomes: readonly ScheduledSlotOutcome[]; readonly nextLastScheduledAt: string | null };

/** Re-export of the admission result union for adapters composing the tick. */
export type { ManagedRunAdmissionResult };
