import { McpExecutionTransport, McpExecutorCommandState, McpRuntimeExecutionKind } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

const _authorization = vi.hoisted(function _Authorization()
{
	return { admitPrincipal: vi.fn() };
});

vi.mock("@opencrane/backend/server/iam/authorization", async function _MockAuthorization()
{
	const actual = await vi.importActual("@opencrane/backend/server/iam/authorization");
	return {
		...actual,
		PrismaAuthorizationAuthority: class _PrismaAuthorizationAuthority
		{
			admitPrincipal(command: unknown) { return _authorization.admitPrincipal(command); }
		},
	};
});

import { MCP_PROTOCOL_VERSION, type McpToolCallResult } from "@opencrane/contracts";
import { ExternalActionClaimKinds, ToolInvocationClaimOutcomes, ToolInvocationCompletionOutcomes, ToolInvocationStates } from "@opencrane/backend/server/iam/authorization";
import { ___DigestCanonicalJson } from "@opencrane/util";

import { __McpConnectionEndpointDigest } from "../../connections/mcp-connection-digests";
import { _RemoteClaimUpdate, PrismaRemoteMcpDispatchRepository } from "../prisma-remote-mcp-dispatch-repository";
import { McpInvocationOwnerKinds, RemoteMcpDispatchClaimOutcomes, type RemoteMcpDispatchClaim } from "../remote-mcp-invocation.types";

const _TARGET = { ownerKind: McpInvocationOwnerKinds.Run, siloId: "silo-1", runId: "run-1", attempt: 2, toolInvocationId: "public-call-1" } as const;
const _CLAIM = {
	executionId: "execution-1",
	notAfterEpochMs: new Date("2099-01-01T00:00:00.000Z").getTime(),
	remainingClaimMilliseconds: 30_000,
	remoteClaimFence: "remote-fence-1",
	toolInvocationClaim: { invocationId: "invocation-row-1", kind: ExternalActionClaimKinds.Dispatch, fence: 3, revision: 4 },
	binding: {
		siloId: "silo-1", connectionId: "connection-1", connectionGeneration: 2, connectionOwnerPrincipalId: "principal-1", endpointDigest: `sha256:${"a".repeat(64)}`,
		serverRevisionId: "server-revision-1", mcpServerId: "server-1", toolRevisionId: "tool-revision-1", protocolVersion: MCP_PROTOCOL_VERSION,
		credentialSecretUid: null, credentialSecretResourceVersion: null,
	},
	endpoint: "https://mcp.example.test/rpc",
	toolName: "records.read",
	arguments: { query: "active" },
	inputSchema: { type: "object" },
} as const satisfies RemoteMcpDispatchClaim;
const _RAW_RESULT: McpToolCallResult = { isError: false, content: [{ type: "text", text: "provider result" }] };
const _PREPARED_RESULT: McpToolCallResult = { isError: false, content: [{ type: "text", text: "terminal-safe result" }] };

/** Return an observable result participant for repository construction. */
function _Results(result: McpToolCallResult = _PREPARED_RESULT)
{
	return { prepare: vi.fn().mockResolvedValue(result) };
}

/** Return the fields needed before remote dispatch reaches authority or provider input. */
function _Execution(transport: McpExecutionTransport)
{
	return { id: "execution-1", transport, kind: McpRuntimeExecutionKind.Invocation, commandState: McpExecutorCommandState.Pending };
}

