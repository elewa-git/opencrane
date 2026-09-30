import { describe, expect, it } from "vitest";

import { ___RoutineControlRequestSchema, ___RoutineCreateRequestSchema, ___RoutineCreationOptionsQuerySchema, ___RoutineFiringListQuerySchema, ___RoutineListQuerySchema, ___RoutineReviseRequestSchema, ___RoutineSchedulePreviewRequestSchema } from "../../index";

const _SCHEDULE = { expression: "0 9 * * 1", timezone: "UTC" };

const _CREATE = {
	payingGroupId: "group-1",
	destinationConversationId: "conversation-1",
	audienceParticipantRefs: ["participant-1", "participant-2"],
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
		expect(___RoutineCreateRequestSchema.parse({ ..._CREATE, proposalRef: "proposal-1" }).proposalRef).toBe("proposal-1");
	});

	it.each([
		{ payingGroupId: "" },
		{ payingGroupId: " group-1" },
		{ audienceParticipantRefs: ["participant-1", "participant-1"] },
		{ destinationConversationId: " conversation-1" },
		{ selectedManagedServiceId: "service-1 " },
		{ audienceParticipantRefs: ["participant-1 "] },
		{ audiencePrincipalIds: ["principal-1"] },
		{ instruction: "   " },
		{ idempotencyKey: "   " },
		{ caller: "forged" },
		{ budget: 10 },
		{ proposalRef: " proposal-1" },
	])("rejects duplicate, blank, or authority-bearing create input", function _RejectsCreate(overrides)
	{
		expect(___RoutineCreateRequestSchema.safeParse({ ..._CREATE, ...overrides }).success).toBe(false);
	});

	it("requires an explicit paying group and never supplies a default", function _RequiresPayer()
	{
		const { payingGroupId: _ignored, ...withoutPayer } = _CREATE;
		expect(___RoutineCreateRequestSchema.safeParse(withoutPayer).success).toBe(false);
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

	it("applies bounded list defaults and opaque cursor validation", function _ValidatesReadQueries()
	{
		expect(___RoutineListQuerySchema.parse({})).toEqual({ limit: 20 });
		expect(___RoutineFiringListQuerySchema.safeParse({ limit: "25", cursor: "YWJjXzEyMw" }).success).toBe(true);
		expect(___RoutineListQuerySchema.safeParse({ limit: 26 }).success).toBe(false);
		expect(___RoutineListQuerySchema.safeParse({ limit: "01" }).success).toBe(false);
		expect(___RoutineListQuerySchema.safeParse({ limit: "1e1" }).success).toBe(false);
		expect(___RoutineListQuerySchema.safeParse({ limit: " 5" }).success).toBe(false);
		expect(___RoutineListQuerySchema.safeParse({ limit: ["5"] }).success).toBe(false);
		expect(___RoutineListQuerySchema.safeParse({ cursor: "not canonical!" }).success).toBe(false);
	});

	it("keeps creation options and preview requests strict", function _ValidatesReadRequests()
	{
		expect(___RoutineCreationOptionsQuerySchema.safeParse({ destinationConversationId: " conversation-1" }).success).toBe(false);
		expect(___RoutineCreationOptionsQuerySchema.safeParse({ destinationConversationId: "conversation-1", caller: "forged" }).success).toBe(false);
		expect(___RoutineSchedulePreviewRequestSchema.safeParse({ schedule: _SCHEDULE, idempotencyKey: "unexpected" }).success).toBe(false);
		expect(___RoutineSchedulePreviewRequestSchema.safeParse({ schedule: _SCHEDULE }).success).toBe(true);
	});
});
