import { AgentRunState, AgentRunTerminalReason } from "@prisma/client";

import { ExecutionSubjectMembershipKinds, type ExecutionSubject } from "@opencrane/models/agents";
import { describe, expect, it, vi } from "vitest";

import type { ConversationRunLifecycleCommand } from "../conversation-run-lifecycle.types";
import { PrismaConversationRunLifecycleUnitOfWork } from "../prisma-conversation-run-lifecycle-authority";

/** Exact lease-fenced command shared by lifecycle cases. */
const _COMMAND: ConversationRunLifecycleCommand = { runId: "run-1", siloId: "silo-1", attempt: 2, computerId: "computer-1", lease: { leaseId: "lease-1", leaseGeneration: 4 } };

describe("PrismaConversationRunLifecycleUnitOfWork", function _Suite()
{
	it("starts only the exact accepted attempt and records its first start time", async function _Start()
	{
		const fixture = _Fixture(AgentRunState.Accepted);

		await expect(fixture.authority.start(_COMMAND)).resolves.toBeUndefined();

		expect(fixture.transaction.agentRun.updateMany).toHaveBeenCalledWith({ where: { id: _COMMAND.runId, siloId: _COMMAND.siloId, attempt: _COMMAND.attempt, state: AgentRunState.Accepted }, data: { state: AgentRunState.Running, startedAt: expect.any(Date) } });
	});

	it("moves only the exact running attempt and lease into RecoveryRequired", async function _EnterRecovery()
	{
		const fixture = _Fixture(AgentRunState.Running);

		await expect(fixture.authority.enterRecoveryRequired(_COMMAND)).resolves.toBeUndefined();

		expect(fixture.transaction.agentRun.updateMany).toHaveBeenCalledWith({ where: { id: _COMMAND.runId, siloId: _COMMAND.siloId, attempt: _COMMAND.attempt, state: AgentRunState.Running }, data: { state: AgentRunState.RecoveryRequired } });
	});

	it("completes only the exact running attempt with successful terminal evidence", async function _Complete()
	{
		const fixture = _Fixture(AgentRunState.Running);

		await expect(fixture.authority.complete(_COMMAND)).resolves.toBeUndefined();

		expect(fixture.transaction.agentRun.updateMany).toHaveBeenCalledWith({ where: { id: _COMMAND.runId, siloId: _COMMAND.siloId, attempt: _COMMAND.attempt, state: AgentRunState.Running }, data: { state: AgentRunState.Completed, terminalReason: AgentRunTerminalReason.Success, finishedAt: expect.any(Date) } });
	});

	it("keeps an exact RecoveryRequired run unchanged when start replays", async function _RecoveryRestart()
	{
		const fixture = _Fixture(AgentRunState.RecoveryRequired);

		await expect(fixture.authority.start(_COMMAND)).resolves.toBeUndefined();
		await expect(fixture.authority.enterRecoveryRequired(_COMMAND)).resolves.toBeUndefined();

		expect(fixture.transaction.agentRun.updateMany).not.toHaveBeenCalled();
	});

	it.each([
		["silo", { ..._COMMAND, siloId: "silo-2" }],
		["attempt", { ..._COMMAND, attempt: 3 }],
		["computer", { ..._COMMAND, computerId: "computer-2" }],
		["lease", { ..._COMMAND, lease: { ..._COMMAND.lease, leaseId: "lease-2" } }],
		["generation", { ..._COMMAND, lease: { ..._COMMAND.lease, leaseGeneration: 5 } }],
	] as const)("rejects a stale %s fence", async function _StaleFence(_name, command)
	{
		const fixture = _Fixture(AgentRunState.Running);

		await expect(fixture.authority.enterRecoveryRequired(command)).rejects.toThrow("conversation run lifecycle requires");
		expect(fixture.transaction.agentRun.updateMany).not.toHaveBeenCalled();
	});

	it.each([AgentRunState.Cancelling, AgentRunState.Completed, AgentRunState.Cancelled, AgentRunState.Failed])("does not resurrect %s", async function _TerminalState(state)
	{
		const fixture = _Fixture(state);

		await expect(fixture.authority.enterRecoveryRequired(_COMMAND)).rejects.toThrow("cannot transition from the current state");
		expect(fixture.transaction.agentRun.updateMany).not.toHaveBeenCalled();
	});

	it("rejects a compare-and-set loser after the state read", async function _CompareAndSetLoss()
	{
		const fixture = _Fixture(AgentRunState.Running, 0);

		await expect(fixture.authority.enterRecoveryRequired(_COMMAND)).rejects.toThrow("lost its state transition fence");
		expect(fixture.transaction.agentRun.updateMany).toHaveBeenCalledOnce();
	});
});

