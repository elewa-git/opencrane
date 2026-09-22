import { McpExecutionTransport, McpExecutorCommandState, PrismaClient, ToolInvocationState } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MCP_SERVER_PROJECTED_TOKEN_AUDIENCE } from "@opencrane/contracts";
import { PrismaConversationToolProposalUnitOfWork } from "@opencrane/backend/server/conversations";
import { McpInvocationOwnerKinds, PrismaRemoteMcpDispatchUnitOfWork, type McpInvocationResultParticipantFactory } from "@opencrane/backend/server/gateways/mcp";

import { _ToolHandoffSqlRuntime, _WaitPastSqlDeadline } from "./conversation-tool-handoff.sql-fixture";
import { _SeedConversationToolProposalSqlFixture } from "./conversation-tool-proposal.sql-fixture";

/** Independent clients expose committed state after a failed claim transaction. */
const _First = new PrismaClient();
const _Second = new PrismaClient();
/** The proposal port has already verified this conversation-computer workload. */
const _COMPUTER = { audience: "opencrane-conversation-computer", namespace: "computers", serviceAccountName: "computer", workloadKind: "pod", workloadUid: "computer-pod-1", podUid: "computer-pod-1" } as const;
/** Remote dispatch uses the verified server workload, never an OCI executor identity. */
const _SERVER = { audience: MCP_SERVER_PROJECTED_TOKEN_AUDIENCE, namespace: "opencrane", serviceAccountName: "opencrane-server", workloadKind: "pod", workloadUid: "server-pod-1", podUid: "server-pod-1" } as const;
/** Claim-only proofs must not consume or persist a provider result. */
const _RESULTS: McpInvocationResultParticipantFactory = { __ForTransaction: function _Results()
{
	return { async prepare(): Promise<never> { throw new Error("remote run claim proof attempted result capture"); } };
} };

/** Admit a real run-owned invocation through the application proposal transaction. */
async function _Admit(fixture: Awaited<ReturnType<typeof _SeedConversationToolProposalSqlFixture>>)
{
	const runtime = _ToolHandoffSqlRuntime(_First, fixture);
	const owner = new PrismaConversationToolProposalUnitOfWork(_First, fixture.dependencies, runtime.admission, async function _ApprovalExpiry() {});
	const receipt = await owner.admit(fixture.turn, fixture.candidate, fixture.proposal, _COMPUTER);
	return { ownerKind: McpInvocationOwnerKinds.Run, siloId: fixture.siloId, runId: fixture.runId, attempt: 1, toolInvocationId: receipt.proposalId } as const;
}

/** Reuse the real run admission participant without executing any OCI controller step. */
function _Remote(client: PrismaClient, fixture: Awaited<ReturnType<typeof _SeedConversationToolProposalSqlFixture>>)
{
	const runtime = _ToolHandoffSqlRuntime(client, fixture);
	return { authority: new PrismaRemoteMcpDispatchUnitOfWork(client, runtime.participants, _RESULTS, 30_000), observed: runtime.observed };
}

