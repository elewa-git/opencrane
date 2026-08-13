import { AgentRunState, ElicitationPurpose, ElicitationRequestState, ExternalActionClaimKind, PersonalMemoryPermissionReceiptState, Prisma, ToolInvocationState } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { __DigestCanonicalJson, ExternalActionClaimKinds, ExternalActionRecoveryModes, ToolInvocationStates, type ToolInvocationClaim, type ToolInvocationRecord } from "@opencrane/backend/server/iam/authorization";
import { ElicitationBodyKinds, ElicitationPurposes, RunInputSnapshotIdentityKinds, type RunInputSnapshot } from "@opencrane/contracts";
import { PERSONAL_MEMORY_RECALL_TOOL_REVISION } from "@opencrane/models/agents";

import { PrismaElicitationUnitOfWork } from "../prisma-elicitation-unit-of-work.js";
import { PrismaRuntimeElicitationUnitOfWork } from "../prisma-runtime-elicitation-unit-of-work.js";

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
		elicitationResponseAttempt: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: "attempt-1" }) },
		conversationParticipant: { findUnique: vi.fn().mockResolvedValue({ accessEndedPosition: null }) },
		agentRun: { findUnique: vi.fn().mockResolvedValue({ id: "run-1", attempt: 2, state: AgentRunState.WaitingForInput }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
		approvalRequest: { findUnique: vi.fn(), count: vi.fn().mockResolvedValue(0) },
		elicitationResultDelivery: { create: vi.fn().mockResolvedValue({ id: "delivery-1" }) },
		personalMemoryPermissionReceipt: { create: vi.fn().mockResolvedValue({ id: "receipt-1" }) },
		toolInvocation: { findUnique: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
		toolResultDelivery: { create: vi.fn().mockResolvedValue({ id: "tool-delivery-1" }) },
		runInputSnapshot: { findUnique: vi.fn() },
	};
}

/** Exact personal-memory ToolInvocation projection used by open and verify cases. */
function _MemoryInvocation(overrides: Partial<ToolInvocationRecord> = {}): ToolInvocationRecord
{
	return { id: "invocation-row-1", siloId: "silo-1", runId: "run-1", attempt: 2, agentRevisionId: "revision-1", subjectId: "user-1", candidateId: "candidate-1", toolInvocationId: "memory-call-1", toolRevisionId: PERSONAL_MEMORY_RECALL_TOOL_REVISION, arguments: { query: "remember this" }, argumentsDigest: __DigestCanonicalJson({ query: "remember this" }), effectiveArguments: { query: "remember this" }, effectiveArgumentsDigest: __DigestCanonicalJson({ query: "remember this" }), requestFingerprint: "sha256:fingerprint", approvalRequired: true, recoveryMode: ExternalActionRecoveryModes.Manual, recoveryKey: null, state: ToolInvocationStates.AwaitingApproval, preparationAttempt: 1, retryDeadlineAt: new Date("2026-08-11T10:05:00.000Z"), nextPreparationAttemptAt: NOW, claimAttempt: 0, claimKind: null, claimFence: 0, claimExpiresAt: null, result: null, failureCode: null, revision: 4, ...overrides };
}

/** Immutable personal run snapshot whose digest and persona bind the permission. */
function _MemorySnapshot(): RunInputSnapshot
{
	return { runId: "run-1", siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", personaRevisionId: "persona-1", conversationId: "conversation-1", identitySnapshot: { kind: RunInputSnapshotIdentityKinds.User, executionSubjectId: "user-1" }, digest: `sha256:${"d".repeat(64)}` } as unknown as RunInputSnapshot;
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

	it("replays only an exactly matching durable runtime request", async function _ReplaysExactRequest()
	{
		const body = { kind: ElicitationBodyKinds.FreeText, prompt: "Answer", maximumLength: 100, allowEmpty: false } as const;
		const command = { requestId: "request-1", siloId: "silo-1", conversationId: "conversation-1", runId: "run-1", attempt: 2, assignedParticipantId: "user-1", requestKey: "question-1", purpose: ElicitationPurposes.RuntimeInput, body, purposePayloadDigest: __DigestCanonicalJson(null), requiresStepUp: false, now: NOW, expiresAt: new Date("2026-08-11T11:00:00.000Z") } as const;
		const existing = _Request({ body, bodyDigest: __DigestCanonicalJson(body), purposePayloadDigest: command.purposePayloadDigest });
		const transaction = { elicitationRequest: { findUnique: vi.fn().mockResolvedValue(existing) } };

		const unitOfWork = new PrismaRuntimeElicitationUnitOfWork(transaction as never);
		await expect(unitOfWork.open(command)).resolves.toMatchObject({ requestId: "request-1" });
		await expect(unitOfWork.open({ ...command, body: { ...body, prompt: "Changed" } })).resolves.toBeNull();
		await expect(unitOfWork.open({ ...command, requestId: "request-changed" })).resolves.toBeNull();
	});

	it.each([ElicitationPurpose.RuntimeInput, ElicitationPurpose.A2uiAction])("expires due generic %s input with one terminal delivery before resuming", async function _ExpiresGenericRequest(purpose)
	{
		const request = _Request({ purpose, expiresAt: new Date("2026-08-11T09:59:00.000Z") });
		let runState: AgentRunState = AgentRunState.WaitingForInput;
		const transaction = {
			elicitationRequest: { findMany: vi.fn().mockResolvedValue([request]), updateMany: vi.fn().mockResolvedValue({ count: 1 }), count: vi.fn().mockResolvedValue(0) },
			approvalRequest: { count: vi.fn().mockResolvedValue(0) },
			elicitationResultDelivery: { create: vi.fn().mockResolvedValue({ id: "delivery-1" }) },
			agentRun: {
				findUnique: vi.fn(async function _FindRun() { return { id: "run-1", attempt: 2, state: runState }; }),
				updateMany: vi.fn(async function _Resume() { runState = AgentRunState.Running; return { count: 1 }; }),
			},
		};

		await expect(new PrismaRuntimeElicitationUnitOfWork(transaction as never).expireDue({ runId: "run-1", attempt: 2, now: NOW })).resolves.toEqual({ expiredCount: 1, resumed: true });
		expect(transaction.elicitationResultDelivery.create).toHaveBeenCalledWith({ data: { requestId: "request-1" } });
		expect(transaction.elicitationResultDelivery.create.mock.invocationCallOrder[0]).toBeLessThan(transaction.elicitationRequest.updateMany.mock.invocationCallOrder[0] ?? 0);
		expect(transaction.elicitationRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { state: ElicitationRequestState.Expired, resolvedAt: NOW, safeReason: "response_window_expired" } }));
	});

	it("keeps a waiting run paused while another input request remains", async function _KeepsWaitingWithPendingInput()
	{
		const transaction = {
			elicitationRequest: { findMany: vi.fn().mockResolvedValue([_Request({ expiresAt: new Date("2026-08-11T09:59:00.000Z") })]), updateMany: vi.fn().mockResolvedValue({ count: 1 }), count: vi.fn().mockResolvedValue(1) },
			approvalRequest: { count: vi.fn().mockResolvedValue(0) },
			elicitationResultDelivery: { create: vi.fn().mockResolvedValue({ id: "delivery-1" }) },
			agentRun: { findUnique: vi.fn().mockResolvedValue({ id: "run-1", attempt: 2, state: AgentRunState.WaitingForInput }), updateMany: vi.fn() },
		};

		await expect(new PrismaRuntimeElicitationUnitOfWork(transaction as never).expireDue({ runId: "run-1", attempt: 2, now: NOW })).resolves.toEqual({ expiredCount: 1, resumed: false });
		expect(transaction.agentRun.updateMany).not.toHaveBeenCalled();
	});

	it("keeps a generic expiry paused while a tool approval remains pending", async function _KeepsWaitingWithPendingApproval()
	{
		const transaction = {
			elicitationRequest: { findMany: vi.fn().mockResolvedValue([_Request({ expiresAt: new Date("2026-08-11T09:59:00.000Z") })]), updateMany: vi.fn().mockResolvedValue({ count: 1 }), count: vi.fn().mockResolvedValue(0) },
			approvalRequest: { count: vi.fn().mockResolvedValue(1) },
			elicitationResultDelivery: { create: vi.fn().mockResolvedValue({ id: "delivery-1" }) },
			agentRun: { findUnique: vi.fn().mockResolvedValue({ id: "run-1", attempt: 2, state: AgentRunState.WaitingForInput }), updateMany: vi.fn() },
		};

		await expect(new PrismaRuntimeElicitationUnitOfWork(transaction as never).expireDue({ runId: "run-1", attempt: 2, now: NOW })).resolves.toEqual({ expiredCount: 1, resumed: false });
		expect(transaction.agentRun.updateMany).not.toHaveBeenCalled();
	});

	it("accepts one typed answer, creates its delivery, and resumes after the final request", async function _Answers()
	{
		const transaction = _ResponseTransaction();
		await expect(_Unit(transaction).respond({ siloId: "silo-1", conversationId: "conversation-1", requestId: "request-1", subjectId: "user-1", verifiedStepUpAt: null, submission: { idempotencyKey: "retry-1", response: { kind: ElicitationBodyKinds.FreeText, text: "Done" } }, now: NOW })).resolves.toEqual({ outcome: "accepted", projection: { requestId: "request-1", state: "answered", idempotent: false, resolvedAt: NOW.toISOString() } });
		expect(transaction.elicitationResultDelivery.create).toHaveBeenCalledTimes(1);
		expect(transaction.elicitationResponseAttempt.create).toHaveBeenCalledTimes(1);
		expect(transaction.agentRun.updateMany).toHaveBeenCalledTimes(1);
	});

	it("replays only an identical accepted idempotency key", async function _Replays()
	{
		const request = _Request({ state: ElicitationRequestState.Answered, resolvedAt: NOW });
		const transaction = _ResponseTransaction(request);
		transaction.elicitationResponseAttempt.findUnique.mockResolvedValueOnce({ responseDigest: __DigestCanonicalJson({ kind: ElicitationBodyKinds.FreeText, text: "Done" }) });
		await expect(_Unit(transaction).respond({ siloId: "silo-1", conversationId: "conversation-1", requestId: "request-1", subjectId: "user-1", verifiedStepUpAt: null, submission: { idempotencyKey: "retry-1", response: { kind: ElicitationBodyKinds.FreeText, text: "Done" } }, now: NOW })).resolves.toMatchObject({ outcome: "accepted", projection: { idempotent: true } });
		expect(transaction.elicitationRequest.updateMany).not.toHaveBeenCalled();
	});

	it("turns memory approval into only an exact one-use receipt", async function _MemoryPermission()
	{
		const invocation = _MemoryInvocation();
		const snapshot = _MemorySnapshot();
		const payload = { toolInvocationId: invocation.id, toolInvocationRevision: invocation.revision, runId: invocation.runId, attempt: invocation.attempt, executionSubjectId: invocation.subjectId, queryDigest: __DigestCanonicalJson("remember this"), inputSnapshotDigest: snapshot.digest, personaRevisionId: snapshot.personaRevisionId, expiresAt: "2026-08-11T10:15:00.000Z" };
		const request = _Request({ purpose: ElicitationPurpose.PersonalMemoryPermission, bodyKind: "Approval", body: { kind: ElicitationBodyKinds.Approval, prompt: "Allow memory?", action: "Recall", target: "personal memory", dataUse: "Use remembered facts", consequence: "One answer may use memory" }, purposePayload: payload, purposePayloadDigest: __DigestCanonicalJson(payload), expiresAt: new Date(payload.expiresAt) });
		const transaction = _ResponseTransaction(request);
		transaction.toolInvocation.findUnique.mockResolvedValue({ ...invocation, state: ToolInvocationState.AwaitingApproval, createdAt: NOW });
		transaction.runInputSnapshot.findUnique.mockResolvedValueOnce({ digest: snapshot.digest, personaRevisionId: snapshot.personaRevisionId });
		await expect(_Unit(transaction).respond({ siloId: "silo-1", conversationId: "conversation-1", requestId: "request-1", subjectId: "user-1", verifiedStepUpAt: null, submission: { idempotencyKey: "retry-1", response: { kind: ElicitationBodyKinds.Approval, approved: true } }, now: NOW })).resolves.toMatchObject({ outcome: "accepted" });
		expect(transaction.toolInvocation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: invocation.id, revision: invocation.revision, state: ToolInvocationState.AwaitingApproval }), data: expect.objectContaining({ state: ToolInvocationState.Ready, revision: { increment: 1 } }) }));
		expect(transaction.personalMemoryPermissionReceipt.create).toHaveBeenCalledWith({ data: expect.objectContaining({ requestId: "request-1", toolInvocationId: invocation.id, toolInvocationRevision: invocation.revision + 1, runId: "run-1", attempt: 2, executionSubjectId: "user-1", respondingSubjectId: "user-1", queryDigest: __DigestCanonicalJson("remember this"), inputSnapshotDigest: snapshot.digest, personaRevisionId: snapshot.personaRevisionId, state: PersonalMemoryPermissionReceiptState.Active }) });
		expect(transaction.elicitationResultDelivery.create).not.toHaveBeenCalled();
	});

	it("delegates declined memory permission terminalization to authorization", async function _DeclinesMemoryPermission()
	{
		const invocation = _MemoryInvocation();
		const snapshot = _MemorySnapshot();
		const payload = { toolInvocationId: invocation.id, toolInvocationRevision: invocation.revision, runId: invocation.runId, attempt: invocation.attempt, executionSubjectId: invocation.subjectId, queryDigest: __DigestCanonicalJson("remember this"), inputSnapshotDigest: snapshot.digest, personaRevisionId: snapshot.personaRevisionId, expiresAt: "2026-08-11T10:15:00.000Z" };
		const request = _Request({ purpose: ElicitationPurpose.PersonalMemoryPermission, bodyKind: "Approval", body: { kind: ElicitationBodyKinds.Approval, prompt: "Allow memory?", action: "Recall", target: "personal memory", dataUse: "Use remembered facts", consequence: "One answer may use memory" }, purposePayload: payload, purposePayloadDigest: __DigestCanonicalJson(payload), expiresAt: new Date(payload.expiresAt) });
		const transaction = _ResponseTransaction(request);
		transaction.toolInvocation.findUnique.mockResolvedValue({ ...invocation, state: ToolInvocationState.AwaitingApproval, createdAt: NOW });
		transaction.runInputSnapshot.findUnique.mockResolvedValue({ digest: snapshot.digest, personaRevisionId: snapshot.personaRevisionId });
		await expect(_Unit(transaction).respond({ siloId: "silo-1", conversationId: "conversation-1", requestId: "request-1", subjectId: "user-1", verifiedStepUpAt: null, submission: { idempotencyKey: "retry-1", response: { kind: ElicitationBodyKinds.Approval, approved: false } }, now: NOW })).resolves.toMatchObject({ outcome: "accepted", projection: { state: "declined" } });
		expect(transaction.toolInvocation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: ToolInvocationState.Failed, failureCode: "memory_permission_declined" }) }));
		expect(transaction.toolResultDelivery.create).toHaveBeenCalledWith({ data: expect.objectContaining({ payload: { toolInvocationId: invocation.toolInvocationId, outcome: "failed", failureCode: "memory_permission_declined" } }) });
		expect(transaction.personalMemoryPermissionReceipt.create).not.toHaveBeenCalled();
	});

	it("delegates expired memory permission terminalization to authorization", async function _ExpiresMemoryPermission()
	{
		const invocation = _MemoryInvocation();
		const snapshot = _MemorySnapshot();
		const payload = { toolInvocationId: invocation.id, toolInvocationRevision: invocation.revision, runId: invocation.runId, attempt: invocation.attempt, executionSubjectId: invocation.subjectId, queryDigest: __DigestCanonicalJson("remember this"), inputSnapshotDigest: snapshot.digest, personaRevisionId: snapshot.personaRevisionId, expiresAt: "2026-08-11T09:59:00.000Z" };
		const request = _Request({ purpose: ElicitationPurpose.PersonalMemoryPermission, purposePayload: payload, purposePayloadDigest: __DigestCanonicalJson(payload), expiresAt: new Date(payload.expiresAt) });
		const transaction = _ResponseTransaction(request);
		transaction.toolInvocation.findUnique.mockResolvedValue({ ...invocation, state: ToolInvocationState.AwaitingApproval, createdAt: NOW });
		await expect(_Unit(transaction).respond({ siloId: "silo-1", conversationId: "conversation-1", requestId: "request-1", subjectId: "user-1", verifiedStepUpAt: null, submission: { idempotencyKey: "retry-1", response: { kind: ElicitationBodyKinds.Approval, approved: true } }, now: NOW })).resolves.toEqual({ outcome: "expired" });
		expect(transaction.toolInvocation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: ToolInvocationState.Failed, failureCode: "memory_permission_expired" }) }));
		expect(transaction.toolResultDelivery.create).toHaveBeenCalledTimes(1);
		expect(transaction.elicitationRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: ElicitationRequestState.Expired, safeReason: "response_window_expired" }) }));
	});

	it("refuses expiry payloads with a changed digest, run, or invocation", async function _RefusesCorruptMemoryExpiry()
	{
		const invocation = _MemoryInvocation();
		const snapshot = _MemorySnapshot();
		const basePayload = { toolInvocationId: invocation.id, toolInvocationRevision: invocation.revision, runId: invocation.runId, attempt: invocation.attempt, executionSubjectId: invocation.subjectId, queryDigest: __DigestCanonicalJson("remember this"), inputSnapshotDigest: snapshot.digest, personaRevisionId: snapshot.personaRevisionId, expiresAt: "2026-08-11T09:59:00.000Z" };
		const cases = [
			{ payload: basePayload, digest: `sha256:${"f".repeat(64)}` },
			{ payload: { ...basePayload, runId: "run-other" }, digest: null },
			{ payload: { ...basePayload, toolInvocationId: "invocation-other" }, digest: null },
		] as const;
		for (const invalid of cases)
		{
			const request = _Request({ purpose: ElicitationPurpose.PersonalMemoryPermission, purposePayload: invalid.payload, purposePayloadDigest: invalid.digest ?? __DigestCanonicalJson(invalid.payload), expiresAt: new Date(basePayload.expiresAt) });
			const transaction = _ResponseTransaction(request);
			transaction.toolInvocation.findUnique.mockResolvedValue({ ...invocation, state: ToolInvocationState.AwaitingApproval, createdAt: NOW });
			await expect(_Unit(transaction).respond({ siloId: "silo-1", conversationId: "conversation-1", requestId: "request-1", subjectId: "user-1", verifiedStepUpAt: null, submission: { idempotencyKey: "retry-1", response: { kind: ElicitationBodyKinds.Approval, approved: true } }, now: NOW })).rejects.toThrow(/memory permission expiry lost/);
			expect(transaction.toolInvocation.updateMany).not.toHaveBeenCalled();
		}
	});

	it("opens a personal-memory request for only the execution user and exact invocation", async function _OpenMemoryPermission()
	{
		const transaction = {
			elicitationRequest: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockImplementation(async function _Create(input) { return { ..._Request(), ...input.data }; }) },
			agentRun: { findUnique: vi.fn().mockResolvedValue({ id: "run-1", siloId: "silo-1", conversationId: "conversation-1", attempt: 2, state: AgentRunState.Running }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
			conversationParticipant: { findUnique: vi.fn().mockResolvedValue({ accessEndedPosition: null }) },
		};
		await expect(_Unit(transaction).openMemoryPermission(_MemoryInvocation(), _MemorySnapshot(), NOW)).resolves.toBe(true);
		expect(transaction.elicitationRequest.create).toHaveBeenCalledWith({ data: expect.objectContaining({ runId: "run-1", attempt: 2, assignedParticipantId: "user-1", purpose: ElicitationPurpose.PersonalMemoryPermission, expiresAt: new Date("2026-08-11T10:15:00.000Z") }) });
	});

	it("denies stale claim coordinates and accepts only the exact active dispatch claim", async function _VerifyMemoryPermission()
	{
		const invocation = _MemoryInvocation({ state: ToolInvocationStates.Claimed, revision: 6, claimKind: ExternalActionClaimKinds.Dispatch, claimFence: 7, claimExpiresAt: new Date("2026-08-11T10:01:00.000Z") });
		const claim: ToolInvocationClaim = { invocationId: invocation.id, kind: ExternalActionClaimKinds.Dispatch, fence: 7, revision: 6 };
		const snapshot = _MemorySnapshot();
		const purposePayload = { toolInvocationId: invocation.id, toolInvocationRevision: 4, runId: invocation.runId, attempt: invocation.attempt, executionSubjectId: invocation.subjectId, queryDigest: __DigestCanonicalJson("remember this"), inputSnapshotDigest: snapshot.digest, personaRevisionId: snapshot.personaRevisionId, expiresAt: "2026-08-11T10:15:00.000Z" };
		const request = _Request({ purpose: ElicitationPurpose.PersonalMemoryPermission, state: ElicitationRequestState.Answered, assignedParticipantId: "user-1", resolvedAt: NOW, resolvedBy: "user-1", purposePayload, purposePayloadDigest: __DigestCanonicalJson(purposePayload), expiresAt: new Date(purposePayload.expiresAt) });
		const receipt = { state: PersonalMemoryPermissionReceiptState.Active, consumedAt: null, expiresAt: new Date(purposePayload.expiresAt), toolInvocationRevision: 5, runId: "run-1", attempt: 2, executionSubjectId: "user-1", respondingSubjectId: "user-1", queryDigest: purposePayload.queryDigest, inputSnapshotDigest: snapshot.digest, personaRevisionId: "persona-1", purposeDigest: request.purposePayloadDigest, toolInvocationId: invocation.id, request };
		const transaction = { toolInvocation: { findUnique: vi.fn().mockResolvedValue({ ...invocation, state: ToolInvocationState.Claimed, claimKind: ExternalActionClaimKind.Dispatch }) }, agentRun: { findUnique: vi.fn().mockResolvedValue({ attempt: 2, state: AgentRunState.Running }) }, personalMemoryPermissionReceipt: { findUnique: vi.fn().mockResolvedValue(receipt) } };
		await expect(_Unit(transaction).verifyMemoryPermission(invocation, { ...claim, fence: 6 }, snapshot, NOW)).resolves.toEqual({ outcome: "denied" });
		await expect(_Unit(transaction).verifyMemoryPermission(invocation, { ...claim, kind: ExternalActionClaimKinds.Reconcile }, snapshot, NOW)).resolves.toEqual({ outcome: "denied" });
		transaction.toolInvocation.findUnique.mockResolvedValueOnce({ ...invocation, state: ToolInvocationState.Claimed, claimKind: ExternalActionClaimKind.Dispatch, claimExpiresAt: NOW });
		await expect(_Unit(transaction).verifyMemoryPermission(invocation, claim, snapshot, NOW)).resolves.toEqual({ outcome: "denied" });
		const authorized = await _Unit(transaction).verifyMemoryPermission(invocation, claim, snapshot, NOW);
		expect(transaction.personalMemoryPermissionReceipt.findUnique).toHaveBeenCalledTimes(1);
		expect(authorized).toEqual({ outcome: "authorized" });
		transaction.agentRun.findUnique.mockResolvedValueOnce({ attempt: 2, state: AgentRunState.Cancelling });
		await expect(_Unit(transaction).verifyMemoryPermission(invocation, claim, snapshot, NOW)).resolves.toEqual({ outcome: "denied" });
		transaction.toolInvocation.findUnique.mockResolvedValueOnce({ ...invocation, state: ToolInvocationState.Claimed, claimKind: ExternalActionClaimKind.Dispatch, claimFence: 8 });
		await expect(_Unit(transaction).verifyMemoryPermission(invocation, claim, snapshot, NOW)).resolves.toEqual({ outcome: "denied" });
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