/** Creates one complete exact lease-bound execution subject. */
function _ExecutionSubject(): ExecutionSubject
{
	return {
		schemaVersion: 1,
		siloId: _COMMAND.siloId,
		agentIdentityId: "identity-1",
		principalId: "principal-1",
		identity: { agentIdentityId: "identity-1", principalId: "principal-1", siloId: _COMMAND.siloId, headRevision: "4", headDigest: `sha256:${"a".repeat(64)}`, decisionEvidenceId: "identity-decision-1", verifiedAt: "2026-09-01T00:00:00.000Z" },
		membership: { kind: ExecutionSubjectMembershipKinds.Fleet, principalId: "principal-1", siloId: _COMMAND.siloId, revision: 7, assertionId: "membership-1", payloadDigest: `sha256:${"b".repeat(64)}`, decisionEvidenceId: "membership-decision-1", trustedUntil: "2099-09-01T00:00:00.000Z" },
		capability: { agentIdentityId: "identity-1", computerId: _COMMAND.computerId, capabilitySetDigest: `sha256:${"c".repeat(64)}`, effectiveContractDigest: `sha256:${"d".repeat(64)}`, decisionEvidenceId: "capability-decision-1", decidedAt: "2026-09-01T00:00:00.000Z" },
		runScope: { siloId: _COMMAND.siloId, runId: _COMMAND.runId, attempt: _COMMAND.attempt, agentServiceId: "service-1", agentRevisionId: "revision-1" },
		computerScope: { siloId: _COMMAND.siloId, computerId: _COMMAND.computerId, leaseId: _COMMAND.lease.leaseId, leaseGeneration: _COMMAND.lease.leaseGeneration },
		requester: { membership: { kind: ExecutionSubjectMembershipKinds.Fleet, principalId: "principal-1", siloId: _COMMAND.siloId, revision: 7, assertionId: "membership-1", payloadDigest: `sha256:${"b".repeat(64)}`, decisionEvidenceId: "membership-decision-1", trustedUntil: "2099-09-01T00:00:00.000Z" }, siloId: _COMMAND.siloId, requesterPrincipalId: "principal-1", requestIdempotencyKey: "request-1", authenticatedAt: "2026-09-01T00:00:00.000Z" },
		admission: { authorizingPrincipalId: "principal-1", decisionEvidenceId: "admission-decision-1", admittedAt: "2026-09-01T00:00:00.000Z" },
	};
}

/** Builds a transaction-owning lifecycle authority over one stable row. */
function _Fixture(state: AgentRunState, updateCount = 1)
{
	const transaction = { agentRun: { findFirst: vi.fn().mockResolvedValue({ state, executionSubject: _ExecutionSubject() }), updateMany: vi.fn().mockResolvedValue({ count: updateCount }) } };
	const prisma = { $transaction: vi.fn(async function _Transaction(operation: (client: unknown) => Promise<unknown>) { return operation(transaction); }) };
	return { transaction, authority: new PrismaConversationRunLifecycleUnitOfWork(prisma as never) };
}
