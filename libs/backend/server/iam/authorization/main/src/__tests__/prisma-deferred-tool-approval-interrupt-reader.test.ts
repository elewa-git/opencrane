import { ApprovalRequestState } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { _CreateDeferredToolApprovalInterruptReader } from "../prisma-deferred-tool-approval-interrupt-reader.js";

/** Build the actor-safe approval row returned by the bounded Prisma projection. */
function _ApprovalRow(responseSchema: unknown = { type: "object", required: ["decision"], properties: { decision: { enum: ["denied"] } } })
{
	return {
		id: "approval-1",
		runId: "run-1",
		attempt: 1,
		resourceId: "integration:calendar:write",
		toolInvocation: { toolInvocationId: "tool-call-1" },
		state: ApprovalRequestState.Pending,
		safeProposedArguments: { title: "safe", accessToken: "must-not-project" },
		responseSchema,
		expiresAt: new Date("2026-08-11T00:05:00.000Z"),
		createdAt: new Date("2026-08-11T00:00:00.000Z"),
	};
}

/** Wrap one transaction double in the root-client callback boundary. */
function _Prisma(transaction: unknown)
{
	return { $transaction: vi.fn(async function _transaction(operation) { return operation(transaction); }) };
}

describe("Deferred-tool approval interrupt reader", function _describeInterruptReader()
{
	it("projects a current owner-bound approval without argument or authority material", async function _projectsSafeInterrupt()
	{
		const findMany = vi.fn(async function _findMany() { return [_ApprovalRow()]; });
		const reader = _CreateDeferredToolApprovalInterruptReader(_Prisma({ orgMembership: { findFirst: vi.fn(async function _membership() { return { id: "membership-1" }; }) }, approvalRequest: { findMany } }) as never);

		const events = await reader.readOpen({ conversationId: "conversation-1", siloId: "silo-1", subjectId: "subject-1" });

		expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ siloId: "silo-1", subjectId: "subject-1", run: { conversationId: "conversation-1" } }) }));
		expect(events).toEqual([expect.objectContaining({ conversationId: "conversation-1", runId: "run-1", eventType: "tool.approval_required", payload: { interrupt: expect.objectContaining({ id: "approval-1", reason: "tool_approval", toolCallId: "tool-call-1" }) } })]);
		expect(JSON.stringify(events)).not.toContain("must-not-project");
		expect(JSON.stringify(events)).not.toContain("accessToken");
	});

	it("fails closed when the durable response schema is not an object", async function _rejectsInvalidSchema()
	{
		const reader = _CreateDeferredToolApprovalInterruptReader(_Prisma({ orgMembership: { findFirst: vi.fn(async function _membership() { return { id: "membership-1" }; }) }, approvalRequest: { findMany: vi.fn(async function _findMany() { return [_ApprovalRow("invalid")]; }) } }) as never);

		await expect(reader.readOpen({ conversationId: "conversation-1", siloId: "silo-1", subjectId: "subject-1" })).rejects.toThrow("response schema is not an object");
	});
});
