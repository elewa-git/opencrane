import { AgentRunState, AgentRunTerminalReason } from "@prisma/client";
import { ExecutionSubjectMembershipKinds, type ExecutionSubject } from "@opencrane/models/agents";
import { describe, expect, it, vi } from "vitest";

import { PrismaConversationRunLifecycleUnitOfWork } from "../prisma-conversation-run-lifecycle-authority";

/** Build the complete saved execution fence checked by lifecycle transitions. */
function _Subject(): ExecutionSubject
{
	const membership = { kind: ExecutionSubjectMembershipKinds.Fleet, principalId: "principal-1", siloId: "silo-1", revision: 7, assertionId: "membership-1", payloadDigest: `sha256:${"b".repeat(64)}`, decisionEvidenceId: "membership-decision-1", trustedUntil: "2099-09-01T00:00:00.000Z" } as const;
	return {
		schemaVersion: 1,
		siloId: "silo-1",
		agentIdentityId: "identity-1",
		principalId: "principal-1",
		identity: { agentIdentityId: "identity-1", principalId: "principal-1", siloId: "silo-1", headRevision: "4", headDigest: `sha256:${"a".repeat(64)}`, decisionEvidenceId: "identity-decision-1", verifiedAt: "2026-09-01T00:00:00.000Z" },
		membership,
		capability: { agentIdentityId: "identity-1", computerId: "computer-1", capabilitySetDigest: `sha256:${"c".repeat(64)}`, effectiveContractDigest: `sha256:${"d".repeat(64)}`, decisionEvidenceId: "capability-decision-1", decidedAt: "2026-09-01T00:00:00.000Z" },
		runScope: { siloId: "silo-1", runId: "run-1", attempt: 1, agentServiceId: "service-1", agentRevisionId: "revision-1" },
		computerScope: { siloId: "silo-1", computerId: "computer-1", leaseId: "lease-1", leaseGeneration: 2 },
		requester: { membership, siloId: "silo-1", requesterPrincipalId: "principal-1", requestIdempotencyKey: "request-1", authenticatedAt: "2026-09-01T00:00:00.000Z" },
		admission: { authorizingPrincipalId: "principal-1", decisionEvidenceId: "admission-decision-1", admittedAt: "2026-09-01T00:00:00.000Z" },
	};
}

/** Create one transaction fake whose run can be moved through the failure transition. */
function _Harness(state: AgentRunState)
{
	const transaction = {
		agentRun: {
			findFirst: vi.fn().mockResolvedValue({ state, executionSubject: _Subject() }),
			updateMany: vi.fn().mockResolvedValue({ count: 1 }),
		},
	};
	const prisma = { $transaction: vi.fn(async function _Transaction(operation: (value: typeof transaction) => Promise<void>) { await operation(transaction); }) };
	return { authority: new PrismaConversationRunLifecycleUnitOfWork(prisma as never), transaction };
}

const _COMMAND = { runId: "run-1", siloId: "silo-1", attempt: 1, computerId: "computer-1", lease: { leaseId: "lease-1", leaseGeneration: 2 } };

describe("PrismaConversationRunLifecycleUnitOfWork", function _Suite()
{
	it.each([AgentRunState.Accepted, AgentRunState.Running])("fails an exact %s attempt", async function _Fails(state)
	{
		const harness = _Harness(state);
		await harness.authority.fail(_COMMAND);
		expect(harness.transaction.agentRun.updateMany).toHaveBeenCalledWith({
			where: { id: "run-1", siloId: "silo-1", attempt: 1, state: { in: [AgentRunState.Accepted, AgentRunState.Running] } },
			data: { state: AgentRunState.Failed, terminalReason: AgentRunTerminalReason.RuntimeFailure, finishedAt: expect.any(Date) },
		});
	});

	it("accepts an already-failed retry without writing again", async function _Idempotent()
	{
		const harness = _Harness(AgentRunState.Failed);
		await harness.authority.fail(_COMMAND);
		expect(harness.transaction.agentRun.updateMany).not.toHaveBeenCalled();
	});

	it("refuses to replace successful completion with failure", async function _PreservesSuccess()
	{
		const harness = _Harness(AgentRunState.Completed);
		await expect(harness.authority.fail(_COMMAND)).rejects.toThrow("cannot fail from the current state");
		expect(harness.transaction.agentRun.updateMany).not.toHaveBeenCalled();
	});
});
