import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConversationToolProposalOutcomes } from "@opencrane/contracts";
import { ___DigestCanonicalJson } from "@opencrane/util";

import { PrismaConversationToolProposalRepository } from "../prisma-conversation-tool-proposal";
import { _PrepareConversationToolProposal } from "../conversation-tool-proposal";
import { ConversationComputerTurnProtocolStates } from "../../../turns/conversation-computer-turn-protocol.types";

const _run = vi.hoisted(function _Run()
{
	return { subject: { principalId: "user-1", membership: { kind: "fleet" }, capability: { capabilitySetDigest: "sha256:capability" } }, agentRevisionId: "revision-1", approvalDisclosure: { toolName: "records.update", toolDescription: "Update a record", serverName: "Records" } };
});

const _invocation = vi.hoisted(function _Invocation()
{
	return { id: "invocation-row-1", toolInvocationId: "public-invocation-1", state: "ready", revision: 2, requestFingerprint: "fingerprint" };
});

const _admitUntil = vi.hoisted(function _AdmitUntil()
{
	return vi.fn().mockResolvedValue(4_000_000_000_000);
});

const _openApproval = vi.hoisted(function _OpenApproval()
{
	return vi.fn().mockResolvedValue(true);
});

vi.mock("@opencrane/backend/server/iam/authorization", async function _ApprovalAuthority(importOriginal)
{
	const original = await importOriginal<typeof import("@opencrane/backend/server/iam/authorization")>();
	return { ...original, __OpenDeferredToolApprovalInTransaction: _openApproval };
});

vi.mock("../prisma-conversation-tool-proposal-run-reader", function _RunReader()
{
	return { PrismaConversationToolProposalRunRepository: class { load = vi.fn().mockResolvedValue(_run); } };
});

vi.mock("../prisma-conversation-tool-proposal-preparation", function _Preparation()
{
	return { PrismaConversationToolProposalPreparationAuthority: class { admit = vi.fn().mockResolvedValue({ outcome: "idempotent", invocation: _invocation }); } };
});

vi.mock("../../dispatch/prisma-conversation-tool-dispatch-authority", function _Dispatch()
{
	return { PrismaConversationToolDispatchAuthority: class { admitUntil = _admitUntil; } };
});

function _Fixture()
{
	const schema = { type: "object", additionalProperties: false, required: ["recordId"], properties: { recordId: { type: "string" } } };
	const reservation = { ordinal: 1, invocationFence: "model-1", tools: "select", compiledInputDigest: "sha256:compiled", historyDigest: "sha256:history", requestDigest: "sha256:request", maxCompletionTokens: 512, authorityExpiresAtEpochMs: Date.now() + 60_000, dispatchDeadlineEpochMs: Date.now() + 30_000 };
	const protocol = { state: ConversationComputerTurnProtocolStates.ModelReserved, revision: 1n, steps: [{ state: ConversationComputerTurnProtocolStates.ModelReserved, reservation, selection: null, result: null }], accounting: { reservedModelCalls: 1, reservedCompletionTokens: 512, reservedToolInvocations: 0, toolResultCyclesFed: 0 }, modelRetry: null, output: null, unavailable: null, cancellation: null };
	const turn = { bootstrapId: "bootstrap-1", siloId: "silo-1", computerId: "computer-1", lease: { leaseId: "lease-1", leaseGeneration: 1, sandboxClaimId: "claim-1" }, binding: { conversationId: "conversation-1", agentIdentityId: "identity-1", agentServiceId: "service-1", expectedRevision: 2n }, compile: { runId: "run-1", attempt: 1, digest: "sha256:compiled" }, budget: { maxModelTurns: 2, maxCompletionTokens: 1_024, maxCostUsdMicros: null, wallClockDeadlineEpochMs: Date.now() + 60_000, maxToolInvocations: 1, maxLoopIterations: 1 }, protocol } as any;
	const candidate = { ...turn, credentialExpiresAt: "2099-01-01T00:00:00.000Z", compiledInput: { promptCompilerVersion: "proof-v1", runId: "run-1", attempt: 1, digest: "sha256:compiled", instructions: "", messages: [], tools: [{ name: "records.update", modelName: "records_update", toolRevisionId: "tool-1", description: "Update a record", requiresApproval: true, parametersSchema: schema, parametersSchemaDigest: ___DigestCanonicalJson(schema) }], model: { modelAlias: "proof", maxOutputTokens: 512, generatedOutputCapabilities: [] }, budget: { maxModelTurns: 2, maxCompletionTokens: 1_024, maxCostUsdMicros: null, wallClockDeadlineEpochMs: Date.now() + 60_000, maxToolInvocations: 1, maxLoopIterations: 1 } } } as any;
	const proposal = _PrepareConversationToolProposal(turn, candidate, { bootstrapId: turn.bootstrapId, toolRevisionId: "tool-1", arguments: { recordId: "record-1" } });
	return { turn, candidate, proposal };
}

