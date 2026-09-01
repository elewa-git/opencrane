import { type PrismaClient } from "@prisma/client";

import type { RunInputSnapshot } from "@opencrane/contracts";
import type { IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";
import type { ExecutionSubject } from "@opencrane/models/agents";
import { describe, expect, it, vi } from "vitest";

import { PrismaRunAdmissionUnitOfWork } from "../prisma-run-admission-repository";
import { RunAdmissionDenialReasons, RunExecutionPersonaPolicies, RunExecutionPersonalMemoryPolicies } from "../run-admission.types";

/** Creates one complete evidence-bound subject for the only admitted test run. */
function _ExecutionSubject(): ExecutionSubject
{
	return {
		schemaVersion: 1,
		siloId: "silo-1",
		agentIdentityId: "identity-1",
		principalId: "principal-1",
		identity: { agentIdentityId: "identity-1", principalId: "principal-1", siloId: "silo-1", headRevision: "4", headDigest: `sha256:${"a".repeat(64)}`, decisionEvidenceId: "identity-decision-1", verifiedAt: "2026-09-01T00:00:00.000Z" },
		membership: { principalId: "principal-1", siloId: "silo-1", revision: 7, assertionId: "membership-1", payloadDigest: `sha256:${"b".repeat(64)}`, decisionEvidenceId: "membership-decision-1", trustedUntil: "2099-09-01T00:00:00.000Z" },
		capability: { agentIdentityId: "identity-1", computerId: "computer-1", capabilitySetDigest: `sha256:${"c".repeat(64)}`, effectiveContractDigest: `sha256:${"d".repeat(64)}`, decisionEvidenceId: "capability-decision-1", decidedAt: "2026-09-01T00:00:00.000Z" },
		runScope: { siloId: "silo-1", runId: "run-1", attempt: 1, agentServiceId: "service-1", agentRevisionId: "revision-1" },
		computerScope: { siloId: "silo-1", computerId: "computer-1", leaseId: "lease-1", leaseGeneration: 2 },
		requester: { siloId: "silo-1", requesterPrincipalId: "requester-1", requestIdempotencyKey: "request-1", authenticatedAt: "2026-09-01T00:00:00.000Z" },
		admission: { authorizingPrincipalId: "authorizer-1", decisionEvidenceId: "admission-decision-1", admittedAt: "2026-09-01T00:00:00.000Z" },
	};
}

/** Creates one exact immutable snapshot that embeds the admitted execution subject. */
function _Snapshot(executionSubject: ExecutionSubject = _ExecutionSubject()): RunInputSnapshot
{
	return {
		runId: "run-1",
		attempt: 1,
		siloId: "silo-1",
		agentServiceId: "service-1",
		agentRevisionId: "revision-1",
		snapshotVersion: 1,
		conversationId: "conversation-1",
		messageIds: ["message-1"],
		personaRevisionId: "persona-1",
		preferenceFactIds: ["preference-1"],
		artifactRevisionIds: ["artifact-1"],
		skillRevisionIds: ["skill-1"],
		memoryQueryPolicy: { scope: "personal" },
		mcpTools: [],
		modelRoute: { alias: "target" },
		budgetPolicy: { maxTokens: 1000 },
		executionSubject,
		promptCompilerVersion: "prompt-v1",
		digest: `sha256:${"e".repeat(64)}`,
		compiledAt: "2026-09-01T00:00:00.000Z",
	};
}

/** Creates one command carrying only server-verified requester provenance. */
function _Command()
{
	return { runId: "run-1", siloId: "silo-1", agentServiceId: "service-1", conversationId: "conversation-1", trigger: "interactive" as const, requestIdempotencyKey: "request-1", requester: { subjectId: "requester-subject-1", issuer: "https://issuer.example", authenticatedAt: "2026-09-01T00:00:00.000Z" } };
}

/** Creates the immutable authority facts that the transaction revalidates before writing. */
function _Authority()
{
	return { agentServiceId: "service-1", agentRevisionId: "revision-1", executionPolicy: { persona: RunExecutionPersonaPolicies.Required, personalMemory: RunExecutionPersonalMemoryPolicies.Allowed }, promptCompilerVersion: "prompt-v1", trigger: "interactive" as const, rootRunId: "run-1", parentRunId: null };
}

/** Returns the controller task writer required by admission. */
function _Workflow(): Pick<IWorkflowEngine, "spawn">
{
	return { async spawn(_transaction, task) { return { taskId: "task-1", taskName: task.taskName, idempotencyKey: task.idempotencyKey }; } };
}

/** Returns task delegate fakes that bind the current test's controller receipt. */
function _TaskStore()
{
	return { agentRunWorkflowTask: { upsert: vi.fn().mockResolvedValue({ runId: "run-1", attempt: 1, siloId: "silo-1", taskKey: "agent-run:silo-1:run-1:attempt:1", taskName: "agent-runs.execute/v1" }), updateMany: vi.fn().mockResolvedValue({ count: 1 }), findUnique: vi.fn() } };
}

describe("PrismaRunAdmissionUnitOfWork", function _DescribeAdmissionRepository()
{
	it("persists one strict execution subject on the run and its immutable snapshot", async function _PersistsSubject()
	{
		const executionSubject = _ExecutionSubject();
		const snapshot = _Snapshot(executionSubject);
		const transaction = { ..._TaskStore(), agentRun: { findUnique: vi.fn().mockResolvedValueOnce(null).mockResolvedValue({ id: "run-1", siloId: "silo-1", attempt: 1, agentServiceId: "service-1", agentRevisionId: "revision-1" }), create: vi.fn().mockResolvedValue({ id: "run-1" }) }, runInputSnapshot: { create: vi.fn().mockResolvedValue({ id: "snapshot-1" }) } };
		const prisma = { $transaction: vi.fn(async function _Transaction(callback: (client: typeof transaction) => Promise<unknown>) { return callback(transaction); }) } as unknown as PrismaClient;
		const repository = new PrismaRunAdmissionUnitOfWork(prisma, _Workflow());

		await expect(repository.admit(_Command(), async function _Build() { return { outcome: "ready", value: { authority: _Authority(), snapshot } } as const; })).resolves.toEqual({ outcome: "accepted", snapshot });
		expect(transaction.agentRun.create).toHaveBeenCalledWith({ data: expect.objectContaining({ agentIdentityId: "identity-1", principalId: "principal-1", executionSubject }) });
		expect(transaction.runInputSnapshot.create).toHaveBeenCalledWith({ data: expect.objectContaining({ agentIdentityId: "identity-1", principalId: "principal-1", executionSubject }) });
	});

	it("denies a snapshot whose execution subject is not fenced to the admitted run", async function _DeniesSubjectMismatch()
	{
		const snapshotSubject = { ..._ExecutionSubject(), runScope: { ..._ExecutionSubject().runScope, runId: "other-run" } };
		const transaction = { agentRun: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() }, runInputSnapshot: { create: vi.fn() } };
		const prisma = { $transaction: vi.fn(async function _Transaction(callback: (client: typeof transaction) => Promise<unknown>) { return callback(transaction); }) } as unknown as PrismaClient;
		const repository = new PrismaRunAdmissionUnitOfWork(prisma, _Workflow());

		await expect(repository.admit(_Command(), async function _Build() { return { outcome: "ready", value: { authority: _Authority(), snapshot: _Snapshot(snapshotSubject) } } as const; })).resolves.toEqual({ outcome: "denied", reason: RunAdmissionDenialReasons.AuthorityConflict });
		expect(transaction.agentRun.create).not.toHaveBeenCalled();
	});

	it("returns the first snapshot only when the duplicate subject is exact", async function _ReturnsExactDuplicate()
	{
		const executionSubject = _ExecutionSubject();
		const snapshot = _Snapshot(executionSubject);
		const transaction = { agentRun: { findUnique: vi.fn().mockResolvedValue({ id: "run-1", siloId: "silo-1", agentServiceId: "service-1", conversationId: "conversation-1", trigger: "Interactive", agentIdentityId: "identity-1", principalId: "principal-1", executionSubject, inputSnapshotDigest: snapshot.digest }) }, runInputSnapshot: { findUnique: vi.fn().mockResolvedValue({ ...snapshot, agentIdentityId: "identity-1", principalId: "principal-1", executionSubject, compiledAt: new Date(snapshot.compiledAt) }) } };
		const prisma = { $transaction: vi.fn(async function _Transaction(callback: (client: typeof transaction) => Promise<unknown>) { return callback(transaction); }) } as unknown as PrismaClient;
		const repository = new PrismaRunAdmissionUnitOfWork(prisma, _Workflow());

		await expect(repository.admit(_Command(), async function _UnexpectedBuild() { throw new Error("unexpected build"); })).resolves.toEqual({ outcome: "idempotent", snapshot });
	});
});
