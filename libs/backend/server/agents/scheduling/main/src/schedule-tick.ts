import { createHash } from "node:crypto";

import { AgentScheduleOverlapPolicies, ManagedRunAdmissionOutcomes, type AgentRevisionLifecycleDenial } from "@opencrane/backend/server/agents/agent-services";

import { __DueScheduledSlots, __IsValidTimezone, __ParseCronExpression } from "./cron-schedule.js";
import { ScheduleInvalidReasons, ScheduledSlotOutcomes, ScheduleTickStatuses } from "./schedule-tick.enums.js";
import type { AgentServiceSchedule, RetryBackoffPolicy, ScheduleTickDependencies, ScheduleTickResult, ScheduledSlotOutcome } from "./schedule-tick.types.js";

/** Admission denial reasons that are transient and warrant a backed-off retry rather than a drop. */
const _RETRYABLE_DENIALS: ReadonlySet<AgentRevisionLifecycleDenial> = new Set(["membership_stale", "admission_concurrency_limited", "persistence_unavailable", "authority_conflict"]);

/**
 * Derive the deterministic idempotency key for one scheduled slot.
 *
 * The key is `sha256(agentServiceId ∥ agentRevisionId ∥ scheduledSlot)` with NUL delimiters so
 * concatenation cannot alias distinct coordinates. Two concurrent ticks that observe the same due
 * slot compute the SAME key, so the existing `@@unique([siloId, requestIdempotencyKey])` collapses
 * them to exactly one admitted run — one tick sees `accepted`, the other `idempotent`.
 *
 * @param agentServiceId - Service the slot belongs to.
 * @param agentRevisionId - Active revision fixed for the slot.
 * @param scheduledSlot - Canonical ISO-8601 slot instant.
 * @returns Hex idempotency key.
 */
export function __ScheduledRunIdempotencyKey(agentServiceId: string, agentRevisionId: string, scheduledSlot: string): string
{
	return `schedule_${createHash("sha256").update(`${agentServiceId}\u0000${agentRevisionId}\u0000${scheduledSlot}`).digest("hex")}`;
}

/**
 * Compute the deterministic exponential backoff delay for one retry attempt.
 * @param attempt - One-based retry attempt number.
 * @param policy - Base delay, growth factor, and ceiling.
 * @returns Non-negative delay in milliseconds, capped at `policy.maxDelayMs`.
 */
export function __NextBackoffDelayMs(attempt: number, policy: RetryBackoffPolicy): number
{
	if (!Number.isSafeInteger(attempt) || attempt < 1) return policy.baseDelayMs;
	const raw = policy.baseDelayMs * policy.factor ** (attempt - 1);
	return Math.min(policy.maxDelayMs, Math.round(raw));
}

/**
 * Evaluate one schedule at one instant and admit every due slot idempotently.
 *
 * This creates AgentRun records ONLY through the injected {@link ScheduleTickDependencies.admission}
 * port with `trigger: schedule`; it never dispatches a Job or runs business logic. Missed slots
 * within the catch-up window are admitted oldest-first (no leader election). The `allow` overlap
 * policy admits every due slot; `skip` admits at most the oldest due slot when no prior scheduled run
 * is active, so a catch-up batch cannot create concurrent scheduled runs. A transient admission
 * failure reports a retry-delay hint and stops advancing past the failed slot; this stateless
 * function does not enforce wall-clock retry timing. A permanent denial is recorded and the cursor
 * advances past it so one bad slot cannot wedge the schedule forever.
 *
 * @param schedule - The schedule being evaluated.
 * @param activeRevisionId - The service's currently active revision, or null when not runnable.
 * @param deps - Admission port, overlap lookup, clock, scheduler identity, and bounds.
 * @returns The tick result: suspended, invalid, or ticked with per-slot outcomes and the new cursor.
 */
