import { AgentServiceKind } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { AgentScheduleOverlapPolicies } from "../agent-schedule.types";
import { PrismaAgentScheduleUnitOfWork } from "../db/prisma-agent-schedule";

describe("PrismaAgentScheduleUnitOfWork", function _Suite()
{
	it("creates a schedule from its collection grant and seeds exact item grants", async function _CreatesAuthorizedSchedule()
	{
		const authorizationGrantCreate = vi.fn().mockResolvedValue({});
		const transaction = {
			agentService: { findFirst: vi.fn().mockResolvedValue({ kind: AgentServiceKind.Managed }) },
			agentServiceSchedule: { create: vi.fn().mockImplementation(async function _Create(input) { return { id: "schedule-1", ...input.data, lastScheduledAt: null }; }) },
			authorizationGrant: { findMany: vi.fn().mockResolvedValue([]), create: authorizationGrantCreate, updateMany: vi.fn() },
			auditEntry: { create: vi.fn().mockResolvedValue({}) },
		};
		const prisma = { $transaction: vi.fn(async function _Transaction(callback) { return callback(transaction); }) };
		const admitPrincipal = vi.fn().mockResolvedValue({ outcome: "allow" });
		const repository = new PrismaAgentScheduleUnitOfWork(prisma as never, function _Authorization() { return { admitPrincipal } as never; });

		const result = await repository.createSchedule({ principalId: "principal-1", siloId: "silo-1", agentServiceId: "service-1", cron: "0 9 * * 1-5", timezone: "UTC", overlapPolicy: AgentScheduleOverlapPolicies.Skip, enabled: true, catchupWindowSeconds: 3_600 }, "2026-08-29T00:00:00.000Z");

		expect(result.outcome).toBe("ok");
		expect(admitPrincipal).toHaveBeenCalledWith(expect.objectContaining({ action: "create", resource: { kind: "schedule", id: "service-1" } }));
		expect(authorizationGrantCreate).toHaveBeenCalledTimes(3);
		expect(authorizationGrantCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ managerId: "agent-schedule-creator-bootstrap", resourceKind: "schedule", resourceId: "schedule-1", subjectPrincipalId: "principal-1" }) });
	});

	it("denies schedule creation before persistence when the exact collection grant is absent", async function _DeniesUnauthorizedCreate()
	{
		const transaction = {
			agentService: { findFirst: vi.fn().mockResolvedValue({ kind: AgentServiceKind.Managed }) },
			agentServiceSchedule: { create: vi.fn() },
		};
		const prisma = { $transaction: vi.fn(async function _Transaction(callback) { return callback(transaction); }) };
		const admitPrincipal = vi.fn().mockResolvedValue({ outcome: "deny" });
		const repository = new PrismaAgentScheduleUnitOfWork(prisma as never, function _Authorization() { return { admitPrincipal } as never; });

		const result = await repository.createSchedule({ principalId: "principal-1", siloId: "silo-1", agentServiceId: "service-1", cron: "0 9 * * 1-5", timezone: "UTC", overlapPolicy: AgentScheduleOverlapPolicies.Skip, enabled: true, catchupWindowSeconds: 3_600 }, "2026-08-29T00:00:00.000Z");

		expect(result).toEqual({ outcome: "denied", reason: "unauthorized" });
		expect(admitPrincipal).toHaveBeenCalledWith(expect.objectContaining({ principalId: "principal-1", action: "create", resource: { kind: "schedule", id: "service-1" } }));
		expect(transaction.agentServiceSchedule.create).not.toHaveBeenCalled();
		expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
	});
});
