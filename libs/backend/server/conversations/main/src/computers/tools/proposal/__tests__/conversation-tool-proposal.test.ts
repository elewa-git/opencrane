import { afterEach, describe, expect, it, vi } from "vitest";

import type { ConversationToolProposal } from "@opencrane/contracts";
import { ___DigestCanonicalJson } from "@opencrane/util";

import type { ConversationComputerTurnCandidate, FrozenConversationComputerTurn } from "../../../turns/conversation-computer-turn.types";
import { _PrepareConversationToolProposal } from "../conversation-tool-proposal";

/** Isolate the immutable selection rules from separately tested database authority and workload checks. */
function _Fixture()
{
	vi.useFakeTimers();
	vi.setSystemTime(1_800_000_000_000);
	const schema = { type: "object", additionalProperties: false, required: ["query"], properties: { query: { type: "string" } } };
	const tool = { name: "records.read", toolRevisionId: "tool-1", description: "Read a record", requiresApproval: false, parametersSchema: schema, parametersSchemaDigest: ___DigestCanonicalJson(schema) };
	const turn = { bootstrapId: "b1f5a60b-22d8-4dce-b41f-8da167ea0554", siloId: "silo-1", computerId: "computer-1", lease: { leaseId: "lease-1", leaseGeneration: 1, sandboxClaimId: "computer-1-g1" }, binding: { conversationId: "conversation-1", agentIdentityId: "identity-1", expectedRevision: 2n }, compile: { runId: "run-1", attempt: 1, digest: "sha256:compiled" }, outputSourceCommandId: null } as FrozenConversationComputerTurn;
	const candidate: ConversationComputerTurnCandidate = { ...turn, credentialExpiresAt: "2099-01-01T00:00:00.000Z", compiledInput: { promptCompilerVersion: "proof-v1", instructions: "", messages: [], model: { modelAlias: "proof", maxOutputTokens: 512, generatedOutputCapabilities: [] }, runId: "run-1", attempt: 1, digest: "sha256:compiled", tools: [tool], budget: { maxModelTurns: 2, maxCompletionTokens: 1_024, maxCostUsdMicros: null, wallClockDeadlineEpochMs: Date.now() + 60_000, maxToolInvocations: 1 } } };
	const proposal: ConversationToolProposal = { bootstrapId: turn.bootstrapId, toolRevisionId: "tool-1", arguments: { query: "record" } };
	return { turn, candidate, proposal, tool };
}

afterEach(function _Clock() { vi.useRealTimers(); });

describe("one frozen conversation tool proposal", function _Suite()
{
	it("keeps the same slot and fingerprint across time and captures immutable arguments", function _StableRetry()
	{
		const f = _Fixture();
		const first = _PrepareConversationToolProposal(f.turn, f.candidate, f.proposal);
		vi.setSystemTime(Date.now() + 1_000);
		expect(_PrepareConversationToolProposal(f.turn, f.candidate, f.proposal)).toEqual(first);
		(f.proposal.arguments as Record<string, unknown>)["query"] = "changed";
		expect(first.arguments).toEqual({ query: "record" });
		const changed = _PrepareConversationToolProposal(f.turn, f.candidate, f.proposal);
		expect(changed.proposalId).toBe(first.proposalId);
		expect(changed.requestFingerprint).not.toBe(first.requestFingerprint);
	});
	it("does not grant another slot to a new bootstrap or lease", function _OneSlot()
	{
		const f = _Fixture();
		const original = _PrepareConversationToolProposal(f.turn, f.candidate, f.proposal);
		const bootstrapId = "d55e7c56-7b4a-4196-81ea-bb4d6f4bfdb3";
		const next = _PrepareConversationToolProposal({ ...f.turn, bootstrapId, lease: { ...f.turn.lease, leaseId: "other" } }, f.candidate, { ...f.proposal, bootstrapId });
		expect(next.proposalId).toBe(original.proposalId);
		expect(next.requestFingerprint).not.toBe(original.requestFingerprint);
	});
	it("rejects a tool outside the compiled set, changed schema and approval-required work", function _ExactTool()
	{
		const f = _Fixture();
		expect(() => _PrepareConversationToolProposal(f.turn, f.candidate, { ...f.proposal, toolRevisionId: "other" })).toThrow("invalid");
		f.tool.requiresApproval = true;
		expect(() => _PrepareConversationToolProposal(f.turn, f.candidate, f.proposal)).toThrow("invalid");
		f.tool.requiresApproval = false;
		f.tool.parametersSchemaDigest = `sha256:${"0".repeat(64)}`;
		expect(() => _PrepareConversationToolProposal(f.turn, f.candidate, f.proposal)).toThrow("invalid");
	});
	it("rejects incomplete arguments and an original deadline reached during preparation", function _SchemaAndBudget()
	{
		const f = _Fixture();
		expect(() => _PrepareConversationToolProposal(f.turn, f.candidate, { ...f.proposal, arguments: {} })).toThrow("invalid");
		vi.setSystemTime(Date.now() + 60_000);
		expect(() => _PrepareConversationToolProposal(f.turn, f.candidate, f.proposal)).toThrow("denied");
	});
	it("refuses an output-started turn and a changed compilation", function _FrozenTurn()
	{
		const f = _Fixture();
		expect(() => _PrepareConversationToolProposal({ ...f.turn, outputSourceCommandId: "output" }, f.candidate, f.proposal)).toThrow("invalid");
		expect(() => _PrepareConversationToolProposal(f.turn, { ...f.candidate, compiledInput: { ...f.candidate.compiledInput, digest: "other" } }, f.proposal)).toThrow("invalid");
	});
});
