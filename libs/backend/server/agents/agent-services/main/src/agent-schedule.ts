import type { AgentScheduleMutationResult, AgentScheduleRepository, CreateAgentScheduleCommand, UpdateAgentScheduleCommand } from "./agent-schedule.types.js";

/** Single cron field: `*`, an integer, list, range, or step, in the standard grammar. */
const _CRON_FIELD = /^(\*|(\d+)(-\d+)?)(\/\d+)?(,(\*|(\d+)(-\d+)?)(\/\d+)?)*$/;

/**
 * Shape-validate a 5-field cron expression at the management boundary.
 * This is a defence-in-depth check; the scheduler is the authority that fully parses the expression
 * and fails closed at tick time, so this only rejects obviously malformed input early.
 */
function _isWellFormedCron(cron: string): boolean
{
	const fields = cron.trim().split(/\s+/);
	return fields.length === 5 && fields.every(field => _CRON_FIELD.test(field));
}

/** Return whether a string names a resolvable IANA timezone. */
function _isValidTimezone(timezone: string): boolean
{
	try
	{
		new Intl.DateTimeFormat("en-US", { timeZone: timezone });
		return true;
	}
	catch
	{
		return false;
	}
}

/** Return whether a catch-up horizon is a sane, bounded positive integer (≤ 7 days). */
function _isBoundedCatchup(seconds: number): boolean
{
	return Number.isSafeInteger(seconds) && seconds >= 0 && seconds <= 604_800;
}

/**
 * Create one schedule for a managed service after validating cron, timezone, and bounds.
 * @param repository - Silo-scoped schedule persistence boundary.
 * @param command - Create command.
 * @param createdAt - Trusted ISO-8601 creation instant.
 * @returns The created schedule, or a fail-closed reason.
 */
export async function __CreateAgentSchedule(repository: AgentScheduleRepository, command: CreateAgentScheduleCommand, createdAt: string): Promise<AgentScheduleMutationResult>
{
	if (!command.siloId.trim() || !command.agentServiceId.trim() || !_isBoundedCatchup(command.catchupWindowSeconds) || !Number.isFinite(Date.parse(createdAt))) return { outcome: "denied", reason: "invalid_command" };
	if (!_isWellFormedCron(command.cron)) return { outcome: "denied", reason: "invalid_cron" };
	if (!_isValidTimezone(command.timezone)) return { outcome: "denied", reason: "invalid_timezone" };
	return repository.createSchedule(command, createdAt);
}

/**
 * Update one schedule's mutable fields after validating cron, timezone, and bounds.
 * @param repository - Silo-scoped schedule persistence boundary.
 * @param command - Update command.
 * @param updatedAt - Trusted ISO-8601 update instant.
 * @returns The updated schedule, or a fail-closed reason.
 */
export async function __UpdateAgentSchedule(repository: AgentScheduleRepository, command: UpdateAgentScheduleCommand, updatedAt: string): Promise<AgentScheduleMutationResult>
{
	if (!command.siloId.trim() || !command.agentServiceId.trim() || !command.scheduleId.trim() || !_isBoundedCatchup(command.catchupWindowSeconds) || !Number.isFinite(Date.parse(updatedAt))) return { outcome: "denied", reason: "invalid_command" };
	if (!_isWellFormedCron(command.cron)) return { outcome: "denied", reason: "invalid_cron" };
	if (!_isValidTimezone(command.timezone)) return { outcome: "denied", reason: "invalid_timezone" };
	return repository.updateSchedule(command, updatedAt);
}
