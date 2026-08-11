import { AgentRunState, ElicitationPurpose, ElicitationRequestState, ElicitationResponseAttemptState, Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { __DigestCanonicalJson } from "@opencrane/backend/server/iam/authorization";
import { ElicitationBodyKinds, ElicitationPurposes } from "@opencrane/contracts";

import { PrismaElicitationUnitOfWork } from "../prisma-elicitation-unit-of-work.js";

const NOW = new Date("2026-08-11T10:00:00.000Z");

/** Bind one transaction double to the process-owned unit-of-work boundary. */
function _Unit(transaction: object): PrismaElicitationUnitOfWork
{
	return new PrismaElicitationUnitOfWork({ $transaction: vi.fn(async function _Transaction(operation) { return operation(transaction); }) } as never);
}

/** Complete ordinary request row shared by response cases. */
function _Request(overrides: Readonly<Record<string, unknown>> = {})
{
	return { id: "request-1", siloId: "silo-1", conversationId: "conversation-1", runId: "run-1", attempt: 2, assignedParticipantId: "user-1", requestKey: "question-1", purpose: ElicitationPurpose.RuntimeInput, bodyKind: "FreeText", body: { kind: ElicitationBodyKinds.FreeText, prompt: "Answer", maximumLength: 100, allowEmpty: false }, bodyDigest: "sha256:body", purposePayload: null, purposePayloadDigest: "sha256:none", state: ElicitationRequestState.Requested, requiresStepUp: false, expiresAt: new Date("2026-08-11T11:00:00.000Z"), resolvedAt: null, resolvedBy: null, safeReason: null, createdAt: NOW, ...overrides };
}

/** Transaction double for a successful response. */
function _ResponseTransaction(request = _Request())
{
	return {
		elicitationRequest: { findUnique: vi.fn().mockResolvedValue(request), updateMany: vi.fn().mockResolvedValue({ count: 1 }), count: vi.fn().mockResolvedValue(0) },
		elicitationResponseAttempt: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: "attempt-1" }), update: vi.fn().mockResolvedValue({}) },
		conversationParticipant: { findUnique: vi.fn().mockResolvedValue({ accessEndedPosition: null }) },
		agentRun: { findUnique: vi.fn().mockResolvedValue({ id: "run-1", attempt: 2, state: AgentRunState.WaitingForInput }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
		elicitationResultDelivery: { create: vi.fn().mockResolvedValue({ id: "delivery-1" }) },
		personalMemoryPermissionReceipt: { create: vi.fn().mockResolvedValue({ id: "receipt-1" }) },
	};
}

