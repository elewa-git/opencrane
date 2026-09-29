import { AgentRunTriggers } from "@opencrane/models/agents";
import { describe, expect, it } from "vitest";

import { ___RunInputOriginSchema } from "../inputs/run-input-origin.validator";

/** Builds complete automatic routine provenance. */
function _ScheduledOrigin(): Readonly<Record<string, unknown>>
{
	return { kind: AgentRunTriggers.Scheduled, routineId: "routine-1", routineRevision: 3, firingId: "firing-1", scheduledSlot: "2026-09-25T10:00:00.000Z", requesterPrincipalId: "principal-1", requesterIssuer: "https://issuer.example", requesterSubjectId: "subject-1", requesterAuthenticatedAt: "2026-09-01T08:00:00.000Z", workflowTaskId: "task-1", workflowTaskName: "routine-occurrence", workflowTaskKey: "firing-1" };
}

describe("run input origin validation", function _Suite()
{
	it("accepts exact interactive, scheduled and manual provenance", function _Valid()
	{
		expect(___RunInputOriginSchema.safeParse({ kind: AgentRunTriggers.Interactive, messageId: "message-1", historyRevision: "17" }).success).toBe(true);
		expect(___RunInputOriginSchema.safeParse(_ScheduledOrigin()).success).toBe(true);
		expect(___RunInputOriginSchema.safeParse({ ..._ScheduledOrigin(), kind: AgentRunTriggers.Manual, scheduledSlot: null }).success).toBe(true);
	});

	it("preserves accepted evidence byte-for-byte instead of normalizing digest input", function _PreservesEvidence()
	{
		const origin = { ..._ScheduledOrigin(), workflowTaskName: " routine-occurrence " };
		expect(___RunInputOriginSchema.parse(origin)).toEqual(origin);
	});

	it.each([
		{ ..._ScheduledOrigin(), routineRevision: 0 },
		{ ..._ScheduledOrigin(), workflowTaskId: undefined },
		{ ..._ScheduledOrigin(), workflowTaskName: "   " },
		{ ..._ScheduledOrigin(), scheduledSlot: null },
		{ ..._ScheduledOrigin(), kind: AgentRunTriggers.Manual },
		{ ..._ScheduledOrigin(), extra: true },
	])("rejects invalid revisions, workflow provenance, trigger slots and unknown fields", function _Invalid(origin)
	{
		expect(___RunInputOriginSchema.safeParse(origin).success).toBe(false);
	});
});
