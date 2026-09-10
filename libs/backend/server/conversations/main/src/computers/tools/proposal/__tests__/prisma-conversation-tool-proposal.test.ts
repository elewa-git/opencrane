import { describe, expect, it, vi } from "vitest";

import { ConversationToolProposalOutcomes } from "@opencrane/contracts";
import { ___DigestCanonicalJson } from "@opencrane/util";

import { PrismaConversationToolProposalRepository } from "../prisma-conversation-tool-proposal";
import { _PrepareConversationToolProposal } from "../conversation-tool-proposal";

const _run = vi.hoisted(function _Run()
{
	return { subject: { principalId: "user-1", membership: { kind: "fleet" }, capability: { capabilitySetDigest: "sha256:capability" } }, agentRevisionId: "revision-1" };
});

const _invocation = vi.hoisted(function _Invocation()
{
	return { id: "invocation-row-1", toolInvocationId: "public-invocation-1", state: "ready", revision: 2, requestFingerprint: "fingerprint" };
});

const _admitUntil = vi.hoisted(function _AdmitUntil()
{
	return vi.fn().mockResolvedValue(4_000_000_000_000);
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
	const turn = { bootstrapId: "bootstrap-1", siloId: "silo-1", computerId: "computer-1", lease: { leaseId: "lease-1", leaseGeneration: 1, sandboxClaimId: "claim-1" }, binding: { conversationId: "conversation-1", agentIdentityId: "identity-1", agentServiceId: "service-1", expectedRevision: 2n }, compile: { runId: "run-1", attempt: 1, digest: "sha256:compiled" }, outputSourceCommandId: null } as any;
	const candidate = { ...turn, credentialExpiresAt: "2099-01-01T00:00:00.000Z", compiledInput: { promptCompilerVersion: "proof-v1", runId: "run-1", attempt: 1, digest: "sha256:compiled", instructions: "", messages: [], tools: [{ name: "records.update", toolRevisionId: "tool-1", description: "Update a record", requiresApproval: true, parametersSchema: schema, parametersSchemaDigest: ___DigestCanonicalJson(schema) }], model: { modelAlias: "proof", maxOutputTokens: 512, generatedOutputCapabilities: [] }, budget: { maxModelTurns: 2, maxCompletionTokens: 1_024, maxCostUsdMicros: null, wallClockDeadlineEpochMs: Date.now() + 60_000, maxToolInvocations: 1 } } } as any;
	const proposal = _PrepareConversationToolProposal(turn, candidate, { bootstrapId: turn.bootstrapId, toolRevisionId: "tool-1", arguments: { recordId: "record-1" } });
	return { turn, candidate, proposal };
}

async function _ApprovalExpiry(): Promise<void> {}

describe("conversation approval proposal replay", function _Suite()
{
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
