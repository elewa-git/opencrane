import type { AgentScheduleOverlapPolicies, ManagedRunAdmissionPort, ManagedRunAdmissionResult } from "@opencrane/backend/server/agents/agent-services";

import type { ScheduleInvalidReasons, ScheduledSlotOutcomes, ScheduleTickStatuses } from "./schedule-tick.enums";

/**
 * One recurring schedule, as the scheduler needs to see it.
 *
 * `cron` is a standard 5-field expression read in `timezone`, which is an IANA zone name - so a
 * schedule keeps its local meaning across daylight-saving changes. `lastScheduledAt` is the cursor:
 * the newest slot already dealt with, and the exclusive lower bound for the next evaluation.
 * `catchupWindowSeconds` bounds how far back a restarted or delayed scheduler will reach, so a long
 * outage does not produce a flood of old runs. Setting `enabled` to false suspends evaluation
 * without deleting anything.
 *
 * This is the scheduler's own read model. The write-side record owned by the agent-services package
 * is the separately named `AgentServiceScheduleRecord` - do not confuse the two.
 *
 * @see {@link CronExpression} for the cron subset that is actually supported.
 */
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
	readonly overlapPolicy: AgentScheduleOverlapPolicies;
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

/**
 * Everything one tick needs injected, so the tick itself is a pure function of its inputs.
 *
 * The clock is injected rather than read, so a whole pass shares one instant and tests are
 * deterministic. `maxSlotsPerTick` is the hard ceiling on catch-up work in one pass, and `backoff`
 * only produces the delay hint reported with a `RetryHint` outcome - nothing here waits.
 *
 * Built by: ScheduleTicker.runOnce in schedule-ticker.ts.
 */
export interface ScheduleTickDependencies
{
	/** The one authority allowed to create an AgentRun; the scheduler never writes runs itself. */
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

/**
 * One line of the tick's report: what happened to a single due slot.
 *
 * Every case carries `idempotencyKey`, so a caller can match the slot to whichever run a tick
 * created for it. `runId` exists only on the two admitted cases and `reason` only on the two refused
 * ones. Which case appears also decides whether the cursor moved past the slot.
 *
 * @see {@link ScheduledSlotOutcomes} for what each outcome obliges the caller to do.
 */
export type ScheduledSlotOutcome =
	| { readonly slot: string; readonly outcome: ScheduledSlotOutcomes.Accepted | ScheduledSlotOutcomes.Idempotent; readonly runId: string; readonly idempotencyKey: string }
	| { readonly slot: string; readonly outcome: ScheduledSlotOutcomes.SkippedOverlap; readonly idempotencyKey: string }
	| { readonly slot: string; readonly outcome: ScheduledSlotOutcomes.RetryHint; readonly reason: string; readonly retryAfterMs: number; readonly idempotencyKey: string }
	| { readonly slot: string; readonly outcome: ScheduledSlotOutcomes.Denied; readonly reason: string; readonly idempotencyKey: string };

/**
 * Everything one evaluation of one schedule reports back.
 *
 * Only the `Ticked` case carries `nextLastScheduledAt`, and that value is a proposal rather than a
 * stored fact: the caller still has to write it with a conditional update that may be refused. It is
 * null when the schedule has never fired and nothing was due; otherwise it is the newest slot the
 * cursor may safely move to - which is not always the newest slot in `outcomes`, because a
 * `RetryHint` stops the cursor short on purpose.
 *
 * @see {@link ScheduleTickStatuses} for what each status means for the caller.
 */
export type ScheduleTickResult =
	| { readonly status: ScheduleTickStatuses.Suspended }
	| { readonly status: ScheduleTickStatuses.InvalidSchedule; readonly reason: ScheduleInvalidReasons }
	| { readonly status: ScheduleTickStatuses.Ticked; readonly outcomes: readonly ScheduledSlotOutcome[]; readonly nextLastScheduledAt: string | null };

/** Re-export of the admission result union for adapters composing the tick. */
export type { ManagedRunAdmissionResult };