describe("run-owned RemoteHttp claims on fresh PostgreSQL", function _Suite()
{
	beforeAll(async function _Connect()
	{
		if (!process.env.DATABASE_URL)
			throw new Error("The remote run SQL proof requires DATABASE_URL and the fresh target baseline");
		await Promise.all([_First.$connect(), _Second.$connect()]);
	});

	afterAll(async function _Disconnect() { await Promise.all([_First.$disconnect(), _Second.$disconnect()]); });

	it.each([
		{ name: "original run", seed: { runLifetimeMs: 30_000 } },
		{ name: "current computer lease", seed: { currentLeaseLifetimeMs: 20_000 } },
	])("caps both saved claims and the returned deadline at the $name authority", async function _CappedRunClaim({ seed })
	{
		const fixture = await _SeedConversationToolProposalSqlFixture({ ...seed, transport: McpExecutionTransport.RemoteHttp });
		const target = await _Admit(fixture);
		const runtime = _Remote(_First, fixture);
		const result = await runtime.authority.claim({ target, workload: _SERVER });
		expect(result.outcome).toBe("claimed");
		if (result.claim === undefined)
			throw new Error("Expected a remote claim within the run authority");
		const invocation = await _Second.toolInvocation.findFirstOrThrow({ where: { runId: fixture.runId } });
		const execution = await _Second.mcpRuntimeExecution.findUniqueOrThrow({ where: { toolInvocationId: invocation.id } });
		const expected = Math.min(fixture.candidate.compiledInput.budget.wallClockDeadlineEpochMs!, Date.parse(fixture.leaseExpiresAt), Date.parse(fixture.subject.membership.trustedUntil));
		expect(runtime.observed.notAfter).toBe(expected);
		expect(invocation).toMatchObject({ runId: fixture.runId, attempt: 1, mcpTaskId: null, state: ToolInvocationState.Claimed });
		expect(invocation.claimExpiresAt?.getTime()).toBe(expected);
		expect(execution.remoteClaimExpiresAt?.getTime()).toBe(expected);
		expect(result.claim.notAfterEpochMs).toBe(expected);
		expect(execution).toMatchObject({ transport: McpExecutionTransport.RemoteHttp, commandState: McpExecutorCommandState.Claimed, workloadState: null, profileName: null, workloadUid: null, podUid: null, companionClaimFence: null, companionClaimExpiresAt: null, toolInvocationClaimFence: invocation.claimFence, toolInvocationClaimRevision: invocation.revision });
		await expect(_Remote(_Second, fixture).authority.claim({ target, workload: _SERVER })).resolves.toEqual({ outcome: "unavailable" });
		const audits = await _Second.auditDecision.findMany({ where: { siloId: fixture.siloId, actorId: _SERVER.podUid, runId: fixture.runId } });
		expect(audits.length).toBeGreaterThan(0);
		for (const audit of audits)
			expect(audit).toMatchObject({ audience: _SERVER.audience, namespace: _SERVER.namespace, serviceAccountName: _SERVER.serviceAccountName, workloadKind: "Pod", workloadUid: _SERVER.workloadUid, podUid: _SERVER.podUid, runId: fixture.runId, attempt: 1 });
	});

	it("rolls back both claims and audits when run authority ends between the IAM and remote writes", async function _ExpiredDuringRunClaim()
	{
		const fixture = await _SeedConversationToolProposalSqlFixture({ transport: McpExecutionTransport.RemoteHttp, runLifetimeMs: 4_000 });
		const target = await _Admit(fixture);
		const beforeInvocation = await _Second.toolInvocation.findFirstOrThrow({ where: { runId: fixture.runId } });
		const beforeExecution = await _Second.mcpRuntimeExecution.findUniqueOrThrow({ where: { toolInvocationId: beforeInvocation.id } });
		const auditsBefore = await _Second.auditDecision.count({ where: { siloId: fixture.siloId } });
		let delayed = false;
		const client = _First.$extends({ query: { mcpRuntimeExecution: { async updateMany({ args, query })
		{
			if (args.data.commandState === McpExecutorCommandState.Claimed)
			{
				delayed = true;
				await _WaitPastSqlDeadline(_Second, fixture.candidate.compiledInput.budget.wallClockDeadlineEpochMs!);
			}
			return query(args);
		} } } }) as unknown as PrismaClient;
		await expect(_Remote(client, fixture).authority.claim({ target, workload: _SERVER })).rejects.toThrow("Remote McpRuntimeExecution claim requires the exact invocation dispatch fence and a bounded lease proposal");
		expect(delayed).toBe(true);
		expect(await _Second.toolInvocation.findUniqueOrThrow({ where: { id: beforeInvocation.id } })).toEqual(beforeInvocation);
		expect(await _Second.mcpRuntimeExecution.findUniqueOrThrow({ where: { id: beforeExecution.id } })).toEqual(beforeExecution);
		expect(await _Second.auditDecision.count({ where: { siloId: fixture.siloId } })).toBe(auditsBefore);
	}, 15_000);
});