describe("PrismaElicitationUnitOfWork", function _Suite()
{
	it("pauses and opens one exact server-owned request in one transaction", async function _Opens()
	{
		const transaction = {
			elicitationRequest: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockImplementation(async function _Create(input) { return { ..._Request(), ...input.data }; }) },
			agentRun: { findUnique: vi.fn().mockResolvedValue({ id: "run-1", siloId: "silo-1", conversationId: "conversation-1", attempt: 2, state: AgentRunState.Running }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
			conversationParticipant: { findUnique: vi.fn().mockResolvedValue({ accessEndedPosition: null }) },
		};
		const body = { kind: ElicitationBodyKinds.FreeText, prompt: "Answer", maximumLength: 100, allowEmpty: false } as const;
		await expect(_Unit(transaction).open({ requestId: "request-1", siloId: "silo-1", conversationId: "conversation-1", runId: "run-1", attempt: 2, assignedParticipantId: "user-1", requestKey: "question-1", purpose: ElicitationPurposes.RuntimeInput, body, purposePayloadDigest: "sha256:none", requiresStepUp: false, now: NOW, expiresAt: new Date("2026-08-11T11:00:00.000Z") })).resolves.toMatchObject({ requestId: "request-1", runId: "run-1", state: "requested" });
		expect(transaction.agentRun.updateMany).toHaveBeenCalledWith({ where: { id: "run-1", attempt: 2, state: AgentRunState.Running }, data: { state: AgentRunState.WaitingForInput } });
		expect(transaction.elicitationRequest.create).toHaveBeenCalledWith({ data: expect.objectContaining({ runId: "run-1", attempt: 2, assignedParticipantId: "user-1", bodyDigest: __DigestCanonicalJson(body) }) });
	});

	it("accepts one typed answer, creates its delivery, and resumes after the final request", async function _Answers()
	{
		const transaction = _ResponseTransaction();
		await expect(_Unit(transaction).respond({ siloId: "silo-1", conversationId: "conversation-1", requestId: "request-1", subjectId: "user-1", verifiedStepUpAt: null, submission: { idempotencyKey: "retry-1", response: { kind: ElicitationBodyKinds.FreeText, text: "Done" } }, now: NOW })).resolves.toEqual({ outcome: "accepted", projection: { requestId: "request-1", state: "answered", idempotent: false, resolvedAt: NOW.toISOString() } });
		expect(transaction.elicitationResultDelivery.create).toHaveBeenCalledTimes(1);
		expect(transaction.elicitationResponseAttempt.update).toHaveBeenCalledWith({ where: { id: "attempt-1" }, data: { state: ElicitationResponseAttemptState.Accepted, completedAt: NOW } });
		expect(transaction.agentRun.updateMany).toHaveBeenCalledTimes(1);
	});

	it("replays only an identical accepted idempotency key", async function _Replays()
	{
		const request = _Request({ state: ElicitationRequestState.Answered, resolvedAt: NOW });
		const transaction = _ResponseTransaction(request);
		transaction.elicitationResponseAttempt.findUnique.mockResolvedValueOnce({ responseDigest: __DigestCanonicalJson({ kind: ElicitationBodyKinds.FreeText, text: "Done" }), state: ElicitationResponseAttemptState.Accepted });
		await expect(_Unit(transaction).respond({ siloId: "silo-1", conversationId: "conversation-1", requestId: "request-1", subjectId: "user-1", verifiedStepUpAt: null, submission: { idempotencyKey: "retry-1", response: { kind: ElicitationBodyKinds.FreeText, text: "Done" } }, now: NOW })).resolves.toMatchObject({ outcome: "accepted", projection: { idempotent: true } });
		expect(transaction.elicitationRequest.updateMany).not.toHaveBeenCalled();
	});

	it("turns memory approval into only an exact one-use receipt", async function _MemoryPermission()
	{
		const payload = { executionSubjectId: "user-1", queryDigest: "sha256:query", invocationKey: "memory-call-1", expiresAt: "2026-08-11T10:10:00.000Z" };
		const request = _Request({ purpose: ElicitationPurpose.PersonalMemoryPermission, bodyKind: "Approval", body: { kind: ElicitationBodyKinds.Approval, prompt: "Allow memory?", action: "Recall", target: "personal memory", dataUse: "Use remembered facts", consequence: "One answer may use memory" }, purposePayload: payload, purposePayloadDigest: __DigestCanonicalJson(payload) });
		const transaction = _ResponseTransaction(request);
		await expect(_Unit(transaction).respond({ siloId: "silo-1", conversationId: "conversation-1", requestId: "request-1", subjectId: "user-1", verifiedStepUpAt: null, submission: { idempotencyKey: "retry-1", response: { kind: ElicitationBodyKinds.Approval, approved: true } }, now: NOW })).resolves.toMatchObject({ outcome: "accepted" });
		expect(transaction.personalMemoryPermissionReceipt.create).toHaveBeenCalledWith({ data: expect.objectContaining({ requestId: "request-1", runId: "run-1", attempt: 2, executionSubjectId: "user-1", queryDigest: "sha256:query", invocationKey: "memory-call-1" }) });
		expect(transaction.elicitationResultDelivery.create).not.toHaveBeenCalled();
	});

	it("returns a display-only A2UI answer with only its protected server binding", async function _A2uiBinding()
	{
		const payload = { displayedActionId: "action-1", sourceComponentId: "card-1", actionDigest: "sha256:action" };
		const request = _Request({ purpose: ElicitationPurpose.A2uiAction, purposePayload: payload, purposePayloadDigest: __DigestCanonicalJson(payload) });
		const transaction = _ResponseTransaction(request);
		await expect(_Unit(transaction).respond({ siloId: "silo-1", conversationId: "conversation-1", requestId: "request-1", subjectId: "user-1", verifiedStepUpAt: null, submission: { idempotencyKey: "retry-1", response: { kind: ElicitationBodyKinds.FreeText, text: "Confirmed" } }, now: NOW })).resolves.toMatchObject({ outcome: "accepted" });
		expect(transaction.elicitationResultDelivery.create).toHaveBeenCalledWith({ data: expect.objectContaining({ requestId: "request-1", payload: { kind: "a2ui_action", displayedActionId: "action-1", sourceComponentId: "card-1", actionDigest: "sha256:action", response: { kind: ElicitationBodyKinds.FreeText, text: "Confirmed" } } }) });
	});
});
