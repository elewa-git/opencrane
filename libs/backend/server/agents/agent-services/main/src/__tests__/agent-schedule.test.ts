import { describe, expect, it } from "vitest";

import { __CreateAgentSchedule, __UpdateAgentSchedule } from "../agent-schedule.js";
import { AgentScheduleOverlapPolicies, type AgentScheduleMutationResult, type AgentScheduleRepository, type AgentServiceScheduleRecord, type CreateAgentScheduleCommand, type UpdateAgentScheduleCommand } from "../agent-schedule.types.js";

/** In-memory schedule repository that records the last create/update it received. */
class _Repository implements AgentScheduleRepository
{
	lastCreate: CreateAgentScheduleCommand | null = null;
	lastUpdate: UpdateAgentScheduleCommand | null = null;
	async createSchedule(command: CreateAgentScheduleCommand, createdAt: string): Promise<AgentScheduleMutationResult>
	{
		this.lastCreate = command;
		return { outcome: "ok", schedule: _record(command.cron, command.timezone, createdAt) };
	}
	async updateSchedule(command: UpdateAgentScheduleCommand, updatedAt: string): Promise<AgentScheduleMutationResult>
	{
		this.lastUpdate = command;
		return { outcome: "ok", schedule: _record(command.cron, command.timezone, updatedAt) };
	}
	async deleteSchedule(): Promise<{ outcome: "deleted" }> { return { outcome: "deleted" }; }
	async listSchedules(): Promise<readonly AgentServiceScheduleRecord[]> { return []; }
}

/** Builds a schedule record fixture. */
function _record(cron: string, timezone: string, at: string): AgentServiceScheduleRecord
{
	return { id: "sched-1", siloId: "silo-1", agentServiceId: "svc-1", cron, timezone, overlapPolicy: AgentScheduleOverlapPolicies.Skip, enabled: true, catchupWindowSeconds: 3600, lastScheduledAt: null, createdAt: at, updatedAt: at };
}

/** Builds a valid create command with optional overrides. */
function _create(overrides: Partial<CreateAgentScheduleCommand> = {}): CreateAgentScheduleCommand
{
	return { siloId: "silo-1", agentServiceId: "svc-1", cron: "0 9 * * 1-5", timezone: "Europe/Brussels", overlapPolicy: AgentScheduleOverlapPolicies.Skip, enabled: true, catchupWindowSeconds: 3600, ...overrides };
}

describe("schedule create/update validation", function _Suite()
{
	it("creates a schedule with a well-formed cron and timezone", async function _CreatesValid()
	{
		const repository = new _Repository();
		const result = await __CreateAgentSchedule(repository, _create(), "2026-07-01T00:00:00.000Z");
		expect(result.outcome).toBe("ok");
		expect(repository.lastCreate?.cron).toBe("0 9 * * 1-5");
	});

	it("rejects a malformed cron before touching the repository", async function _RejectsCron()
	{
		const repository = new _Repository();
		const result = await __CreateAgentSchedule(repository, _create({ cron: "0 9 * *" }), "2026-07-01T00:00:00.000Z");
		expect(result).toEqual({ outcome: "denied", reason: "invalid_cron" });
		expect(repository.lastCreate).toBeNull();
	});

	it("rejects an unknown timezone", async function _RejectsZone()
	{
		const repository = new _Repository();
		const result = await __CreateAgentSchedule(repository, _create({ timezone: "Not/AZone" }), "2026-07-01T00:00:00.000Z");
		expect(result).toEqual({ outcome: "denied", reason: "invalid_timezone" });
	});

	it("rejects an out-of-range catch-up window", async function _RejectsWindow()
	{
		const repository = new _Repository();
		expect((await __CreateAgentSchedule(repository, _create({ catchupWindowSeconds: -1 }), "2026-07-01T00:00:00.000Z")).outcome).toBe("denied");
		expect((await __CreateAgentSchedule(repository, _create({ catchupWindowSeconds: 999_999_999 }), "2026-07-01T00:00:00.000Z")).outcome).toBe("denied");
	});

	it("validates the same rules on update", async function _UpdateValidates()
	{
		const repository = new _Repository();
		const bad = await __UpdateAgentSchedule(repository, { siloId: "silo-1", agentServiceId: "svc-1", scheduleId: "sched-1", cron: "bad", timezone: "UTC", overlapPolicy: AgentScheduleOverlapPolicies.Allow, enabled: false, catchupWindowSeconds: 60 }, "2026-07-01T00:00:00.000Z");
		expect(bad).toEqual({ outcome: "denied", reason: "invalid_cron" });
		const ok = await __UpdateAgentSchedule(repository, { siloId: "silo-1", agentServiceId: "svc-1", scheduleId: "sched-1", cron: "*/15 * * * *", timezone: "UTC", overlapPolicy: AgentScheduleOverlapPolicies.Allow, enabled: false, catchupWindowSeconds: 60 }, "2026-07-01T00:00:00.000Z");
		expect(ok.outcome).toBe("ok");
	});
});
