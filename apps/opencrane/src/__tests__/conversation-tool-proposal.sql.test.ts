import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ConversationToolProposalOutcomes } from "@opencrane/contracts";
import { PrismaConversationToolProposalUnitOfWork } from "@opencrane/backend/server/conversations";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { _SeedConversationToolProposalSqlFixture } from "./conversation-tool-proposal.sql-fixture";

/** Represents an identity already verified by this admission port's transport owner. */
const _WORKLOAD = { audience: "opencrane-conversation-computer", namespace: "computers", serviceAccountName: "computer", workloadKind: "pod", workloadUid: "computer-pod-1", podUid: "computer-pod-1" } as const;

/** Independent connections expose actual uniqueness and Serializable rollback behavior. */
const _First = new PrismaClient();
/** The second server never shares transaction or process-local admission state with the first. */
const _Second = new PrismaClient();

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
	afterAll(async function _Disconnect() { await Promise.all([_First.$disconnect(), _Second.$disconnect()]); });

	it("converges concurrent identical proposals to one immutable invocation", async function _SameProposal()
	{
		const f = await _SeedConversationToolProposalSqlFixture();
		for (const client of [_First, _Second])
			expect(await client.agentRun.count({ where: { id: f.runId } })).toBe(1);
		const owners = _ConcurrentClients().map(client => new PrismaConversationToolProposalUnitOfWork(client, f.dependencies));
		const receipts = await Promise.all(owners.map(owner => owner.admit(f.turn, f.candidate, f.proposal, _WORKLOAD)));
		expect(new Set(receipts.map(receipt => receipt.proposalId)).size).toBe(1);
		expect(receipts.map(receipt => receipt.outcome).sort()).toEqual([ConversationToolProposalOutcomes.Existing, ConversationToolProposalOutcomes.Recorded].sort());
		const rows = await _Second.toolInvocation.findMany({ where: { runId: f.runId } });
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ state: "Preparing", attempt: 1, authorizationActorKind: "Workload", authorizationExecutionSubject: f.subject, arguments: f.proposal.arguments, effectiveArguments: f.proposal.arguments, toolInvocationId: receipts[0].proposalId });
		expect(rows[0].argumentsDigest).toBe(___DigestCanonicalJson(f.proposal.arguments));
		const audits = await _Second.auditDecision.findMany({ where: { siloId: f.siloId, actorKind: "Workload" } });
		expect(audits.length).toBeGreaterThanOrEqual(2);
		await expect(_Second.auditDecision.create({ data: { ...audits[0], id: `${f.siloId}-incomplete-audit`, decisionDigest: ___DigestCanonicalJson({ siloId: f.siloId, proof: "missing-workload-audience" }), audience: null } })).rejects.toThrow("audit_decisions_workload_identity_check");
		for (const audit of audits)
			expect(audit).toMatchObject({ actorId: _WORKLOAD.podUid, audience: _WORKLOAD.audience, namespace: _WORKLOAD.namespace, serviceAccountName: _WORKLOAD.serviceAccountName, workloadKind: "Pod", workloadUid: _WORKLOAD.workloadUid, podUid: _WORKLOAD.podUid, runId: f.runId, attempt: 1, agentServiceId: f.turn.binding.agentServiceId, agentRevisionId: f.subject.runScope.agentRevisionId });
		expect(await _Second.mcpRuntimeExecution.count({ where: { siloId: f.siloId } })).toBe(0);
		const restarted = new PrismaConversationToolProposalUnitOfWork(_Second, f.dependencies);
		expect(await restarted.admit(f.turn, f.candidate, f.proposal, _WORKLOAD)).toEqual({ proposalId: receipts[0].proposalId, outcome: ConversationToolProposalOutcomes.Existing });
	});

	it("lets only one of two different argument bodies own the single slot", async function _ChangedBodyRace()
	{
		const f = await _SeedConversationToolProposalSqlFixture();
		const owners = _ConcurrentClients().map(client => new PrismaConversationToolProposalUnitOfWork(client, f.dependencies));
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
		const owner = new PrismaConversationToolProposalUnitOfWork(client as unknown as PrismaClient, dependencies);
		const auditsBefore = await _Second.auditDecision.count({ where: { siloId: f.siloId } });
		await expect(owner.admit(f.turn, f.candidate, f.proposal, _WORKLOAD)).rejects.toThrow("conversation_tool_proposal_denied");
		expect(created).toBe(1);
		expect(await _Second.toolInvocation.count({ where: { runId: f.runId } })).toBe(0);
		expect(await _Second.auditDecision.count({ where: { siloId: f.siloId } })).toBe(auditsBefore);
	});

	it("refuses a revoked grant without recreating or changing the saved proposal", async function _CurrentRevocation()
	{
		const f = await _SeedConversationToolProposalSqlFixture();
		const owner = new PrismaConversationToolProposalUnitOfWork(_First, f.dependencies);
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
		await new PrismaConversationToolProposalUnitOfWork(_First, f.dependencies).admit(f.turn, f.candidate, f.proposal, _WORKLOAD);
		const row = await _Second.toolInvocation.findFirstOrThrow({ where: { runId: f.runId } });
		expect(row.authorizationEvidenceDigest).toBe(___DigestCanonicalJson({ actorKind: "workload", executionSubject: row.authorizationExecutionSubject, coordinates: row.authorizationCoordinates, decisionDigests: row.authorizationDecisionDigests, agentRevisionId: row.agentRevisionId, runId: row.runId, attempt: row.attempt, argumentsDigest: row.argumentsDigest, assignmentDigest: row.authorizationAssignmentDigest } as JsonValue));
		await expect(_Second.toolInvocation.update({ where: { id: row.id }, data: { arguments: { query: "changed after admission" } } })).rejects.toThrow();
		expect((await _Second.toolInvocation.findUniqueOrThrow({ where: { id: row.id } })).arguments).toEqual(f.proposal.arguments);
	});
});