async function _ApprovalExpiry(): Promise<void> {}

describe("conversation approval proposal replay", function _Suite()
{
	beforeEach(function _Reset()
	{
		_invocation.state = "ready";
		_run.subject.membership.kind = "fleet";
		_run.subject.principalId = "user-1";
		_admitUntil.mockReset().mockResolvedValue(4_000_000_000_000);
		_openApproval.mockReset().mockResolvedValue(true);
	});
	afterEach(function _RestoreClock() { vi.useRealTimers(); });

	it("opens a company proposal for the requester without admitting runtime work", async function _CompanyApproval()
	{
		_run.subject.membership.kind = "managed";
		_run.subject.principalId = "company-principal";
		_invocation.state = "awaiting_approval";
		const f = _Fixture();
		const runtimeAdmission = vi.fn();
		const repository = new PrismaConversationToolProposalRepository({} as never, {} as never, runtimeAdmission, _ApprovalExpiry);

		await expect(repository.admit(f.turn, f.candidate, f.proposal, { audience: "conversation", namespace: "computers", serviceAccountName: "computer", workloadKind: "pod", workloadUid: "pod-1", podUid: "pod-1" })).resolves.toEqual({ proposalId: "public-invocation-1", outcome: ConversationToolProposalOutcomes.Existing });
		expect(_admitUntil).toHaveBeenCalledOnce();
		expect(_openApproval).toHaveBeenCalledWith({}, expect.objectContaining({ invocationId: "invocation-row-1", runId: "run-1", toolRevisionId: "tool-1", arguments: { recordId: "record-1" } }));
		expect(runtimeAdmission).not.toHaveBeenCalled();
	});

	it.each(["current permissions", "requester assignment"])("refuses a company proposal after losing %s", async function _CompanyDenial(reason)
	{
		_run.subject.membership.kind = "managed";
		_run.subject.principalId = "company-principal";
		_invocation.state = "awaiting_approval";
		if (reason === "current permissions")
			_admitUntil.mockResolvedValue(null);
		else
			_openApproval.mockResolvedValue(false);
		const f = _Fixture();
		const runtimeAdmission = vi.fn();
		const repository = new PrismaConversationToolProposalRepository({} as never, {} as never, runtimeAdmission, _ApprovalExpiry);

		await expect(repository.admit(f.turn, f.candidate, f.proposal, { audience: "conversation", namespace: "computers", serviceAccountName: "computer", workloadKind: "pod", workloadUid: "pod-1", podUid: "pod-1" })).rejects.toThrow();
		expect(runtimeAdmission).not.toHaveBeenCalled();
		if (reason === "current permissions")
			 expect(_openApproval).not.toHaveBeenCalled();
	});

	it("admits the existing Ready invocation so the saved result can be read", async function _ReadyReplay()
	{
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-08-11T10:00:00.000Z"));
		const f = _Fixture();
		expect(f.candidate.compiledInput.budget.wallClockDeadlineEpochMs).toBeGreaterThan(Date.now());
		const runtimeAdmission = vi.fn().mockResolvedValue(true);
		const repository = new PrismaConversationToolProposalRepository({} as never, {} as never, runtimeAdmission, _ApprovalExpiry);

		await expect(repository.admit(f.turn, f.candidate, f.proposal, { audience: "conversation", namespace: "computers", serviceAccountName: "computer", workloadKind: "pod", workloadUid: "pod-1", podUid: "pod-1" })).resolves.toEqual({ proposalId: "public-invocation-1", outcome: ConversationToolProposalOutcomes.Existing });
		expect(_admitUntil).toHaveBeenCalledOnce();
		expect(runtimeAdmission).toHaveBeenCalledWith({}, "invocation-row-1");
	});

	it("returns an existing terminal invocation without creating runtime work", async function _TerminalReplay()
	{
		const f = _Fixture();
		_invocation.state = "failed";
		const runtimeAdmission = vi.fn().mockResolvedValue(true);
		const repository = new PrismaConversationToolProposalRepository({} as never, {} as never, runtimeAdmission, _ApprovalExpiry);

		await expect(repository.admit(f.turn, f.candidate, f.proposal, { audience: "conversation", namespace: "computers", serviceAccountName: "computer", workloadKind: "pod", workloadUid: "pod-1", podUid: "pod-1" })).resolves.toEqual({ proposalId: "public-invocation-1", outcome: ConversationToolProposalOutcomes.Existing });
		expect(runtimeAdmission).not.toHaveBeenCalled();
	});
});
