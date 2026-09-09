import { describe, expect, it, vi } from "vitest";

import { AgentIdentityStates, ComputerLeaseStates, ConversationComputerStates } from "@opencrane/contracts";
import { __DigestCanonicalJson, type ToolInvocationRecord } from "@opencrane/backend/server/iam/authorization";
import type { ExecutionSubject } from "@opencrane/models/agents";

import { ConversationToolComputerEvidenceReader } from "../conversation-tool-computer-evidence";
import type { ConversationToolDispatchDependencies } from "../conversation-tool-dispatch.types";
import { PrismaConversationToolRunEvidenceRepository } from "../prisma-conversation-tool-run-evidence";

/** Fixed observation time for the saved run and its history. */
const _NOW = new Date("2026-09-09T00:00:00.000Z");

/** Supply only the persisted fields read at these two evidence boundaries. */
function _fixture()
{
	const trustedUntil = new Date(_NOW.getTime() + 60_000).toISOString();
	const subject = {
		agentIdentityId: "identity", principalId: "principal",
		runScope: { siloId: "silo", runId: "run", attempt: 1, agentServiceId: "service", agentRevisionId: "revision" },
		computerScope: { computerId: "computer", leaseId: "lease", leaseGeneration: 2 },
		identity: { headDigest: "sha256:identity", headRevision: "3" },
		membership: { trustedUntil }, requester: { membership: { trustedUntil } },
	} as unknown as ExecutionSubject;
	const invocation = {
		siloId: "silo", runId: "run", attempt: 1, agentRevisionId: "revision", mcpTaskId: null,
		toolRevisionId: "tool", effectiveArguments: { query: "read" }, effectiveArgumentsDigest: __DigestCanonicalJson({ query: "read" }),
		authorizationEvidence: { executionSubject: subject, coordinates: [] },
	} as unknown as ToolInvocationRecord;
	const transaction = {
		agentRun: { findFirst: vi.fn().mockResolvedValue({ conversationId: "conversation", executionSubject: subject, inputSnapshotDigest: "snapshot" }) },
		runInputSnapshot: { findFirst: vi.fn().mockResolvedValue({ budgetPolicy: { wallClockDeadlineEpochMs: _NOW.getTime() + 60_000, maxToolInvocations: 1 } }) },
		toolInvocation: { count: vi.fn().mockResolvedValue(1) },
	};
	const runs = new PrismaConversationToolRunEvidenceRepository(transaction as never);
	const projection = { resolve: vi.fn().mockResolvedValue({ computer: { conversationId: "conversation", agentIdentityId: "identity" } }) };
	const identity = { identity: { state: AgentIdentityStates.Active }, headDigest: subject.identity.headDigest, revision: 3n };
	const current = {
		computer: { state: ConversationComputerStates.Warm, leaseGeneration: 2 },
		lease: { state: ComputerLeaseStates.Active, id: "lease", generation: 2, computerId: "computer", sandboxId: "sandbox", expiresAt: trustedUntil },
	};
	const identities = { load: vi.fn().mockResolvedValue(identity) };
	const computers = { load: vi.fn().mockResolvedValue(current) };
	const history = new ConversationToolComputerEvidenceReader(projection, { identities, computers } as unknown as ConversationToolDispatchDependencies);
	return { invocation, transaction, runs, projection, identities, computers, history, current };
}

describe("saved conversation tool run evidence", function _RunEvidence()
{
	it("accepts the already-counted invocation at the exact allowance", async function _ExactAllowance()
	{
		const f = _fixture();
		await expect(f.runs.load(f.invocation, _NOW)).resolves.toMatchObject({ conversationId: "conversation", deadlineEpochMs: _NOW.getTime() + 60_000 });
		expect(f.transaction.toolInvocation.count).toHaveBeenCalledWith({ where: { runId: "run", attempt: 1 } });
	});

	it("rejects changed arguments before reading the run", async function _ChangedArguments()
	{
		const f = _fixture();
		await expect(f.runs.load({ ...f.invocation, effectiveArguments: { query: "changed" } }, _NOW)).resolves.toBeNull();
		expect(f.transaction.agentRun.findFirst).not.toHaveBeenCalled();
	});

	it("rejects a replaced execution subject before reading its input snapshot", async function _ReplacedSubject()
	{
		const f = _fixture();
		f.transaction.agentRun.findFirst.mockResolvedValue({ conversationId: "conversation", executionSubject: {} });
		await expect(f.runs.load(f.invocation, _NOW)).resolves.toBeNull();
		expect(f.transaction.runInputSnapshot.findFirst).not.toHaveBeenCalled();
	});

	it("rejects an attempt whose total invocation count exceeds the original allowance", async function _ExceededAllowance()
	{
		const f = _fixture();
		f.transaction.toolInvocation.count.mockResolvedValue(2);
		await expect(f.runs.load(f.invocation, _NOW)).resolves.toBeNull();
	});
});

describe("current conversation tool computer evidence", function _ComputerEvidence()
{
	it("refuses a computer projection from another conversation before reading history", async function _OtherConversation()
	{
		const f = _fixture();
		const run = (await f.runs.load(f.invocation, _NOW))!;
		f.projection.resolve.mockResolvedValue({ computer: { conversationId: "other", agentIdentityId: "identity" } });
		await expect(f.history.load(run, _NOW)).resolves.toBeNull();
		expect(f.identities.load).not.toHaveBeenCalled();
	});

	it("requires the computer and lease to agree on the generation", async function _ReplacedLease()
	{
		const f = _fixture();
		const run = (await f.runs.load(f.invocation, _NOW))!;
		f.current.computer.leaseGeneration = 3;
		await expect(f.history.load(run, _NOW)).resolves.toBeNull();
	});

	it("returns the observed lease expiry without extending it", async function _OriginalLeaseExpiry()
	{
		const f = _fixture();
		const run = (await f.runs.load(f.invocation, _NOW))!;
		f.current.lease.expiresAt = new Date(_NOW.getTime() + 2_000).toISOString();
		await expect(f.history.load(run, _NOW)).resolves.toMatchObject({ leaseExpiresAtEpochMs: _NOW.getTime() + 2_000 });
	});

	it("propagates unavailable history so the transaction owner can roll back", async function _UnavailableHistory()
	{
		const f = _fixture();
		const run = (await f.runs.load(f.invocation, _NOW))!;
		f.computers.load.mockRejectedValue(new Error("history unavailable"));
		await expect(f.history.load(run, _NOW)).rejects.toThrow("history unavailable");
	});
});
