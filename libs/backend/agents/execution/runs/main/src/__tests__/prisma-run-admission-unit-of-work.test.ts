import { Prisma, type PrismaClient, type AgentRun, type AuthorizationGrant, type RunInputSnapshot as StoredSnapshot } from "@prisma/client";

import type { Logger } from "@opencrane/backend/observability";
import type { RunInputSnapshot } from "@opencrane/contracts";
import { ExecutionSubjectMembershipKinds, type ExecutionSubject } from "@opencrane/models/agents";
import { PrismaAuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import { ProductAuthorizationActions, ProductAuthorizationResourceKinds, __ProductAuthorizationCapability } from "@opencrane/models/authorization";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PrismaSelfRunStatusRepository } from "../prisma-self-run-status-repository";
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

/** Gives the company its own execution identity while retaining the human requester. */
function _ManagedSubject(): ExecutionSubject
{
	const personal = _ExecutionSubject();
	return {
		...personal,
		principalId: "company-principal",
		identity: { ...personal.identity, principalId: "company-principal" },
		membership: { kind: ExecutionSubjectMembershipKinds.Managed, siloId: "silo-1", principalId: "company-principal", agentServiceId: "service-1", agentRevisionId: "revision-1", agentRevisionDigest: `sha256:${"f".repeat(64)}`, decisionEvidenceId: "company-decision", trustedUntil: "2099-09-01T00:00:00.000Z" },
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

/** Supplies stored grants to the real grant writer and authorization evaluator. */
function _GrantDelegates()
{
	const rows: AuthorizationGrant[] = [];
	const transaction = {
		authorizationGrant: {
			findMany: vi.fn(async function _Find({ where }: { where: Prisma.AuthorizationGrantWhereInput })
			{
				return rows.filter(function _Matches(row)
				{
					return row.siloId === where.siloId
						&& (where.managerId === undefined || row.managerId === where.managerId)
						&& (where.resourceKind === undefined || row.resourceKind === where.resourceKind)
						&& (where.resourceId === undefined || row.resourceId === where.resourceId)
						&& (where.effect === undefined || row.effect === where.effect)
						&& (where.revokedAt !== null || row.revokedAt === null)
						&& (where.OR === undefined || where.OR.some(subject => subject.subjectKind === row.subjectKind && subject.subjectPrincipalId === row.subjectPrincipalId));
				});
			}),
			create: vi.fn(async function _Create({ data }: { data: Prisma.AuthorizationGrantUncheckedCreateInput })
			{
				const row = { id: `grant-${rows.length + 1}`, ...data, expiresAt: null, revokedAt: null, createdAt: new Date() } as AuthorizationGrant;
				rows.push(row);
				return row;
			}),
			updateMany: vi.fn(),
		},
		auditEntry: { create: vi.fn() },
	};
	return { rows, transaction };
}

/** Composes actual admission, grant writing and status authorization over transaction doubles. */
function _ActivityFixture()
{
	vi.spyOn(Date, "now").mockReturnValue(new Date("2026-09-01T00:02:00.000Z").getTime());
	const grants = _GrantDelegates();
	const runs: AgentRun[] = [];
	const snapshots: StoredSnapshot[] = [];
	const transaction = {
		...grants.transaction,
		principal: { findUnique: vi.fn(async function _Principal({ where }: { where: Prisma.PrincipalWhereUniqueInput })
		{
			const coordinates = where.id_siloId!;
			return coordinates.siloId === "silo-1" ? { id: coordinates.id, subject: coordinates.id, provenance: "External" } : null;
		}) },
		orgMembership: { findFirst: vi.fn().mockResolvedValue({ id: "membership-1" }) },
		groupMembership: { findMany: vi.fn().mockResolvedValue([]) },
		agentRun: {
			findUnique: vi.fn(async function _Existing({ where }: { where: Prisma.AgentRunWhereUniqueInput }) { return runs.find(run => run.siloId === where.siloId_requestIdempotencyKey?.siloId && run.requestIdempotencyKey === where.siloId_requestIdempotencyKey?.requestIdempotencyKey) ?? null; }),
			create: vi.fn(async function _Create({ data }: { data: Prisma.AgentRunUncheckedCreateInput }) { const row = { ...data, attempt: 1, state: "Accepted", finishedAt: null } as AgentRun; runs.push(row); return row; }),
			findMany: vi.fn(async function _List({ where }: { where: Prisma.AgentRunWhereInput }) { return runs.filter(run => run.siloId === where.siloId && run.principalId === (where.principalId as Prisma.StringFilter).equals); }),
			findFirst: vi.fn(async function _Read({ where }: { where: Prisma.AgentRunWhereInput }) { return runs.find(run => run.id === where.id && run.siloId === where.siloId && run.principalId === (where.principalId as Prisma.StringFilter).equals) ?? null; }),
		},
		runInputSnapshot: {
			create: vi.fn(async function _Create({ data }: { data: Prisma.RunInputSnapshotUncheckedCreateInput }) { snapshots.push(data as StoredSnapshot); return data; }),
			findUnique: vi.fn(async function _Read({ where }: { where: Prisma.RunInputSnapshotWhereUniqueInput }) { return snapshots.find(snapshot => snapshot.runId === where.runId_attempt_digest?.runId && snapshot.attempt === where.runId_attempt_digest.attempt && snapshot.digest === where.runId_attempt_digest.digest) ?? null; }),
		},
	};
	const prisma = { $transaction: vi.fn(async function _Transaction(operation: (client: typeof transaction) => Promise<unknown>)
	{
		const lengths = [runs.length, snapshots.length, grants.rows.length];
		try { return await operation(transaction); }
		catch (error) { runs.splice(lengths[0]); snapshots.splice(lengths[1]); grants.rows.splice(lengths[2]); throw error; }
	}) } as unknown as PrismaClient;
	const authority = new PrismaAuthorizationAuthority(transaction as never);
	const status = new PrismaSelfRunStatusRepository(transaction as never, authority);
	const admission = new PrismaRunAdmissionUnitOfWork(prisma, { now: function _Now() { return new Date("2026-09-01T00:00:00.000Z"); } }, _Logger());
	return { grants: grants.rows, runs, snapshots, transaction, admission, status, authority };
}

/** Builds a personal run after the compiler has verified its owner and inputs. */
async function _BuildPersonal()
{
	return { outcome: "ready", value: { authority: _Authority(), snapshot: _Snapshot() } } as const;
}

describe("PrismaRunAdmissionUnitOfWork", function _Suite()
{
	afterEach(function _RestoreClock() { vi.restoreAllMocks(); });
	it("shows new completed personal work using its admitted read grant", async function _PersonalActivity()
	{
		const f = _ActivityFixture();
		await expect(f.admission.admit(_Command(), _VerifyExisting, _BuildPersonal)).resolves.toMatchObject({ outcome: "accepted" });
		const capability = __ProductAuthorizationCapability(ProductAuthorizationResourceKinds.AgentRun, ProductAuthorizationActions.Read)!;
		expect(f.grants).toEqual([expect.objectContaining({ siloId: "silo-1", managerId: "personal-run-owner", subjectKind: "Principal", subjectPrincipalId: "principal-1", boundaryKind: "Personal", boundaryPrincipalId: "principal-1", boundaryCoverage: "Exact", resourceKind: ProductAuthorizationResourceKinds.AgentRun, resourceId: "run-1", catalogId: capability.catalog.catalogId, catalogDigest: capability.catalog.digest, capabilityId: capability.capabilityId, effect: "Allow", validFrom: new Date("2026-09-01T00:00:00.000Z") })]);
		f.runs[0].state = "Completed";
		f.runs[0].finishedAt = new Date("2026-09-01T00:01:00.000Z");
		const caller = { siloId: "silo-1", principalId: "principal-1" };
		const expected = { runId: "run-1", state: "completed", conversationId: "conversation-1", finishedAt: "2026-09-01T00:01:00.000Z" };
		await expect(f.status.listOwned(caller)).resolves.toEqual([expect.objectContaining(expected)]);
		await expect(f.status.readOwned(caller, "run-1")).resolves.toMatchObject(expected);
		await expect(f.admission.admit({ ..._Command(), runId: "retry-id" }, _VerifyExisting, _BuildPersonal)).resolves.toMatchObject({ outcome: "idempotent" });
		expect([f.runs.length, f.snapshots.length, f.grants.length]).toEqual([1, 1, 1]);
		for (const other of [{ ...caller, principalId: "principal-2" }, { ...caller, siloId: "silo-2" }])
		{
			await expect(f.status.listOwned(other)).resolves.toEqual([]);
			await expect(f.status.readOwned(other, "run-1")).resolves.toBeNull();
			await expect(f.authority.listPrincipalEntitled({ ...other, action: ProductAuthorizationActions.Read, resources: [{ kind: ProductAuthorizationResourceKinds.AgentRun, id: "run-1" }], nowEpochMs: Date.now() })).resolves.toEqual([]);
		}
	});

	it.each(["revocation", "membership", "explicit deny"])("keeps activity denied after %s, including an otherwise valid admission retry", async function _CurrentPermission(reason)
	{
		const f = _ActivityFixture();
		await f.admission.admit(_Command(), _VerifyExisting, _BuildPersonal);
		if (reason === "revocation")
			f.grants[0].revokedAt = new Date("2026-09-01T00:01:00.000Z");
		if (reason === "membership")
			f.transaction.orgMembership.findFirst.mockResolvedValue(null);
		if (reason === "explicit deny")
			f.grants.push({ ...f.grants[0], id: "deny-1", managerId: "administrator", effect: "Deny", priority: 10 });
		await expect(f.admission.admit({ ..._Command(), runId: "retry-id" }, _VerifyExisting, _BuildPersonal)).resolves.toMatchObject({ outcome: "idempotent" });
		expect(f.transaction.authorizationGrant.create).toHaveBeenCalledOnce();
		expect(f.transaction.authorizationGrant.findMany).toHaveBeenCalledOnce();
		const caller = { siloId: "silo-1", principalId: "principal-1" };
		await expect(f.status.listOwned(caller)).resolves.toEqual([]);
		await expect(f.status.readOwned(caller, "run-1")).resolves.toBeNull();
	});

	it("does not grant company activity to its human requester", async function _CompanyActivity()
	{
		const f = _ActivityFixture();
		await expect(f.admission.admit(_Command(), _VerifyExisting, async function _Build() { return { outcome: "ready", value: { authority: _Authority(), snapshot: _Snapshot(_ManagedSubject()) } } as const; })).resolves.toMatchObject({ outcome: "accepted" });
		expect(f.runs[0].principalId).toBe("company-principal");
		expect(f.grants).toEqual([]);
		await expect(f.status.listOwned({ siloId: "silo-1", principalId: "principal-1" })).resolves.toEqual([]);
	});

	it.each(["compiler denial", "different personal owner"])("leaves no activity permission after %s", async function _DeniedAdmission(reason)
	{
		const f = _ActivityFixture();
		const subject = _ExecutionSubject();
		const changedOwner = { ...subject, principalId: "other-owner", identity: { ...subject.identity, principalId: "other-owner" }, membership: { ...subject.membership, principalId: "other-owner" } };
		await expect(f.admission.admit(_Command(), _VerifyExisting, async function _Build()
		{
			if (reason === "compiler denial")
				return { outcome: "denied", reason: "product_authorization_unavailable" } as const;
			return { outcome: "ready", value: { authority: _Authority(), snapshot: _Snapshot(changedOwner) } } as const;
		})).resolves.toMatchObject({ outcome: "denied" });
		expect([f.runs.length, f.snapshots.length, f.grants.length]).toEqual([0, 0, 0]);
		expect(f.transaction.authorizationGrant.create).not.toHaveBeenCalled();
	});

	it.each(["grant", "later commit"])("rolls back the run, snapshot and grant when %s persistence fails", async function _GrantRollback(failure)
	{
		const f = _ActivityFixture();
		if (failure === "grant")
			f.transaction.authorizationGrant.create.mockRejectedValue(new Error("grant storage unavailable"));
		await expect(f.admission.admit(_Command(), _VerifyExisting, _BuildPersonal, async function _Commit() { throw new Error("later write failed"); })).resolves.toMatchObject({ outcome: "denied", reason: RunAdmissionDenialReasons.PersistenceUnavailable });
		expect([f.runs.length, f.snapshots.length, f.grants.length]).toEqual([0, 0, 0]);
	});

	it.each(["personal", "company"])("persists and retries a %s run under its execution identity and human requester", async function _FirstAndDuplicate(kind)
	{
		const subject = kind === "company" ? _ManagedSubject() : _ExecutionSubject();
		const snapshot = { ..._Snapshot(subject), preferenceFactIds: [], memoryQueryPolicy: { scope: "none" } };
		const transaction = { ..._GrantDelegates().transaction, agentRun: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() }, runInputSnapshot: { findUnique: vi.fn(), create: vi.fn() } };
		const prisma = { $transaction: vi.fn(async function _Transaction(operation: (client: typeof transaction) => Promise<unknown>) { return operation(transaction); }) } as unknown as PrismaClient;
		const repository = new PrismaRunAdmissionUnitOfWork(prisma, undefined, _Logger());
		const build = vi.fn().mockResolvedValue({ outcome: "ready", value: { authority: _Authority(), snapshot } });
		const verify = vi.fn(_VerifyExisting);

		await expect(repository.admit(_Command(), verify, build)).resolves.toEqual({ outcome: "accepted", snapshot });
		expect(transaction.agentRun.create).toHaveBeenCalledWith({ data: expect.objectContaining({ principalId: subject.principalId, executionSubject: subject }) });
		const stored = transaction.runInputSnapshot.create.mock.calls[0][0].data;
		expect(stored.principalId).toBe(subject.principalId);
		expect(stored.executionSubject.requester.requesterPrincipalId).toBe("principal-1");
		transaction.agentRun.findUnique.mockResolvedValue({ ...transaction.agentRun.create.mock.calls[0][0].data, attempt: 1 });
		transaction.runInputSnapshot.findUnique.mockResolvedValue(stored);

		await expect(repository.admit(_Command(), verify, build)).resolves.toEqual({ outcome: "idempotent", snapshot });
		expect(build).toHaveBeenCalledTimes(1);
		expect(verify).toHaveBeenCalledTimes(1);
		expect(transaction.agentRun.create).toHaveBeenCalledTimes(1);
	});

	it.each(["requester", "malformed subject", "indexed principal", "indexed identity"])("refuses a company duplicate with changed %s before rechecking grants", async function _RejectChangedCompanyDuplicate(change)
	{
		const snapshot = _Snapshot(_ManagedSubject());
		const row = { ...snapshot, agentIdentityId: "identity-1", principalId: "company-principal", compiledAt: new Date(snapshot.compiledAt) };
		if (change === "requester")
		{
			row.executionSubject = { ...row.executionSubject, requester: { ...row.executionSubject.requester, requesterPrincipalId: "other-human", membership: { ...row.executionSubject.requester.membership, principalId: "other-human" } }, admission: { ...row.executionSubject.admission, authorizingPrincipalId: "other-human" } };
		}
		if (change === "malformed subject")
			row.executionSubject = {} as ExecutionSubject;
		if (change === "indexed principal")
			row.principalId = "different-company";
		if (change === "indexed identity")
			row.agentIdentityId = "different-identity";
		const transaction = { agentRun: { findUnique: vi.fn().mockResolvedValue({ id: "run-1", attempt: 1, siloId: "silo-1", agentServiceId: "service-1", conversationId: "conversation-1", trigger: "Interactive", inputSnapshotDigest: snapshot.digest }) }, runInputSnapshot: { findUnique: vi.fn().mockResolvedValue(row) } };
		const prisma = { $transaction: vi.fn(async function _Transaction(operation: (client: typeof transaction) => Promise<unknown>) { return operation(transaction); }) } as unknown as PrismaClient;
		const repository = new PrismaRunAdmissionUnitOfWork(prisma, undefined, _Logger());
		const verify = vi.fn(_VerifyExisting);
		const build = vi.fn();

		await expect(repository.admit(_Command(), verify, build)).resolves.toEqual({ outcome: "denied", reason: RunAdmissionDenialReasons.AuthorityConflict });
		expect(verify).not.toHaveBeenCalled();
		expect(build).not.toHaveBeenCalled();
	});

	it("refuses a first company turn when its requester differs from the human message author", async function _RejectDifferentRequester()
	{
		const command = _Command();
		const otherCommand = { ...command, messageInput: { ...command.messageInput!, author: { ...command.messageInput!.author, principalId: "other-human" } } };
		const transaction = { agentRun: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() }, runInputSnapshot: { create: vi.fn() } };
		const prisma = { $transaction: vi.fn(async function _Transaction(operation: (client: typeof transaction) => Promise<unknown>) { return operation(transaction); }) } as unknown as PrismaClient;
		const repository = new PrismaRunAdmissionUnitOfWork(prisma, undefined, _Logger());
		const build = vi.fn().mockResolvedValue({ outcome: "ready", value: { authority: _Authority(), snapshot: _Snapshot(_ManagedSubject()) } });

		await expect(repository.admit(otherCommand, _VerifyExisting, build)).resolves.toEqual({ outcome: "denied", reason: RunAdmissionDenialReasons.AuthorityConflict });
		expect(transaction.agentRun.create).not.toHaveBeenCalled();
	});

	it("commits one run and its immutable snapshot without reviving a managed workflow task", async function _PersistsAdmission()
	{
		const snapshot = _Snapshot();
		const transaction = { ..._GrantDelegates().transaction, agentRun: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: "run-1" }) }, runInputSnapshot: { create: vi.fn().mockResolvedValue({ id: "snapshot-1" }) } };
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