describe("Prisma remote MCP dispatch repository", function _Suite()
{
	it("locks the active connection before it claims the ToolInvocation", async function _LocksInSharedOrder()
	{
		const endpoint = "https://mcp.example.test/rpc";
		const endpointDigest = __McpConnectionEndpointDigest(endpoint);
		const events: string[] = [];
		const execution = {
			id: "execution-1", siloId: "silo-1", kind: McpRuntimeExecutionKind.Invocation, transport: McpExecutionTransport.RemoteHttp,
			serverRevisionId: "revision-1", connectionId: "connection-1", connectionGeneration: 2, connectionOwnerPrincipalId: "principal-1", endpointDigest,
			credentialSecretUid: null, credentialSecretResourceVersion: null, commandState: McpExecutorCommandState.Pending, remoteClaimFence: null, remoteClaimExpiresAt: null,
			toolInvocationClaimFence: null, toolInvocationClaimRevision: null, toolInvocationId: "invocation-row-1", toolInvocation: { toolRevisionId: "tool-1" },
			serverRevision: { transport: McpExecutionTransport.RemoteHttp, connectionId: "connection-1", connectionGeneration: 2, connectionOwnerPrincipalId: "principal-1", endpointDigest, protocolVersion: MCP_PROTOCOL_VERSION, state: "Ready", server: { id: "server-1", endpoint, status: "Active", approvalStatus: "Published" }, tools: [{ id: "tool-1", siloId: "silo-1", name: "search", inputSchema: { type: "object" } }] },
		};
		const invocation = { id: "invocation-row-1", siloId: "silo-1", mcpTaskId: null, toolRevisionId: "tool-1", effectiveArguments: { query: "status" }, effectiveArgumentsDigest: `sha256:${"a".repeat(64)}`, revision: 4 };
		const transaction = {
			mcpRuntimeExecution: {
				findFirst: vi.fn()
					.mockResolvedValueOnce(execution)
					.mockResolvedValueOnce({ remoteClaimExpiresAt: new Date("2026-09-12T10:00:30.000Z") }),
				updateMany: vi.fn().mockResolvedValue({ count: 1 }),
			},
			mcpRuntimeClock: {
				findUnique: vi.fn()
					.mockResolvedValueOnce({ now: new Date("2026-09-12T10:00:00.000Z") })
					.mockResolvedValueOnce({ now: new Date("2026-09-12T10:00:00.005Z") }),
			},
		};
		const toolClaim = { invocationId: "invocation-row-1", kind: ExternalActionClaimKinds.Dispatch, fence: 3, revision: 5 } as const;
		const claimedInvocation = { ...invocation, state: ToolInvocationStates.Claimed, claimExpiresAt: new Date("2026-09-12T10:00:25.000Z") };
		const participant = { findById: vi.fn().mockResolvedValue(invocation), claim: vi.fn().mockImplementation(function _Claim() { events.push("tool-invocation"); return Promise.resolve({ outcome: ToolInvocationClaimOutcomes.Claimed, claim: toolClaim, invocation: claimedInvocation }); }) };
		const readiness = { isReady: vi.fn(), lockForDispatch: vi.fn().mockImplementation(function _Lock() { events.push("connection"); return Promise.resolve(true); }) };
		_authorization.admitPrincipal.mockResolvedValue({ outcome: "allow", evidence: { decisionDigest: `sha256:${"b".repeat(64)}` } });
		const repository = new PrismaRemoteMcpDispatchRepository(transaction as never, participant as never, readiness, _Results(), 30_000);

		await expect(repository.claim(_TARGET, { podUid: "pod-1" } as never)).resolves.toEqual(expect.objectContaining({
			outcome: RemoteMcpDispatchClaimOutcomes.Claimed,
			claim: expect.objectContaining({ notAfterEpochMs: new Date("2026-09-12T10:00:25.000Z").getTime(), remainingClaimMilliseconds: 24_995 }),
		}));

		expect(events).toEqual(["connection", "tool-invocation"]);
		expect(transaction.mcpRuntimeExecution.findFirst).toHaveBeenNthCalledWith(2, expect.objectContaining({ where: expect.objectContaining({ remoteClaimFence: expect.any(String), toolInvocationClaimFence: 3, toolInvocationClaimRevision: 5 }), select: { remoteClaimExpiresAt: true } }));
	});

	it("proposes only remote lease fields for the database-owned claim clock", function _ProposesRemoteLease()
	{
		const claim = { invocationId: "invocation-row-1", kind: ExternalActionClaimKinds.Dispatch, fence: 3, revision: 4 } as const;

		const update = _RemoteClaimUpdate("remote-fence-1", 30_000, claim);

		expect(update).toEqual({ commandState: McpExecutorCommandState.Claimed, remoteClaimFence: "remote-fence-1", remoteClaimExpiresAt: new Date(30_000), toolInvocationClaimFence: 3, toolInvocationClaimRevision: 4 });
		expect(update).not.toHaveProperty("claimedAt");
	});

	it("selects OCI without requiring server workload identity", async function _SelectsOci()
	{
		const transaction = { mcpRuntimeExecution: { findFirst: vi.fn().mockResolvedValue(_Execution(McpExecutionTransport.OciImage)) } };
		const participant = { findById: vi.fn() };
		const readiness = { isReady: vi.fn(), lockForDispatch: vi.fn() };
		const repository = new PrismaRemoteMcpDispatchRepository(transaction as never, participant as never, readiness, _Results(), 30_000);

		await expect(repository.claim(_TARGET)).resolves.toEqual({ outcome: RemoteMcpDispatchClaimOutcomes.NotRemote });
		expect(transaction.mcpRuntimeExecution.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ toolInvocation: { is: { siloId: "silo-1", runId: "run-1", attempt: 2, toolInvocationId: "public-call-1", mcpTaskId: null } } }) }));

		expect(participant.findById).not.toHaveBeenCalled();
	});

	it("requests verified server identity before reading a remote invocation", async function _RequiresIdentity()
	{
		const transaction = { mcpRuntimeExecution: { findFirst: vi.fn().mockResolvedValue(_Execution(McpExecutionTransport.RemoteHttp)) } };
		const participant = { findById: vi.fn() };
		const readiness = { isReady: vi.fn(), lockForDispatch: vi.fn() };
		const repository = new PrismaRemoteMcpDispatchRepository(transaction as never, participant as never, readiness, _Results(), 30_000);

		await expect(repository.claim(_TARGET)).resolves.toEqual({ outcome: RemoteMcpDispatchClaimOutcomes.IdentityRequired });

		expect(participant.findById).not.toHaveBeenCalled();
	});

	it("does not recover a previous process while its remote lease is live", async function _PreservesLiveClaim()
	{
		const execution = { ..._Execution(McpExecutionTransport.RemoteHttp), commandState: McpExecutorCommandState.Claimed, remoteClaimFence: "remote-fence-1", remoteClaimExpiresAt: new Date("2026-09-12T10:00:30.000Z"), toolInvocationClaimFence: 3, toolInvocationClaimRevision: 4, toolInvocationId: "invocation-row-1" };
		const transaction = { mcpRuntimeExecution: { findFirst: vi.fn().mockResolvedValue(execution) }, mcpRuntimeClock: { findUnique: vi.fn().mockResolvedValue({ now: new Date("2026-09-12T10:00:00.000Z") }) } };
		const participant = { completeAmbiguous: vi.fn() };
		const readiness = { isReady: vi.fn(), lockForDispatch: vi.fn() };
		const repository = new PrismaRemoteMcpDispatchRepository(transaction as never, participant as never, readiness, _Results(), 30_000);

		await expect(repository.claim(_TARGET)).resolves.toEqual({ outcome: RemoteMcpDispatchClaimOutcomes.Unavailable });

		expect(participant.completeAmbiguous).not.toHaveBeenCalled();
	});

	it("throws after success changes the ToolInvocation but loses the runtime fence", async function _RollsBackLostSuccessFence()
	{
		const transaction = {
			mcpRuntimeClock: { findUnique: vi.fn().mockResolvedValueOnce({ now: new Date("2026-09-12T10:00:00.000Z") }).mockResolvedValueOnce({ now: new Date("2026-09-12T10:00:00.050Z") }) },
			mcpRuntimeExecution: { findFirst: vi.fn().mockResolvedValue({ remoteClaimExpiresAt: new Date("2099-01-01T00:00:00.000Z") }), updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
			mcpToolRevision: { findFirst: vi.fn().mockResolvedValue({ name: "records.read" }) },
		};
		const participant = {
			findById: vi.fn().mockResolvedValue({ id: "invocation-row-1", siloId: "silo-1", state: ToolInvocationStates.Claimed, claimKind: ExternalActionClaimKinds.Dispatch, claimFence: 3, revision: 4, claimExpiresAt: new Date("2099-01-01T00:00:00.000Z"), toolRevisionId: "tool-revision-1" }),
			completeSucceeded: vi.fn().mockResolvedValue({ outcome: ToolInvocationCompletionOutcomes.Completed }),
		};
		const readiness = { isReady: vi.fn(), lockForDispatch: vi.fn() };
		const results = _Results();
		const repository = new PrismaRemoteMcpDispatchRepository(transaction as never, participant as never, readiness, results, 30_000);

		await expect(repository.completeSucceeded(_CLAIM, _RAW_RESULT)).rejects.toThrow("remote MCP success lost its runtime transition");

		expect(results.prepare).toHaveBeenCalledWith(expect.objectContaining({ remoteClaimFence: "remote-fence-1", result: _RAW_RESULT, toolName: "records.read" }));
		expect(participant.completeSucceeded).toHaveBeenCalledWith(_CLAIM.toolInvocationClaim, _PREPARED_RESULT, expect.any(Date));
		expect(transaction.mcpRuntimeExecution.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ completedAt: new Date("2026-09-12T10:00:00.050Z"), terminalPayloadDigest: ___DigestCanonicalJson(_PREPARED_RESULT as never) }) }));
	});

	it("does not write either terminal projection when the remote result participant rejects", async function _RollsBackParticipantFailure()
	{
		const transaction = { mcpRuntimeClock: { findUnique: vi.fn().mockResolvedValue({ now: new Date("2026-09-12T10:00:00.000Z") }) }, mcpRuntimeExecution: { findFirst: vi.fn().mockResolvedValue({ remoteClaimExpiresAt: new Date("2099-01-01T00:00:00.000Z") }), updateMany: vi.fn() }, mcpToolRevision: { findFirst: vi.fn().mockResolvedValue({ name: "records.read" }) } };
		const participant = { findById: vi.fn().mockResolvedValue({ id: "invocation-row-1", siloId: "silo-1", state: ToolInvocationStates.Claimed, claimKind: ExternalActionClaimKinds.Dispatch, claimFence: 3, revision: 4, claimExpiresAt: new Date("2099-01-01T00:00:00.000Z"), toolRevisionId: "tool-revision-1" }), completeSucceeded: vi.fn() };
		const readiness = { isReady: vi.fn(), lockForDispatch: vi.fn() };
		const results = _Results();
		results.prepare.mockRejectedValue(new Error("remote resource rejected"));
		const repository = new PrismaRemoteMcpDispatchRepository(transaction as never, participant as never, readiness, results, 30_000);

		await expect(repository.completeSucceeded(_CLAIM, _RAW_RESULT)).rejects.toThrow("remote resource rejected");

		expect(participant.completeSucceeded).not.toHaveBeenCalled();
		expect(transaction.mcpRuntimeExecution.updateMany).not.toHaveBeenCalled();
	});

	it("refuses a stale remote runtime fence before result handling", async function _RejectsStaleRemoteFence()
	{
		const transaction = { mcpRuntimeClock: { findUnique: vi.fn().mockResolvedValue({ now: new Date("2026-09-12T10:00:00.000Z") }) }, mcpRuntimeExecution: { findFirst: vi.fn().mockResolvedValue(null), updateMany: vi.fn() }, mcpToolRevision: { findFirst: vi.fn() } };
		const participant = { findById: vi.fn(), completeSucceeded: vi.fn() };
		const readiness = { isReady: vi.fn(), lockForDispatch: vi.fn() };
		const results = _Results();
		const repository = new PrismaRemoteMcpDispatchRepository(transaction as never, participant as never, readiness, results, 30_000);

		await expect(repository.completeSucceeded(_CLAIM, _RAW_RESULT)).resolves.toBe(false);

		expect(results.prepare).not.toHaveBeenCalled();
		expect(participant.findById).not.toHaveBeenCalled();
		expect(participant.completeSucceeded).not.toHaveBeenCalled();
		expect(transaction.mcpRuntimeExecution.updateMany).not.toHaveBeenCalled();
	});

	it("throws after recovery changes the ToolInvocation but loses the runtime fence", async function _RollsBackLostRecoveryFence()
	{
		const execution = { ..._Execution(McpExecutionTransport.RemoteHttp), commandState: McpExecutorCommandState.Claimed, remoteClaimFence: "remote-fence-1", remoteClaimExpiresAt: new Date("2026-09-12T09:59:30.000Z"), toolInvocationClaimFence: 3, toolInvocationClaimRevision: 4, toolInvocationId: "invocation-row-1" };
		const transaction = { mcpRuntimeExecution: { findFirst: vi.fn().mockResolvedValue(execution), updateMany: vi.fn().mockResolvedValue({ count: 0 }) }, mcpRuntimeClock: { findUnique: vi.fn().mockResolvedValue({ now: new Date("2026-09-12T10:00:00.000Z") }) } };
		const participant = { completeAmbiguous: vi.fn().mockResolvedValue({ state: ToolInvocationStates.RecoveryRequired }) };
		const readiness = { isReady: vi.fn(), lockForDispatch: vi.fn() };
		const repository = new PrismaRemoteMcpDispatchRepository(transaction as never, participant as never, readiness, _Results(), 30_000);

		await expect(repository.claim(_TARGET)).rejects.toThrow("interrupted remote MCP claim lost its runtime transition");
	});

	it("fails unused remote work when its workflow exhausts", async function _ExhaustsUnusedWork()
	{
		const execution = { ..._Execution(McpExecutionTransport.RemoteHttp), toolInvocationId: "invocation-row-1", remoteClaimFence: null, remoteClaimExpiresAt: null };
		const transaction = { mcpRuntimeExecution: { findFirst: vi.fn().mockResolvedValue(execution), updateMany: vi.fn().mockResolvedValue({ count: 1 }) }, mcpRuntimeClock: { findUnique: vi.fn().mockResolvedValue({ now: new Date("2026-09-12T10:00:00.000Z") }) } };
		const invocation = { id: "invocation-row-1", revision: 4, state: ToolInvocationStates.Ready };
		const participant = { findById: vi.fn().mockResolvedValue(invocation), completeUnusedBeforeDispatch: vi.fn().mockResolvedValue({ changed: true, invocation: { ...invocation, state: ToolInvocationStates.Failed } }) };
		const readiness = { isReady: vi.fn(), lockForDispatch: vi.fn() };
		const repository = new PrismaRemoteMcpDispatchRepository(transaction as never, participant as never, readiness, _Results(), 30_000);

		await expect(repository.settleExhausted(_TARGET)).resolves.toBe(true);

		expect(participant.completeUnusedBeforeDispatch).toHaveBeenCalledWith("invocation-row-1", 4, "workflow_attempts_exhausted", new Date("2026-09-12T10:00:00.000Z"));
		expect(transaction.mcpRuntimeExecution.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ commandState: McpExecutorCommandState.Failed, terminalPayloadDigest: expect.stringMatching(/^sha256:/u) }) }));
	});

	it("moves a claimed remote effect to recovery when its workflow exhausts", async function _ExhaustsClaimedWork()
	{
		const execution = { ..._Execution(McpExecutionTransport.RemoteHttp), commandState: McpExecutorCommandState.Claimed, toolInvocationId: "invocation-row-1", remoteClaimFence: "remote-fence-1", remoteClaimExpiresAt: new Date("2026-09-12T10:00:30.000Z"), toolInvocationClaimFence: 3, toolInvocationClaimRevision: 4 };
		const transaction = { mcpRuntimeExecution: { findFirst: vi.fn().mockResolvedValue(execution), updateMany: vi.fn().mockResolvedValue({ count: 1 }) }, mcpRuntimeClock: { findUnique: vi.fn().mockResolvedValue({ now: new Date("2026-09-12T10:00:00.000Z") }) } };
		const invocation = { id: "invocation-row-1", revision: 4, state: ToolInvocationStates.Claimed };
		const participant = { findById: vi.fn().mockResolvedValue(invocation), completeAmbiguous: vi.fn().mockResolvedValue({ ...invocation, state: ToolInvocationStates.RecoveryRequired }) };
		const readiness = { isReady: vi.fn(), lockForDispatch: vi.fn() };
		const repository = new PrismaRemoteMcpDispatchRepository(transaction as never, participant as never, readiness, _Results(), 30_000);

		await expect(repository.settleExhausted(_TARGET)).resolves.toBe(true);

		expect(participant.completeAmbiguous).toHaveBeenCalledWith({ invocationId: "invocation-row-1", kind: ExternalActionClaimKinds.Dispatch, fence: 3, revision: 4 }, new Date("2026-09-12T10:00:00.000Z"));
		expect(transaction.mcpRuntimeExecution.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ commandState: McpExecutorCommandState.RecoveryRequired, terminalPayloadDigest: expect.stringMatching(/^sha256:/u) }) }));
	});
});
