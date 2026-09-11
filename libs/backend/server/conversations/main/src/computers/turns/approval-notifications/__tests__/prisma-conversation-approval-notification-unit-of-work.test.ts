import { describe, expect, it, vi } from "vitest";

import { PrismaElicitationRepository } from "@opencrane/backend/agents/execution/elicitation";
import { ElicitationBodyKinds, ElicitationPurposes, ElicitationRequestStates } from "@opencrane/contracts";

import { PrismaConversationApprovalNotificationUnitOfWork } from "../prisma-conversation-approval-notification-unit-of-work";

const _APPROVAL_ID = "61c1f1dc-0010-4f13-9c2f-d3841ffd6651";
const _COMMAND = { bootstrapId: "turn-1", siloId: "silo-1", conversationId: "conversation-1", runId: "run-1", attempt: 1, approvalId: _APPROVAL_ID };
const _REQUEST = { version: "opencrane.elicitation.v1", requestId: _APPROVAL_ID, conversationId: "conversation-1", runId: "run-1", attempt: 1, assignedParticipantId: "user-1", purpose: ElicitationPurposes.ToolApproval, state: ElicitationRequestStates.Requested, body: { kind: ElicitationBodyKinds.Approval, prompt: "Review", action: "Invoke tool", target: "target", dataUse: "Reviewed values", consequence: "External action" }, requiresStepUp: true, requestedAt: "2026-09-10T10:00:00.000Z", expiresAt: "2026-09-10T10:05:00.000Z" } as const;

/** Build the transaction seams needed to verify exact approval identity. */
function _Fixture(approval = { runId: "run-1", attempt: 1, elicitationRequestId: _APPROVAL_ID, toolInvocation: { toolInvocationId: _APPROVAL_ID }, state: "Pending" })
{
	const transaction = { elicitationRequest: { findUnique: vi.fn().mockResolvedValue({ assignedParticipantId: "user-1" }) }, approvalRequest: { findUnique: vi.fn().mockResolvedValue(approval) } };
	const prisma = { $transaction: vi.fn(async function _Transaction(work) { return work(transaction); }) };
	return { prisma, transaction };
}

describe("Prisma approval notification request reader", function _Suite()
{
	it("requires the public approval, elicitation, and tool invocation identity to match", async function _ExactIdentity()
	{
		const fixture = _Fixture();
		vi.spyOn(PrismaElicitationRepository.prototype, "readOwned").mockResolvedValueOnce(_REQUEST);
		const reader = new PrismaConversationApprovalNotificationUnitOfWork(fixture.prisma as never);
		await expect(reader.readCurrent(_COMMAND, new Date("2026-09-10T10:01:00.000Z"))).resolves.toEqual(_REQUEST);
		expect(PrismaElicitationRepository.prototype.readOwned).toHaveBeenCalledWith("silo-1", "conversation-1", _APPROVAL_ID, "user-1", new Date("2026-09-10T10:01:00.000Z"));
	});

	it("returns null for a substituted invocation or revoked owned read", async function _Denied()
	{
		const substituted = _Fixture({ runId: "run-1", attempt: 1, elicitationRequestId: _APPROVAL_ID, toolInvocation: { toolInvocationId: "other" }, state: "Pending" });
		vi.spyOn(PrismaElicitationRepository.prototype, "readOwned").mockResolvedValueOnce(_REQUEST);
		const reader = new PrismaConversationApprovalNotificationUnitOfWork(substituted.prisma as never);
		await expect(reader.readCurrent(_COMMAND, new Date())).resolves.toBeNull();

		const revoked = _Fixture();
		vi.spyOn(PrismaElicitationRepository.prototype, "readOwned").mockResolvedValueOnce(null);
		await expect(new PrismaConversationApprovalNotificationUnitOfWork(revoked.prisma as never).readCurrent(_COMMAND, new Date())).resolves.toBeNull();
	});
});
