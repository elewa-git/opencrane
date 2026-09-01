import { describe, expect, it, vi } from "vitest";

import type { IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";
import type { RunInputSnapshot } from "@opencrane/contracts";
import type { ExecutionSubject } from "@opencrane/models/agents";

const _retryRepository = vi.hoisted(function _CreateRetryRepository()
{
	return {
		checkRetryReplay: vi.fn().mockResolvedValue({ status: "proceed" }),
		getRunAuthority: vi.fn(),
		startNextAttemptAtomically: vi.fn(),
		readRetryWinner: vi.fn(),
	};
});

vi.mock("../prisma-run-authority", function _MockRetryRepository()
{
	return { PrismaAgentRunAuthorityRepository: class { constructor() { return _retryRepository; } } };
});

import { PrismaAgentRunRetryUnitOfWork } from "../prisma-run-retry-unit-of-work";
import { RetryRunInputCompileOutcomes, type RetryRunInputCompiler } from "../retry-run-input.types";

/** Builds the current run and service snapshot allowed to start retry attempt two. */
function _authority()
{
	const executionSubject = _subject(1);
	return {
		run: { id: "run-1", siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", conversationId: "conversation-1", trigger: "interactive" as const, executionSubject, requestIdempotencyKey: "request-1", lineage: { rootRunId: "run-1", parentRunId: null }, attempt: 1, state: "failed" as const, inputSnapshotDigest: `sha256:${"a".repeat(64)}`, acceptedAt: "2026-07-18T00:00:00.000Z", startedAt: "2026-07-18T00:01:00.000Z", finishedAt: "2026-07-18T00:02:00.000Z", terminalReason: "runtime_failure" as const },
		agentServiceSiloId: "silo-1",
		agentServiceState: "active" as const,
		activeAgentRevisionId: "revision-1",
	};
}

/** Creates the subject whose scope is bound to the requested attempt. */
function _subject(attempt: number): ExecutionSubject
{
	return { schemaVersion: 1, siloId: "silo-1", agentIdentityId: "identity-1", principalId: "principal-1", identity: { agentIdentityId: "identity-1", principalId: "principal-1", siloId: "silo-1", headRevision: "1", headDigest: `sha256:${"a".repeat(64)}`, decisionEvidenceId: "identity-decision", verifiedAt: "2026-07-18T00:00:00.000Z" }, membership: { principalId: "principal-1", siloId: "silo-1", revision: 1, assertionId: "membership", payloadDigest: `sha256:${"b".repeat(64)}`, decisionEvidenceId: "membership-decision", trustedUntil: "2099-07-18T00:00:00.000Z" }, capability: { agentIdentityId: "identity-1", computerId: "computer-1", capabilitySetDigest: `sha256:${"c".repeat(64)}`, effectiveContractDigest: `sha256:${"d".repeat(64)}`, decisionEvidenceId: "capability-decision", decidedAt: "2026-07-18T00:00:00.000Z" }, runScope: { siloId: "silo-1", runId: "run-1", attempt, agentServiceId: "service-1", agentRevisionId: "revision-1" }, computerScope: { siloId: "silo-1", computerId: "computer-1", leaseId: `lease-${attempt}`, leaseGeneration: attempt }, requester: { siloId: "silo-1", requesterPrincipalId: "principal-1", requestIdempotencyKey: "request-1", authenticatedAt: "2026-07-18T00:00:00.000Z" }, admission: { authorizingPrincipalId: "authorizer-1", decisionEvidenceId: "admission-decision", admittedAt: "2026-07-18T00:00:00.000Z" } };
}

/** Builds a next-attempt snapshot with matching subject, run, and computer coordinates. */
function _snapshot(): RunInputSnapshot
{
	return { runId: "run-1", attempt: 2, siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", snapshotVersion: 1, conversationId: "conversation-1", messageIds: [], personaRevisionId: null, preferenceFactIds: [], artifactRevisionIds: [], skillRevisionIds: [], memoryQueryPolicy: {}, mcpTools: [], modelRoute: {}, budgetPolicy: {}, executionSubject: _subject(2), promptCompilerVersion: "prompt-v1", digest: `sha256:${"e".repeat(64)}`, compiledAt: "2026-07-18T01:00:00.000Z" };
}

/** Retry command as passed unchanged from conversation provenance. */
const _COMMAND = { runId: "run-1", expectedAttempt: 1, siloId: "silo-1", conversationId: "conversation-1", requestedBy: "user-1", requestedByPrincipalId: "principal-1", acceptedAt: "2026-07-18T01:00:00.000Z" } as const;

/** Workflow is unused because the mocked repository owns the final started result. */
const _WORKFLOW: Pick<IWorkflowEngine, "spawn"> = { spawn: vi.fn() };

describe("PrismaAgentRunRetryUnitOfWork", function _Suite()
{
	it("compiles through the exact serializable transaction after replay and authority checks", async function _TransactionBoundCompiler()
	{
		const prismaTransaction = {};
		const prisma = { $transaction: vi.fn(async function _Transaction(work) { return work(prismaTransaction); }) };
		const compiler: RetryRunInputCompiler = { compile: vi.fn().mockResolvedValue({ outcome: RetryRunInputCompileOutcomes.Compiled, nextInputSnapshot: _snapshot() }) };
		_retryRepository.checkRetryReplay.mockResolvedValueOnce({ status: "proceed" });
		_retryRepository.getRunAuthority.mockResolvedValueOnce(_authority());
		_retryRepository.startNextAttemptAtomically.mockResolvedValueOnce({ status: "started", run: { ..._authority().run, attempt: 2, state: "accepted", executionSubject: _subject(2), acceptedAt: _COMMAND.acceptedAt, startedAt: null, finishedAt: null, terminalReason: null } });

		await expect(new PrismaAgentRunRetryUnitOfWork(prisma as never, _WORKFLOW, compiler).retry(_COMMAND)).resolves.toMatchObject({ outcome: "started", run: { attempt: 2 } });

		expect(_retryRepository.checkRetryReplay).toHaveBeenCalledBefore(_retryRepository.getRunAuthority as never);
		expect(_retryRepository.getRunAuthority).toHaveBeenCalledBefore(compiler.compile as never);
		expect(compiler.compile).toHaveBeenCalledWith(_COMMAND, expect.objectContaining({ prisma: prismaTransaction, admittedAt: _COMMAND.acceptedAt, admittedAtEpochMs: Date.parse(_COMMAND.acceptedAt) }));
		expect(_retryRepository.startNextAttemptAtomically).toHaveBeenCalledAfter(compiler.compile as never);
		expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: "Serializable" }));
	});
});
