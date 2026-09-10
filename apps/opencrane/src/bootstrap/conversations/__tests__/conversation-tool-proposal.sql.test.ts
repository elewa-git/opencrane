import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { ConversationToolProposalOutcomes, MCP_EXECUTOR_PROJECTED_TOKEN_AUDIENCE } from "@opencrane/contracts";
import { PrismaConversationToolProposalUnitOfWork } from "@opencrane/backend/server/conversations";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";


import { _ToolHandoffSqlRuntime, _WaitPastSqlDeadline } from "./conversation-tool-handoff.sql-fixture";
import { _SeedConversationToolProposalSqlFixture } from "./conversation-tool-proposal.sql-fixture";

/** Represents an identity already verified by this admission port's transport owner. */
const _WORKLOAD = { audience: "opencrane-conversation-computer", namespace: "computers", serviceAccountName: "computer", workloadKind: "pod", workloadUid: "computer-pod-1", podUid: "computer-pod-1" } as const;

/** Independent connections expose actual uniqueness and Serializable rollback behavior. */
const _First = new PrismaClient();
/** The second server never shares transaction or process-local admission state with the first. */
const _Second = new PrismaClient();

/** Keep each synthetic silo out of later candidate selection through the real controller owners. */
const _Runtimes = new Map<string, ReturnType<typeof _ToolHandoffSqlRuntime>>();

/** Retain interrupted controller claims so teardown can finish only this fixture's registration. */
function _Runtime(client: PrismaClient, fixture: Awaited<ReturnType<typeof _SeedConversationToolProposalSqlFixture>>, leaseMilliseconds = 300_000)
{
	const runtime = _ToolHandoffSqlRuntime(client, fixture, leaseMilliseconds);
	_Runtimes.set(fixture.siloId, runtime);
	return runtime;
}

/** Compose the same atomic admission port used by the application. */
function _Owner(client: PrismaClient, fixture: Awaited<ReturnType<typeof _SeedConversationToolProposalSqlFixture>>)
{
	return new PrismaConversationToolProposalUnitOfWork(client, fixture.dependencies, _Runtime(client, fixture).admission, async function _ApprovalExpiry() {});
}

/** Hold the first two count reads until both transactions have observed the unreserved slot. */
function _ConcurrentClients()
{
	let arrived = 0;
	let release!: () => void;
	const barrier = new Promise<void>(resolve => { release = resolve; });
	const extension = Prisma.defineExtension({ query: { toolInvocation: { async count({ args, query })
	{
		const count = await query(args);
		if (++arrived === 2)
			release();
		await barrier;
		return count;
	} } } });
	return [_First.$extends(extension), _Second.$extends(extension)].map(client => client as unknown as PrismaClient);
}

