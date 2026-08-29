import type { AgentServiceId, SiloId } from "@opencrane/models/agents";

/**
 * What to do when a scheduled run comes due while an earlier one is still going.
 *
 * The strings are stable: the HTTP body, the Postgres enum, and the scheduler all use these exact
 * values. {@link AgentScheduleOverlapPolicies.Skip} is the safe default for anything that writes;
 * {@link AgentScheduleOverlapPolicies.Allow} lets runs pile up. The two behave identically while
 * nothing is in flight, which is why the difference only shows up under load or after an outage.
 *
 * Called by: `__RunScheduleTick` in
 * libs/backend/server/agents/scheduling/main/src/schedule-tick.ts decides per-slot behaviour from
 * this value; `prisma-schedule-tick-repositories.ts` and `prisma-agent-schedule.ts` map it to and
 * from the Prisma enum.
 */
export enum AgentScheduleOverlapPolicies
{
	/**
	 * Never run two scheduled runs at once.
	 *
	 * At each tick the scheduler first asks whether any earlier scheduled run of this service is still
	 * running. If one is, every slot that came due is dropped and the cursor jumps to the newest of
	 * them, so they never fire late. If none is, exactly one run starts — the oldest due slot — and
	 * the rest of a catch-up backlog is left for later ticks. Pick this for a job that would corrupt
	 * its own output if two copies ran together.
	 */
	Skip = "skip",
	/**
	 * Let scheduled runs overlap.
	 *
	 * Every slot that came due starts a run, even if an earlier scheduled run is still going. After an
	 * outage this means the whole catch-up backlog fires at once, up to the tick's slot limit. Each
	 * slot still gets one run and one only, because the idempotency key is derived from the slot
	 * instant — but there is no cap on how many of them run concurrently. Pick this only for jobs that
	 * are safe to run in parallel with themselves.
	 */
	Allow = "allow",
}

/** The overlap-policy values as plain strings (`"skip" | "allow"`), for JSON bodies and stored rows that hold the value without importing the enum. */
export type AgentScheduleOverlapPolicy = `${AgentScheduleOverlapPolicies}`;

/**
 * One stored recurring schedule for a managed agent service. A service may have several.
 *
 * This is the row the HTTP surface returns and the scheduler reads. It holds no run state beyond
 * `lastScheduledAt`, which is the cursor marking how far evaluation has got.
 */
export interface AgentServiceScheduleRecord
{
	/** Stable schedule identifier. */
	readonly id: string;
	/** Silo owning the schedule and its service. */
	readonly siloId: SiloId;
	/** Managed service whose active revision each due slot admits. */
	readonly agentServiceId: AgentServiceId;
	/** Five-field cron expression (minute hour day-of-month month day-of-week), read in `timezone` rather than UTC. */
	readonly cron: string;
	/** IANA timezone the cron expression is evaluated in. */
	readonly timezone: string;
	/** What to do when a slot comes due while an earlier scheduled run is still going — see {@link AgentScheduleOverlapPolicies}. */
	readonly overlapPolicy: AgentScheduleOverlapPolicy;
	/** Whether evaluation is active; `false` suspends the schedule without deleting it. */
	readonly enabled: boolean;
	/**
	 * How far back the scheduler will reach for slots it missed, in seconds.
	 *
	 * After downtime the scheduler replays only the slots inside this window, oldest first; anything
	 * older is dropped and never runs. `0` means never catch up — only fire slots due right now.
	 * Accepted range is 0 to 604800 (7 days), checked in `__CreateAgentSchedule` /
	 * `__UpdateAgentSchedule`; anything else is refused as `invalid_command`.
	 */
	readonly catchupWindowSeconds: number;
	/** Cursor: the newest slot already dealt with. The next tick only considers slots after this instant, so advancing it is what stops a slot from firing twice. Null before the schedule first fires. */
	readonly lastScheduledAt: string | null;
	/** ISO-8601 creation instant. */
	readonly createdAt: string;
	/** ISO-8601 last-update instant. */
	readonly updatedAt: string;
}

/** Command that creates one schedule for a managed service. */
export interface CreateAgentScheduleCommand
{
	/** Authenticated local Principal requesting the schedule change. */
	readonly principalId: string;
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
	/**
	 * How far back the scheduler will reach for slots it missed, in seconds.
	 *
	 * After downtime the scheduler replays only the slots inside this window, oldest first; anything
	 * older is dropped and never runs. `0` means never catch up — only fire slots due right now.
	 * Accepted range is 0 to 604800 (7 days), checked in `__CreateAgentSchedule` /
	 * `__UpdateAgentSchedule`; anything else is refused as `invalid_command`.
	 */
	readonly catchupWindowSeconds: number;
}

/** Command that updates one existing schedule's mutable fields. */
export interface UpdateAgentScheduleCommand
{
	/** Authenticated local Principal requesting the schedule change. */
	readonly principalId: string;
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

/**
 * Why a schedule create, update, or delete was refused. The router upper-cases the value into the
 * response `code`.
 * - `invalid_command` (400): an id was empty, `catchupWindowSeconds` was outside 0–604800, or the
 *   timestamp did not parse.
 * - `invalid_cron` (400): not five whitespace-separated fields, or a field is malformed.
 * - `invalid_timezone` (400): not a timezone name `Intl.DateTimeFormat` can resolve.
 * - `service_not_found` (404): no such service in the caller's silo.
 * - `service_not_managed` (409): the service exists but is a personal agent; only managed services
 *   can be scheduled.
 * - `schedule_not_found` (404): no schedule with that id on that service in that silo.
 */
export type AgentScheduleDenial =
	| "invalid_command"
	| "unauthorized"
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

/**
 * Stores the recurring schedules attached to managed agent services.
 *
 * Every method is scoped to one silo, and creation additionally requires the target service to exist
 * in that silo and be a managed service. A service in another silo is refused as
 * `service_not_found`, indistinguishable from one that does not exist, so a caller cannot probe for
 * foreign services. This port only stores rows; the scheduler in
 * libs/backend/server/agents/scheduling reads them and decides when runs happen.
 *
 * Implemented by: `PrismaAgentScheduleUnitOfWork` in `db/prisma-agent-schedule.ts`.
 * Called by: {@link __CreateAgentSchedule} and {@link __UpdateAgentSchedule} in `agent-schedule.ts`;
 * `deleteSchedule` and `listSchedules` are called straight from the schedule handlers in
 * `agent-revision.router.ts`.
 */
export interface AgentScheduleRepository
{
	/** Creates one schedule for a managed service in the caller's silo. */
	createSchedule(command: CreateAgentScheduleCommand, createdAt: string): Promise<AgentScheduleMutationResult>;
	/** Updates one schedule's mutable fields, silo-scoped. */
	updateSchedule(command: UpdateAgentScheduleCommand, updatedAt: string): Promise<AgentScheduleMutationResult>;
	/** Deletes one schedule, silo-scoped. */
	deleteSchedule(command: { readonly principalId: string; readonly agentServiceId: AgentServiceId; readonly scheduleId: string; readonly siloId: SiloId }, deletedAt: string): Promise<AgentScheduleDeletionResult>;
	/** Lists the schedules of one service, silo-scoped. */
	listSchedules(agentServiceId: AgentServiceId, caller: { readonly principalId: string; readonly siloId: SiloId }): Promise<readonly AgentServiceScheduleRecord[]>;
}
