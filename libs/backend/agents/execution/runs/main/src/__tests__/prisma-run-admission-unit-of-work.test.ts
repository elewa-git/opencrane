import { ExecutionSubjectMembershipKinds } from "@opencrane/models/agents";
import { Prisma, type PrismaClient } from "@prisma/client";

import type { Logger } from "@opencrane/backend/observability";
import type { RunInputSnapshot } from "@opencrane/contracts";
import type { ExecutionSubject } from "@opencrane/models/agents";
import { describe, expect, it, vi } from "vitest";

import { PrismaRunAdmissionUnitOfWork } from "../prisma-run-admission-unit-of-work";
import { RunAdmissionDenialReasons, RunAdmissionMessageInputModes, RunExecutionPersonalMemoryPolicies, RunExecutionPersonaPolicies, type RunAdmissionCommand } from "../run-admission.types";

/** Create one complete lease-bound execution subject for the admitted personal run. */
function _ExecutionSubject(): ExecutionSubject
{
	return {
		schemaVersion: 1,
		siloId: "silo-1",
		agentIdentityId: "identity-1",
		principalId: "principal-1",
		identity: { agentIdentityId: "identity-1", principalId: "principal-1", siloId: "silo-1", headRevision: "4", headDigest: `sha256:${"a".repeat(64)}`, decisionEvidenceId: "identity-decision-1", verifiedAt: "2026-09-01T00:00:00.000Z" },
		membership: { kind: ExecutionSubjectMembershipKinds.Fleet, principalId: "principal-1", siloId: "silo-1", revision: 7, assertionId: "membership-1", payloadDigest: `sha256:${"b".repeat(64)}`, decisionEvidenceId: "membership-decision-1", trustedUntil: "2099-09-01T00:00:00.000Z" },
		capability: { agentIdentityId: "identity-1", computerId: "computer-1", capabilitySetDigest: `sha256:${"c".repeat(64)}`, effectiveContractDigest: `sha256:${"d".repeat(64)}`, decisionEvidenceId: "capability-decision-1", decidedAt: "2026-09-01T00:00:00.000Z" },
		runScope: { siloId: "silo-1", runId: "run-1", attempt: 1, agentServiceId: "service-1", agentRevisionId: "revision-1" },
		computerScope: { siloId: "silo-1", computerId: "computer-1", leaseId: "lease-1", leaseGeneration: 2 },
		requester: { membership: { kind: ExecutionSubjectMembershipKinds.Fleet, principalId: "principal-1", siloId: "silo-1", revision: 7, assertionId: "membership-1", payloadDigest: `sha256:${"b".repeat(64)}`, decisionEvidenceId: "membership-decision-1", trustedUntil: "2099-09-01T00:00:00.000Z" }, siloId: "silo-1", requesterPrincipalId: "principal-1", requestIdempotencyKey: "request-1", authenticatedAt: "2026-09-01T00:00:00.000Z" },
		admission: { authorizingPrincipalId: "principal-1", decisionEvidenceId: "admission-decision-1", admittedAt: "2026-09-01T00:00:00.000Z" },
	};
}