describe("conversation tool proposal admission on fresh PostgreSQL", function _Suite()
{
	beforeAll(async function _Connect()
	{
		if (!process.env.DATABASE_URL)
			throw new Error("The tool proposal SQL proof requires DATABASE_URL and the fresh target baseline");
		await Promise.all([_First.$connect(), _Second.$connect()]);
	});
	afterEach(async function _FinishFixtureControllers()
	{
		for (const runtime of _Runtimes.values())
			await runtime.register();
		_Runtimes.clear();
	});
	afterAll(async function _Disconnect() { await Promise.all([_First.$disconnect(), _Second.$disconnect()]); });

	it("converges concurrent identical proposals to one immutable invocation", async function _SameProposal()
	{
		const f = await _SeedConversationToolProposalSqlFixture();
		for (const client of [_First, _Second])
			expect(await client.agentRun.count({ where: { id: f.runId } })).toBe(1);
		const owners = _ConcurrentClients().map(client => _Owner(client, f));
		const receipts = await Promise.all(owners.map(owner => owner.admit(f.turn, f.candidate, f.proposal, _WORKLOAD)));
		expect(new Set(receipts.map(receipt => receipt.proposalId)).size).toBe(1);
		expect(receipts.map(receipt => receipt.outcome).sort()).toEqual([ConversationToolProposalOutcomes.Existing, ConversationToolProposalOutcomes.Recorded].sort());
		const rows = await _Second.toolInvocation.findMany({ where: { runId: f.runId } });
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ state: "Ready", attempt: 1, authorizationActorKind: "Workload", authorizationExecutionSubject: f.subject, arguments: f.proposal.arguments, effectiveArguments: f.proposal.arguments, toolInvocationId: receipts[0].proposalId });
		expect(rows[0].argumentsDigest).toBe(___DigestCanonicalJson(f.proposal.arguments));
		const audits = await _Second.auditDecision.findMany({ where: { siloId: f.siloId, actorKind: "Workload" } });
		expect(audits.length).toBeGreaterThanOrEqual(2);
		await expect(_Second.auditDecision.create({ data: { ...audits[0], id: `${f.siloId}-incomplete-audit`, decisionDigest: ___DigestCanonicalJson({ siloId: f.siloId, proof: "missing-workload-audience" }), audience: null } })).rejects.toThrow("audit_decisions_workload_identity_check");
		for (const audit of audits)
			expect(audit).toMatchObject({ actorId: _WORKLOAD.podUid, audience: _WORKLOAD.audience, namespace: _WORKLOAD.namespace, serviceAccountName: _WORKLOAD.serviceAccountName, workloadKind: "Pod", workloadUid: _WORKLOAD.workloadUid, podUid: _WORKLOAD.podUid, runId: f.runId, attempt: 1, agentServiceId: f.turn.binding.agentServiceId, agentRevisionId: f.subject.runScope.agentRevisionId });
		expect(await _Second.mcpRuntimeExecution.findMany({ where: { siloId: f.siloId } })).toMatchObject([{ toolInvocationId: rows[0].id, workloadState: "Pending", commandState: "Pending" }]);
		const restarted = _Owner(_Second, f);
		expect(await restarted.admit(f.turn, f.candidate, f.proposal, _WORKLOAD)).toEqual({ proposalId: receipts[0].proposalId, outcome: ConversationToolProposalOutcomes.Existing });
	});

	it("lets only one of two different argument bodies own the single slot", async function _ChangedBodyRace()
	{
		const f = await _SeedConversationToolProposalSqlFixture();
		const owners = _ConcurrentClients().map(client => _Owner(client, f));
		const results = await Promise.allSettled([owners[0].admit(f.turn, f.candidate, f.proposal, _WORKLOAD), owners[1].admit(f.turn, f.candidate, { ...f.proposal, arguments: { query: "different record" } }, _WORKLOAD)]);
		expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
		const refusal = results.find(result => result.status === "rejected") as PromiseRejectedResult;
		expect(refusal.reason.message).toBe("conversation_tool_proposal_conflict");
		expect(await _Second.toolInvocation.count({ where: { runId: f.runId } })).toBe(1);
	});

	it("rolls back the actual invocation insert when its final authority read denies", async function _AdmissionRollback()
	{
		const f = await _SeedConversationToolProposalSqlFixture();
		let created = 0;
		const client = _First.$extends({ query: { toolInvocation: { async create({ args, query }) { const row = await query(args); created++; return row; } } } });
		const dependencies = { ...f.dependencies, computers: { load: async function _RevokedComputer() { return null; } } };
		const owner = new PrismaConversationToolProposalUnitOfWork(client as unknown as PrismaClient, dependencies, _Runtime(_First, f).admission, async function _ApprovalExpiry() {});
		const auditsBefore = await _Second.auditDecision.count({ where: { siloId: f.siloId } });
		await expect(owner.admit(f.turn, f.candidate, f.proposal, _WORKLOAD)).rejects.toThrow("conversation_tool_proposal_denied");
		expect(created).toBe(1);
		expect(await _Second.toolInvocation.count({ where: { runId: f.runId } })).toBe(0);
		expect(await _Second.auditDecision.count({ where: { siloId: f.siloId } })).toBe(auditsBefore);
	});

	it("refuses a revoked grant without recreating or changing the saved proposal", async function _CurrentRevocation()
	{
		const f = await _SeedConversationToolProposalSqlFixture();
		const owner = _Owner(_First, f);
		await owner.admit(f.turn, f.candidate, f.proposal, _WORKLOAD);
		const before = await _Second.toolInvocation.findFirstOrThrow({ where: { runId: f.runId } });
		await _Second.authorizationGrant.update({ where: { id: f.toolGrantId }, data: { revokedAt: new Date() } });
		await expect(owner.admit(f.turn, f.candidate, f.proposal, _WORKLOAD)).rejects.toThrow("conversation_tool_proposal_denied");
		expect(await _Second.toolInvocation.findFirstOrThrow({ where: { runId: f.runId } })).toEqual(before);
		expect(await _Second.toolInvocation.count({ where: { runId: f.runId } })).toBe(1);
	});

	it("preserves the exact evidence digest and rejects argument replacement in storage", async function _ImmutableEvidence()
	{
		const f = await _SeedConversationToolProposalSqlFixture();
		await _Owner(_First, f).admit(f.turn, f.candidate, f.proposal, _WORKLOAD);
		const row = await _Second.toolInvocation.findFirstOrThrow({ where: { runId: f.runId } });
		expect(row.authorizationEvidenceDigest).toBe(___DigestCanonicalJson({ actorKind: "workload", executionSubject: row.authorizationExecutionSubject, coordinates: row.authorizationCoordinates, decisionDigests: row.authorizationDecisionDigests, agentRevisionId: row.agentRevisionId, runId: row.runId, attempt: row.attempt, argumentsDigest: row.argumentsDigest, assignmentDigest: row.authorizationAssignmentDigest } as JsonValue));
		await expect(_Second.toolInvocation.update({ where: { id: row.id }, data: { arguments: { query: "changed after admission" } } })).rejects.toThrow();
		expect((await _Second.toolInvocation.findUniqueOrThrow({ where: { id: row.id } })).arguments).toEqual(f.proposal.arguments);
	});

	it("rolls back preparation, executor insertion and audits after a failed handoff", async function _HandoffRollback()
	{
		const f = await _SeedConversationToolProposalSqlFixture();
		let inserted = 0;
		const client = _First.$extends({ query: { mcpRuntimeExecution: { async create({ args, query })
		{
			await query(args);
			inserted++;
			throw new Error("injected_handoff_failure");
		} } } }) as unknown as PrismaClient;
		const auditsBefore = await _Second.auditDecision.count({ where: { siloId: f.siloId } });
		await expect(_Owner(client, f).admit(f.turn, f.candidate, f.proposal, _WORKLOAD)).rejects.toThrow("injected_handoff_failure");
		expect(inserted).toBe(1);
		expect(await _Second.toolInvocation.count({ where: { runId: f.runId } })).toBe(0);
		expect(await _Second.mcpRuntimeExecution.count({ where: { siloId: f.siloId } })).toBe(0);
		expect(await _Second.auditDecision.count({ where: { siloId: f.siloId } })).toBe(auditsBefore);
	});

	it("recovers the same executor after claim and completion without resetting its saved state", async function _ProgressedRetry()
	{
		const f = await _SeedConversationToolProposalSqlFixture();
		const owner = _Owner(_First, f);
		const receipt = await owner.admit(f.turn, f.candidate, f.proposal, _WORKLOAD);
		const runtime = _Runtime(_First, f);
		const registered = (await runtime.register())!;
		const command = await runtime.authority.claimCompanion(registered.identity, registered.executionReference);
		if (command === null || typeof command === "string" || command.kind !== "invocation")
			throw new Error("Expected the real invocation claim");
		expect(command.kind).toBe("invocation");
		for (const state of ["Claimed", "Succeeded"])
		{
			if (state === "Succeeded")
				expect(await runtime.authority.completeCompanion(registered.identity, { executionReference: registered.executionReference, podUid: registered.identity.podUid, executionId: command.executionId, claimFence: command.claimFence, completion: { kind: command.kind, result: { isError: false, content: [{ type: "text", text: "Dedicated SQL fixture result" }] } } })).toBe("completed");
			const beforeInvocation = await _Second.toolInvocation.findFirstOrThrow({ where: { runId: f.runId } });
			const beforeExecution = await _Second.mcpRuntimeExecution.findUniqueOrThrow({ where: { id: registered.executionId } });
			expect(beforeInvocation.state).toBe(state);
			expect(await owner.admit(f.turn, f.candidate, f.proposal, _WORKLOAD)).toEqual({ proposalId: receipt.proposalId, outcome: ConversationToolProposalOutcomes.Existing });
			expect(await _Second.toolInvocation.findUniqueOrThrow({ where: { id: beforeInvocation.id } })).toEqual(beforeInvocation);
			expect(await _Second.mcpRuntimeExecution.findUniqueOrThrow({ where: { id: registered.executionId } })).toEqual(beforeExecution);
		}
		const audits = await _Second.auditDecision.findMany({ where: { siloId: f.siloId, actorKind: "Workload", workloadKind: "Job" } });
		expect(audits.length).toBeGreaterThan(0);
		for (const audit of audits)
			expect(audit).toMatchObject({ actorId: registered.identity.podUid, audience: MCP_EXECUTOR_PROJECTED_TOKEN_AUDIENCE, namespace: registered.identity.namespace, serviceAccountName: registered.identity.serviceAccountName, workloadUid: registered.workloadUid, podUid: registered.identity.podUid, runId: f.runId, attempt: 1, agentServiceId: f.turn.binding.agentServiceId, agentRevisionId: f.subject.runScope.agentRevisionId });
	});

	it.each([
		{ name: "original run", seed: {}, lease: 300_000, delay: false },
		{ name: "current lease", seed: { currentLeaseLifetimeMs: 120_000 }, lease: 300_000, delay: false },
		{ name: "frozen membership", seed: { trustLifetimeMs: 60_000 }, lease: 300_000, delay: false },
		{ name: "current membership", seed: { currentMembershipLifetimeMs: 45_000 }, lease: 300_000, delay: false },
		{ name: "configured duration", seed: {}, lease: 30_000, delay: false },
		{ name: "delayed executor write", seed: {}, lease: 30_000, delay: true },
	])("keeps invocation, executor and returned expiry equal under $name", async function _ExactDeadline({ seed, lease, delay })
	{
		const f = await _SeedConversationToolProposalSqlFixture(seed);
		await _Owner(_First, f).admit(f.turn, f.candidate, f.proposal, _WORKLOAD);
		let claimClock = 0;
		const client = _First.$extends({ query: {
			mcpRuntimeClock: { async findUnique({ args, query }) { const clock = await query(args); claimClock = (clock!.now as unknown as Date).getTime(); return clock; } },
			mcpRuntimeExecution: { async updateManyAndReturn({ args, query })
			{
				if (delay && args.data.commandState === "Claimed")
					await new Promise(resolve => setTimeout(resolve, 25));
				return query(args);
			} },
		} }) as unknown as PrismaClient;
		const runtime = _Runtime(client, f, lease);
		const registered = (await runtime.register())!;
		const command = await runtime.authority.claimCompanion(registered.identity, registered.executionReference);
		if (command === null || typeof command === "string")
			throw new Error("Expected a command within its original deadline");
		const invocation = await _Second.toolInvocation.findFirstOrThrow({ where: { runId: f.runId } });
		const execution = await _Second.mcpRuntimeExecution.findUniqueOrThrow({ where: { id: registered.executionId } });
		expect(runtime.observed.notAfter).not.toBeNull();
		const frozenLimit = Math.min(f.candidate.compiledInput.budget.wallClockDeadlineEpochMs!, Date.parse(f.leaseExpiresAt), Date.parse(f.subject.membership.trustedUntil));
		if (seed.currentMembershipLifetimeMs === undefined)
			expect(runtime.observed.notAfter).toBe(frozenLimit);
		else
			expect(runtime.observed.notAfter).toBeLessThan(frozenLimit);
		const expected = Math.min(claimClock + lease, runtime.observed.notAfter!);
		expect(invocation.claimExpiresAt?.getTime()).toBe(expected);
		expect(execution.companionClaimExpiresAt?.getTime()).toBe(expected);
		expect(Date.parse(command.expiresAt)).toBe(expected);
		expect(execution.toolInvocationClaimFence).toBe(invocation.claimFence);
		expect(execution.toolInvocationClaimRevision).toBe(invocation.revision);
	});

	it.each(["toolInvocationClaimFence", "toolInvocationClaimRevision"] as const)("rolls back the real IAM claim when the executor changes %s", async function _WrongPairedClaim(field)
	{
		const f = await _SeedConversationToolProposalSqlFixture();
		await _Owner(_First, f).admit(f.turn, f.candidate, f.proposal, _WORKLOAD);
		const client = _First.$extends({ query: { mcpRuntimeExecution: { async updateManyAndReturn({ args, query })
		{
			if (args.data.commandState === "Claimed")
				args.data[field] = Number(args.data[field]) + 1;
			return query(args);
		} } } }) as unknown as PrismaClient;
		const runtime = _Runtime(client, f);
		const registered = (await runtime.register())!;
		const invocation = await _Second.toolInvocation.findFirstOrThrow({ where: { runId: f.runId } });
		const execution = await _Second.mcpRuntimeExecution.findUniqueOrThrow({ where: { id: registered.executionId } });
		const auditsBefore = await _Second.auditDecision.count({ where: { siloId: f.siloId } });
		await expect(runtime.authority.claimCompanion(registered.identity, registered.executionReference)).rejects.toThrow("requires the exact run-owned invocation fence");
		expect(await _Second.toolInvocation.findUniqueOrThrow({ where: { id: invocation.id } })).toEqual(invocation);
		expect(await _Second.mcpRuntimeExecution.findUniqueOrThrow({ where: { id: execution.id } })).toEqual(execution);
		expect(await _Second.auditDecision.count({ where: { siloId: f.siloId } })).toBe(auditsBefore);
	});

	it("records a known denial before dispatch when the original deadline has elapsed", async function _ExpiredBeforeClaim()
	{
		const f = await _SeedConversationToolProposalSqlFixture({ runLifetimeMs: 4_000 });
		await _Owner(_First, f).admit(f.turn, f.candidate, f.proposal, _WORKLOAD);
		const runtime = _Runtime(_First, f);
		const registered = (await runtime.register())!;
		await _WaitPastSqlDeadline(_Second, f.candidate.compiledInput.budget.wallClockDeadlineEpochMs!);
		expect(await runtime.authority.claimCompanion(registered.identity, registered.executionReference)).toBe("terminal");
		const invocation = await _Second.toolInvocation.findFirstOrThrow({ where: { runId: f.runId } });
		expect(invocation).toMatchObject({ state: "Failed", claimAttempt: 0, claimFence: 0, claimExpiresAt: null });
		expect(await _Second.mcpRuntimeExecution.findUniqueOrThrow({ where: { id: registered.executionId } })).toMatchObject({ commandState: "Failed", workloadState: "Closed", companionClaimFence: null, companionClaimExpiresAt: null });
		expect(await _Second.toolResultDelivery.count({ where: { toolInvocationId: invocation.id, state: "Pending" } })).toBe(1);
	}, 15_000);

	it("rolls back both claims when authority expires between the IAM and executor writes", async function _ExpiredDuringClaim()
	{
		const f = await _SeedConversationToolProposalSqlFixture({ runLifetimeMs: 4_000 });
		await _Owner(_First, f).admit(f.turn, f.candidate, f.proposal, _WORKLOAD);
		const client = _First.$extends({ query: { mcpRuntimeExecution: { async updateManyAndReturn({ args, query })
		{
			if (args.data.commandState === "Claimed")
				await _WaitPastSqlDeadline(_Second, f.candidate.compiledInput.budget.wallClockDeadlineEpochMs!);
			return query(args);
		} } } }) as unknown as PrismaClient;
		const runtime = _Runtime(client, f);
		const registered = (await runtime.register())!;
		const invocation = await _Second.toolInvocation.findFirstOrThrow({ where: { runId: f.runId } });
		const execution = await _Second.mcpRuntimeExecution.findUniqueOrThrow({ where: { id: registered.executionId } });
		const auditsBefore = await _Second.auditDecision.count({ where: { siloId: f.siloId } });
		await expect(runtime.authority.claimCompanion(registered.identity, registered.executionReference)).rejects.toThrow("cannot outlive its run authority");
		expect(await _Second.toolInvocation.findUniqueOrThrow({ where: { id: invocation.id } })).toEqual(invocation);
		expect(await _Second.mcpRuntimeExecution.findUniqueOrThrow({ where: { id: execution.id } })).toEqual(execution);
		expect(await _Second.auditDecision.count({ where: { siloId: f.siloId } })).toBe(auditsBefore);
	}, 15_000);

});
