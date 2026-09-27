import { describe, expect, it } from "vitest";

import { ___RoutineControlRequestSchema, ___RoutineCreateRequestSchema, ___RoutineReviseRequestSchema } from "../../index";

const _SCHEDULE = { expression: "0 9 * * 1", timezone: "UTC" };

const _CREATE = {
	destinationConversationId: "conversation-1",
	audiencePrincipalIds: ["principal-1", "principal-2"],
	selectedManagedServiceId: "service-1",
	schedule: _SCHEDULE,
	instruction: "  Review the latest report.  ",
	idempotencyKey: "routine-create-1",
};

describe("routine command contracts", function _Suite()
{
	it("normalizes bounded create fields and schedule", function _NormalizesCreate()
	{
		expect(___RoutineCreateRequestSchema.parse({ ..._CREATE, idempotencyKey: "  retry-1  " })).toEqual({ ..._CREATE, instruction: "Review the latest report.", idempotencyKey: "retry-1" });
	});

	it.each([
		{ audiencePrincipalIds: ["principal-1", "principal-1"] },
		{ destinationConversationId: " conversation-1" },
		{ selectedManagedServiceId: "service-1 " },
		{ audiencePrincipalIds: ["principal-1 "] },
		{ instruction: "   " },
		{ idempotencyKey: "   " },
		{ caller: "forged" },
		{ budget: 10 },
	])("rejects duplicate, blank, or authority-bearing create input", function _RejectsCreate(overrides)
	{
		expect(___RoutineCreateRequestSchema.safeParse({ ..._CREATE, ...overrides }).success).toBe(false);
	});

	it("accepts revision and control commands only with positive safe revisions", function _AcceptsCommands()
	{
		expect(___RoutineReviseRequestSchema.safeParse({ expectedRevision: 1, expectedLifecycleRevision: 2, schedule: _SCHEDULE, instruction: "Keep watching.", idempotencyKey: "revise-1" }).success).toBe(true);
		expect(___RoutineControlRequestSchema.safeParse({ expectedLifecycleRevision: Number.MAX_SAFE_INTEGER, idempotencyKey: "control-1" }).success).toBe(true);
		expect(___RoutineControlRequestSchema.safeParse({ expectedLifecycleRevision: 0, idempotencyKey: "control-1" }).success).toBe(false);
	});

	it("rejects unknown fields on every command shape", function _RejectsExtensions()
	{
		expect(___RoutineReviseRequestSchema.safeParse({ expectedRevision: 1, expectedLifecycleRevision: 1, schedule: _SCHEDULE, instruction: "Keep watching.", idempotencyKey: "revise-1", approval: true }).success).toBe(false);
		expect(___RoutineControlRequestSchema.safeParse({ expectedLifecycleRevision: 1, idempotencyKey: "control-1", spendingLimit: 5 }).success).toBe(false);
	});
});
