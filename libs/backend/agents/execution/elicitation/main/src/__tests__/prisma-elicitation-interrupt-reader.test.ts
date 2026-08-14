import { ElicitationPurpose, ElicitationRequestState } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { ElicitationBodyKinds } from "@opencrane/contracts";

import { _CreateElicitationInterruptReader } from "../prisma-elicitation-interrupt-reader.js";

/** Build a process-owned Prisma double around one exact transaction. */
function _Prisma(transaction: object)
{
	return { $transaction: vi.fn(async function _Transaction(operation) { return operation(transaction); }) } as never;
}

describe("_CreateElicitationInterruptReader", function _Suite()
{
	it("projects every generic body through one cursorless browser-safe overlay", async function _Projects()
	{
		const row = { id: "request-1", siloId: "silo-1", conversationId: "conversation-1", runId: "run-1", attempt: 2, assignedParticipantId: "user-1", purpose: ElicitationPurpose.RuntimeInput, state: ElicitationRequestState.Requested, body: { kind: ElicitationBodyKinds.FreeText, prompt: "Which option?", maximumLength: 200, allowEmpty: false }, requiresStepUp: false, createdAt: new Date("2026-08-11T10:00:00.000Z"), expiresAt: new Date("2026-08-11T10:05:00.000Z"), resolvedAt: null, safeReason: null, purposePayload: { secret: "never" } };
		const findMany = vi.fn().mockResolvedValue([row]);
		const reader = _CreateElicitationInterruptReader(_Prisma({ orgMembership: { count: vi.fn().mockResolvedValue(1) }, conversationParticipant: { findFirst: vi.fn().mockResolvedValue({ userId: "user-1" }) }, elicitationRequest: { findMany } }));

		const [event] = await reader.readOpen({ conversationId: "conversation-1", siloId: "silo-1", subjectId: "user-1" });

		expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ siloId: "silo-1", conversationId: "conversation-1", assignedParticipantId: "user-1", state: ElicitationRequestState.Requested }) }));
		expect(event).toMatchObject({ conversationId: "conversation-1", runId: "run-1", eventType: "elicitation.requested", payload: { interrupt: { id: "request-1", reason: "runtime_input", message: "Which option?", metadata: { elicitation: { requestId: "request-1", body: { kind: "free_text" } } } } } });
		expect(JSON.stringify(event)).not.toContain("never");
	});
});