export async function __RunScheduleTick(schedule: AgentServiceSchedule, activeRevisionId: string | null, deps: ScheduleTickDependencies): Promise<ScheduleTickResult>
{
	if (!schedule.enabled) return { status: ScheduleTickStatuses.Suspended };
	const expression = __ParseCronExpression(schedule.cron);
	if (expression === null) return { status: ScheduleTickStatuses.InvalidSchedule, reason: ScheduleInvalidReasons.InvalidCron };
	if (!__IsValidTimezone(schedule.timezone)) return { status: ScheduleTickStatuses.InvalidSchedule, reason: ScheduleInvalidReasons.InvalidTimezone };
	if (activeRevisionId === null) return { status: ScheduleTickStatuses.InvalidSchedule, reason: ScheduleInvalidReasons.ServiceNotRunnable };

	const nowInstant = deps.clock.now().toISOString();
	const dueSlots = __DueScheduledSlots(expression, { timezone: schedule.timezone, afterInstant: schedule.lastScheduledAt, nowInstant, catchupWindowSeconds: schedule.catchupWindowSeconds, maxSlots: deps.maxSlotsPerTick });
	if (dueSlots.length === 0) return { status: ScheduleTickStatuses.Ticked, outcomes: [], nextLastScheduledAt: schedule.lastScheduledAt };

	// The `skip` policy consults the in-flight lookup once; when a prior scheduled run is still
	// active every due slot is dropped and the cursor jumps to the newest so they never re-fire.
	if (schedule.overlapPolicy === AgentScheduleOverlapPolicies.Skip && await deps.activeRuns.hasActiveScheduledRun(schedule.agentServiceId, schedule.siloId))
	{
		const skipped = dueSlots.map(function _skip(slot): ScheduledSlotOutcome { return { slot, outcome: ScheduledSlotOutcomes.SkippedOverlap, idempotencyKey: __ScheduledRunIdempotencyKey(schedule.agentServiceId, activeRevisionId, slot) }; });
		return { status: ScheduleTickStatuses.Ticked, outcomes: skipped, nextLastScheduledAt: dueSlots[dueSlots.length - 1] };
	}

	const slotsToAdmit = schedule.overlapPolicy === AgentScheduleOverlapPolicies.Skip ? [dueSlots[0]] : dueSlots;
	const outcomes: ScheduledSlotOutcome[] = [];
	let cursor = schedule.lastScheduledAt;
	for (const slot of slotsToAdmit)
	{
		const idempotencyKey = __ScheduledRunIdempotencyKey(schedule.agentServiceId, activeRevisionId, slot);
		const result = await deps.admission.admitManagedRun({ agentServiceId: schedule.agentServiceId, siloId: schedule.siloId, requestedBy: deps.schedulerSubjectId, requestIdempotencyKey: idempotencyKey, trigger: "schedule", scheduledSlot: slot });
		if (result.outcome === ManagedRunAdmissionOutcomes.Accepted || result.outcome === ManagedRunAdmissionOutcomes.Idempotent)
		{
			outcomes.push({ slot, outcome: result.outcome === ManagedRunAdmissionOutcomes.Accepted ? ScheduledSlotOutcomes.Accepted : ScheduledSlotOutcomes.Idempotent, runId: result.runId, idempotencyKey });
			cursor = slot;
			continue;
		}
		// A transient admission failure stops the tick without advancing past the failed slot, so the
		// next tick retries the same slot; the hint lets a durable caller decide how long to wait.
		if (_RETRYABLE_DENIALS.has(result.reason))
		{
			outcomes.push({ slot, outcome: ScheduledSlotOutcomes.RetryHint, reason: result.reason, retryAfterMs: __NextBackoffDelayMs(1, deps.backoff), idempotencyKey });
			return { status: ScheduleTickStatuses.Ticked, outcomes, nextLastScheduledAt: cursor };
		}
		outcomes.push({ slot, outcome: ScheduledSlotOutcomes.Denied, reason: result.reason, idempotencyKey });
		cursor = slot;
	}
	return { status: ScheduleTickStatuses.Ticked, outcomes, nextLastScheduledAt: cursor };
}