/** Create the immutable first-attempt snapshot persisted by every successful test admission. */
function _Snapshot(subject: ExecutionSubject = _ExecutionSubject()): RunInputSnapshot
{
	return { runId: "run-1", attempt: 1, siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", snapshotVersion: 1, conversationId: "conversation-1", messageIds: ["message-1"], personaRevisionId: "persona-1", preferenceFactIds: ["preference-1"], artifactRevisionIds: ["artifact-1"], skillRevisionIds: ["skill-1"], memoryQueryPolicy: { scope: "personal" }, mcpTools: [], modelRoute: { alias: "target" }, budgetPolicy: { maxTokens: 1000 }, executionSubject: subject, promptCompilerVersion: "prompt-v1", digest: `sha256:${"e".repeat(64)}`, compiledAt: "2026-09-01T00:00:00.000Z" };
}

/** Create one browser-derived admission command with no caller-controlled authority evidence. */
function _Command(): RunAdmissionCommand
{
	return { runId: "run-1", siloId: "silo-1", agentServiceId: "service-1", conversationId: "conversation-1", trigger: "interactive" as const, requestIdempotencyKey: "request-1", messageInput: { mode: RunAdmissionMessageInputModes.PrePersistedHistory, messageId: "message-1", historyRevision: "7", orderedMessageIds: ["message-1"], author: { principalId: "principal-1", issuer: "https://issuer.example", subjectId: "subject-1", authenticatedAt: "2026-09-01T00:00:00.000Z" } }, requester: { subjectId: "subject-1", issuer: "https://issuer.example", authenticatedAt: "2026-09-01T00:00:00.000Z" } };
}

/** Create authority facts re-read by the input compiler inside the transaction. */
function _Authority()
{
	return { agentServiceId: "service-1", agentRevisionId: "revision-1", executionPolicy: { persona: RunExecutionPersonaPolicies.Required, personalMemory: RunExecutionPersonalMemoryPolicies.Allowed }, promptCompilerVersion: "prompt-v1", trigger: "interactive" as const };
}

/** Create a logger double that keeps failure assertions isolated from process output. */
function _Logger(): Logger
{
	return { error: vi.fn() } as unknown as Logger;
}

/** Accept an existing snapshot after the unit of work supplies its transaction fence. */
async function _VerifyExisting()
{
	return { outcome: "verified" } as const;
}

describe("PrismaRunAdmissionUnitOfWork", function _Suite()
{
	it("commits one run and its immutable snapshot without reviving a managed workflow task", async function _PersistsAdmission()
	{
		const snapshot = _Snapshot();
		const transaction = { agentRun: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: "run-1" }) }, runInputSnapshot: { create: vi.fn().mockResolvedValue({ id: "snapshot-1" }) } };
		const prisma = { $transaction: vi.fn(async function _Transaction(operation: (client: typeof transaction) => Promise<unknown>) { return operation(transaction); }) } as unknown as PrismaClient;
		const repository = new PrismaRunAdmissionUnitOfWork(prisma, { now: function _Now() { return new Date("2026-09-01T00:00:00.000Z"); } }, _Logger());

		await expect(repository.admit(_Command(), _VerifyExisting, async function _Build() { return { outcome: "ready", value: { authority: _Authority(), snapshot } } as const; })).resolves.toEqual({ outcome: "accepted", snapshot });
		expect(transaction.agentRun.create).toHaveBeenCalledWith({ data: expect.objectContaining({ id: "run-1", agentIdentityId: "identity-1", principalId: "principal-1", executionSubject: snapshot.executionSubject, inputSnapshotDigest: snapshot.digest }) });
		expect(transaction.runInputSnapshot.create).toHaveBeenCalledWith({ data: expect.objectContaining({ runId: "run-1", attempt: 1, agentIdentityId: "identity-1", principalId: "principal-1", executionSubject: snapshot.executionSubject, digest: snapshot.digest }) });
	});

	it("returns the current immutable snapshot for an exact idempotent duplicate", async function _ReturnsDuplicate()
	{
		const snapshot = _Snapshot();
		const row = { ...snapshot, agentIdentityId: "identity-1", principalId: "principal-1", executionSubject: snapshot.executionSubject, compiledAt: new Date(snapshot.compiledAt), retiredMemoryFacts: [] };
		const transaction = { agentRun: { findUnique: vi.fn().mockResolvedValue({ id: "run-1", attempt: 1, siloId: "silo-1", agentServiceId: "service-1", conversationId: "conversation-1", trigger: "Interactive", inputSnapshotDigest: snapshot.digest }) }, runInputSnapshot: { findUnique: vi.fn().mockResolvedValue(row) } };
		const prisma = { $transaction: vi.fn(async function _Transaction(operation: (client: typeof transaction) => Promise<unknown>) { return operation(transaction); }) } as unknown as PrismaClient;
		const repository = new PrismaRunAdmissionUnitOfWork(prisma, undefined, _Logger());

		await expect(repository.admit({ ..._Command(), runId: "retry-generated-run-id" }, _VerifyExisting, async function _UnexpectedBuild() { throw new Error("duplicate must not rebuild"); })).resolves.toEqual({ outcome: "idempotent", snapshot });
		expect(transaction.runInputSnapshot.findUnique).toHaveBeenCalledWith({ where: { runId_attempt_digest: { runId: "run-1", attempt: 1, digest: snapshot.digest } } });
	});

	it("refuses an idempotent snapshot when its current authority was revoked", async function _RejectsRevokedDuplicate()
	{
		const snapshot = _Snapshot();
		const row = { ...snapshot, agentIdentityId: "identity-1", principalId: "principal-1", executionSubject: snapshot.executionSubject, compiledAt: new Date(snapshot.compiledAt), retiredMemoryFacts: [] };
		const transaction = { agentRun: { findUnique: vi.fn().mockResolvedValue({ id: "run-1", attempt: 1, siloId: "silo-1", agentServiceId: "service-1", conversationId: "conversation-1", trigger: "Interactive", inputSnapshotDigest: snapshot.digest }) }, runInputSnapshot: { findUnique: vi.fn().mockResolvedValue(row) } };
		const prisma = { $transaction: vi.fn(async function _Transaction(operation: (client: typeof transaction) => Promise<unknown>) { return operation(transaction); }) } as unknown as PrismaClient;
		const build = vi.fn();
		const repository = new PrismaRunAdmissionUnitOfWork(prisma, undefined, _Logger());

		await expect(repository.admit({ ..._Command(), runId: "retry-generated-run-id" }, async function _DenyExisting() { return { outcome: "denied", reason: "product_authorization_unavailable" } as const; }, build)).resolves.toEqual({ outcome: "denied", reason: "product_authorization_unavailable" });
		expect(build).not.toHaveBeenCalled();
	});

	it("rechecks revoked authority while recovering a unique-key race", async function _RejectsRevokedRaceWinner()
	{
		const snapshot = _Snapshot();
		const row = { ...snapshot, agentIdentityId: "identity-1", principalId: "principal-1", executionSubject: snapshot.executionSubject, compiledAt: new Date(snapshot.compiledAt), retiredMemoryFacts: [] };
		const losing = { agentRun: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockRejectedValue(new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "test" })) }, runInputSnapshot: { create: vi.fn() } };
		const winner = { agentRun: { findUnique: vi.fn().mockResolvedValue({ id: "run-1", attempt: 1, siloId: "silo-1", agentServiceId: "service-1", conversationId: "conversation-1", trigger: "Interactive", inputSnapshotDigest: snapshot.digest }) }, runInputSnapshot: { findUnique: vi.fn().mockResolvedValue(row) } };
		let call = 0;
		const prisma = { $transaction: vi.fn(async function _Transaction(operation: (client: never) => Promise<unknown>) { call += 1; return operation((call === 1 ? losing : winner) as never); }) } as unknown as PrismaClient;
		const verifyExisting = vi.fn().mockResolvedValue({ outcome: "denied", reason: "product_authorization_unavailable" });
		const repository = new PrismaRunAdmissionUnitOfWork(prisma, undefined, _Logger());

		await expect(repository.admit(_Command(), verifyExisting, async function _Build() { return { outcome: "ready", value: { authority: _Authority(), snapshot } } as const; })).resolves.toEqual({ outcome: "denied", reason: "product_authorization_unavailable" });
		expect(verifyExisting).toHaveBeenCalledOnce();
	});

	it("rejects a compiled subject that names a different computer-bound run", async function _RejectsSubjectMismatch()
	{
		const otherSubject = { ..._ExecutionSubject(), runScope: { ..._ExecutionSubject().runScope, runId: "other-run" } };
		const transaction = { agentRun: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() }, runInputSnapshot: { create: vi.fn() } };
		const prisma = { $transaction: vi.fn(async function _Transaction(operation: (client: typeof transaction) => Promise<unknown>) { return operation(transaction); }) } as unknown as PrismaClient;
		const repository = new PrismaRunAdmissionUnitOfWork(prisma, undefined, _Logger());

		await expect(repository.admit(_Command(), _VerifyExisting, async function _Build() { return { outcome: "ready", value: { authority: _Authority(), snapshot: _Snapshot(otherSubject) } } as const; })).resolves.toEqual({ outcome: "denied", reason: RunAdmissionDenialReasons.AuthorityConflict });
		expect(transaction.agentRun.create).not.toHaveBeenCalled();
	});

	it("rejects pre-persisted message metadata whose final snapshot provenance is different", async function _RejectsAmbiguousMessageInput()
	{
		const command = { ..._Command(), messageInput: { ..._Command().messageInput!, orderedMessageIds: ["different-message"] } };
		const snapshot = { ..._Snapshot(), messageIds: ["different-message"] };
		const transaction = { agentRun: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() }, runInputSnapshot: { create: vi.fn() } };
		const prisma = { $transaction: vi.fn(async function _Transaction(operation: (client: typeof transaction) => Promise<unknown>) { return operation(transaction); }) } as unknown as PrismaClient;
		const repository = new PrismaRunAdmissionUnitOfWork(prisma, undefined, _Logger());

		await expect(repository.admit(command, _VerifyExisting, async function _Build() { return { outcome: "ready", value: { authority: _Authority(), snapshot } } as const; })).resolves.toEqual({ outcome: "denied", reason: RunAdmissionDenialReasons.AuthorityConflict });
		expect(transaction.agentRun.create).not.toHaveBeenCalled();
	});

	it("rolls back prepared input rows when compilation refuses admission", async function _RollsBackPreparation()
	{
		const transaction = { agentRun: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() }, runInputSnapshot: { create: vi.fn() } };
		const prisma = { $transaction: vi.fn(async function _Transaction(operation: (client: typeof transaction) => Promise<unknown>) { return operation(transaction); }) } as unknown as PrismaClient;
		const prepare = vi.fn().mockResolvedValue(undefined);
		const repository = new PrismaRunAdmissionUnitOfWork(prisma, undefined, _Logger());

		await expect(repository.admit(_Command(), _VerifyExisting, async function _Build() { return { outcome: "denied", reason: "conversation_unavailable" } as const; }, undefined, prepare)).resolves.toEqual({ outcome: "denied", reason: "conversation_unavailable" });
		expect(prepare).toHaveBeenCalledOnce();
		expect(transaction.agentRun.create).not.toHaveBeenCalled();
	});

	it("rolls back transaction authority writes on denial without a prepare hook", async function _RollsBackAuthorityWrites()
	{
		const durableWrites: string[] = [];
		const transaction = { authorityWrites: [] as string[], agentRun: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() }, runInputSnapshot: { create: vi.fn() } };
		const prisma = { $transaction: vi.fn(async function _Transaction(operation: (client: typeof transaction) => Promise<unknown>)
		{
			try
			{
				const result = await operation(transaction);
				durableWrites.push(...transaction.authorityWrites);
				return result;
			}
			catch (error)
			{
				transaction.authorityWrites.length = 0;
				throw error;
			}
		}) } as unknown as PrismaClient;
		const repository = new PrismaRunAdmissionUnitOfWork(prisma, undefined, _Logger());

		await expect(repository.admit(_Command(), _VerifyExisting, async function _Build(context)
		{
			(context.prisma as typeof transaction).authorityWrites.push("conversation-use-decision");
			return { outcome: "denied", reason: "product_authorization_unavailable" } as const;
		})).resolves.toEqual({ outcome: "denied", reason: "product_authorization_unavailable" });
		expect(durableWrites).toEqual([]);
		expect(transaction.authorityWrites).toEqual([]);
		expect(transaction.agentRun.create).not.toHaveBeenCalled();
	});
});
