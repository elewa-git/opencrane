import { describe, expect, it, vi } from "vitest";

import { McpConnectionCredentialKinds, type McpToolCallResult } from "@opencrane/contracts";
import { ExternalActionClaimKinds } from "@opencrane/backend/server/iam/authorization";
import { McpRemoteConfigurationError, McpRemoteDeliveryStates, McpRemoteTransportError } from "@opencrane/backend/server/infra/mcp-remote-client";
import { WorkflowTaskRetryableError } from "@opencrane/backend/server/infra/workflows/contract";

import { McpConnectionCredentialReadOutcomes } from "../../connections/mcp-connection-credential-reader.types";
import { _RemoteMcpClaimLeaseMilliseconds, RemoteMcpInvocationExecutor } from "../remote-mcp-invocation-executor";
import { McpInvocationDispatchOutcomes, McpInvocationOwnerKinds, RemoteMcpDispatchClaimOutcomes, type McpInvocationDispatchTarget, type RemoteMcpDispatchClaim, type RemoteMcpInvocationExecutorDependencies } from "../remote-mcp-invocation.types";

const _WORKLOAD = { audience: "opencrane-server-mcp", namespace: "opencrane", serviceAccountName: "opencrane", workloadKind: "pod", workloadUid: "pod-1", podUid: "pod-1" } as const;
const _TARGET: McpInvocationDispatchTarget = { ownerKind: McpInvocationOwnerKinds.Run, siloId: "silo-1", runId: "run-1", attempt: 2, toolInvocationId: "public-call-1" };
const _CLAIM: RemoteMcpDispatchClaim = {
	executionId: "execution-1",
	notAfterEpochMs: new Date("2099-01-01T00:00:00.000Z").getTime(),
	remainingClaimMilliseconds: 45_000,
	remoteClaimFence: "remote-fence-1",
	toolInvocationClaim: { invocationId: "invocation-1", kind: ExternalActionClaimKinds.Dispatch, fence: 2, revision: 4 },
	binding: {
		siloId: "silo-1",
		connectionId: "connection-1",
		connectionGeneration: 3,
		connectionOwnerPrincipalId: "principal-1",
		endpointDigest: `sha256:${"a".repeat(64)}`,
		serverRevisionId: "server-revision-1",
		mcpServerId: "server-1",
		toolRevisionId: "tool-revision-1",
		protocolVersion: "2026-07-28",
		credentialSecretUid: "secret-uid-1",
		credentialSecretResourceVersion: "8",
	},
	endpoint: "https://mcp.example.test/rpc",
	toolName: "records.read",
	arguments: { query: "active record" },
	inputSchema: { type: "object" },
};

/** Credential outcomes that prove no provider request was made. */
const _UNAVAILABLE_CREDENTIAL_OUTCOMES = [
	McpConnectionCredentialReadOutcomes.NotFound,
	McpConnectionCredentialReadOutcomes.Denied,
	McpConnectionCredentialReadOutcomes.RecoveryRequired,
	McpConnectionCredentialReadOutcomes.Uncertain,
] as const;

/** Build observable ports for one remote invocation without opening a database or socket. */
function _Dependencies(): RemoteMcpInvocationExecutorDependencies
{
	return {
		authority: {
			claim: vi.fn().mockImplementation(async function _Claim(command)
			{
				return command.workload === undefined
					? { outcome: RemoteMcpDispatchClaimOutcomes.IdentityRequired }
					: { outcome: RemoteMcpDispatchClaimOutcomes.Claimed, claim: _CLAIM };
			}),
			completeSucceeded: vi.fn().mockResolvedValue(true),
			completeFailed: vi.fn().mockResolvedValue(true),
			completeAmbiguous: vi.fn().mockResolvedValue(true),
			settleExhausted: vi.fn().mockResolvedValue(true),
		},
		serverIdentity: { read: vi.fn().mockResolvedValue(_WORKLOAD) },
		credentials: { readExact: vi.fn().mockResolvedValue({ outcome: McpConnectionCredentialReadOutcomes.Ready, credential: { kind: McpConnectionCredentialKinds.None } }) },
		client: { callTool: vi.fn().mockResolvedValue({ isError: false, content: [{ type: "text", text: "found" }] }) },
		timeoutMilliseconds: 5_000,
	};
}

describe("remote MCP invocation executor", function _Suite()
{
	it("reads the exact claimed connection and saves one credentialless result", async function _CredentiallessSuccess()
	{
		const dependencies = _Dependencies();
		const executor = new RemoteMcpInvocationExecutor(dependencies);

		await expect(executor.execute(_TARGET)).resolves.toBe(McpInvocationDispatchOutcomes.Completed);

		expect(dependencies.authority.claim).toHaveBeenNthCalledWith(1, { target: _TARGET });
		expect(dependencies.authority.claim).toHaveBeenNthCalledWith(2, { target: _TARGET, workload: _WORKLOAD });
		expect(dependencies.credentials.readExact).toHaveBeenCalledExactlyOnceWith({ siloId: "silo-1", connectionId: "connection-1", generation: 3, ownerPrincipalId: "principal-1", serverId: "server-1", serverRevisionId: "server-revision-1" }, expect.any(AbortSignal));
		expect(vi.mocked(dependencies.client.callTool).mock.calls[0]?.[0]).toMatchObject({ endpoint: _CLAIM.endpoint, invocationId: "invocation-1", toolName: "records.read", arguments: _CLAIM.arguments, inputSchema: _CLAIM.inputSchema });
		expect(dependencies.authority.completeSucceeded).toHaveBeenCalledExactlyOnceWith(_CLAIM, { isError: false, content: [{ type: "text", text: "found" }] });
	});

	it("keeps bearer material ephemeral in the one client command", async function _BearerSuccess()
	{
		const dependencies = _Dependencies();
		vi.mocked(dependencies.credentials.readExact).mockResolvedValue({ outcome: McpConnectionCredentialReadOutcomes.Ready, credential: { kind: McpConnectionCredentialKinds.Bearer, token: "memory-only-token" } });

		await expect(new RemoteMcpInvocationExecutor(dependencies).execute(_TARGET)).resolves.toBe(McpInvocationDispatchOutcomes.Completed);

		expect(vi.mocked(dependencies.client.callTool).mock.calls[0]?.[0]).toMatchObject({ authorization: { kind: "bearer", token: "memory-only-token" } });
	});

	it.each(_UNAVAILABLE_CREDENTIAL_OUTCOMES)("closes %s credential reads before provider dispatch", async function _CredentialUnavailable(outcome)
	{
		const dependencies = _Dependencies();
		vi.mocked(dependencies.credentials.readExact).mockResolvedValue({ outcome });

		await expect(new RemoteMcpInvocationExecutor(dependencies).execute(_TARGET)).resolves.toBe(McpInvocationDispatchOutcomes.Terminal);

		expect(dependencies.client.callTool).not.toHaveBeenCalled();
		expect(dependencies.authority.completeFailed).toHaveBeenCalledExactlyOnceWith(_CLAIM, "mcp_remote_credential_unavailable");
	});

	it("closes a thrown credential read before provider dispatch", async function _CredentialReadThrows()
	{
		const dependencies = _Dependencies();
		vi.mocked(dependencies.credentials.readExact).mockRejectedValue(new Error("secret store unavailable"));

		await expect(new RemoteMcpInvocationExecutor(dependencies).execute(_TARGET)).resolves.toBe(McpInvocationDispatchOutcomes.Terminal);

		expect(dependencies.client.callTool).not.toHaveBeenCalled();
		expect(dependencies.authority.completeFailed).toHaveBeenCalledExactlyOnceWith(_CLAIM, "mcp_remote_credential_unavailable");
	});

	it("makes a thrown server identity read retryable without claiming or dispatching", async function _IdentityReadThrows()
	{
		const dependencies = _Dependencies();
		vi.mocked(dependencies.serverIdentity.read).mockRejectedValue(new Error("token review unavailable"));

		await expect(new RemoteMcpInvocationExecutor(dependencies).execute(_TARGET)).rejects.toBeInstanceOf(WorkflowTaskRetryableError);

		expect(dependencies.authority.claim).toHaveBeenCalledExactlyOnceWith({ target: _TARGET });
		expect(dependencies.credentials.readExact).not.toHaveBeenCalled();
		expect(dependencies.client.callTool).not.toHaveBeenCalled();
	});

	it("closes a client rejection proven to precede dispatch", async function _ProvenNotDispatched()
	{
		const dependencies = _Dependencies();
		vi.mocked(dependencies.client.callTool).mockRejectedValue(new McpRemoteConfigurationError("invalid_endpoint"));

		await expect(new RemoteMcpInvocationExecutor(dependencies).execute(_TARGET)).resolves.toBe(McpInvocationDispatchOutcomes.Terminal);

		expect(dependencies.authority.completeFailed).toHaveBeenCalledExactlyOnceWith(_CLAIM, "mcp_remote_request_rejected");
		expect(dependencies.authority.completeAmbiguous).not.toHaveBeenCalled();
	});

	it("requires manual recovery when request delivery may have occurred", async function _MaybeDispatched()
	{
		const dependencies = _Dependencies();
		vi.mocked(dependencies.client.callTool).mockRejectedValue(new McpRemoteTransportError("network", McpRemoteDeliveryStates.MaybeDispatched));

		await expect(new RemoteMcpInvocationExecutor(dependencies).execute(_TARGET)).resolves.toBe(McpInvocationDispatchOutcomes.Terminal);

		expect(dependencies.authority.completeAmbiguous).toHaveBeenCalledExactlyOnceWith(_CLAIM, "mcp_remote_result_uncertain");
		expect(dependencies.authority.completeFailed).not.toHaveBeenCalled();
	});

	it("makes a failed terminal write retryable without another provider call", async function _TerminalWriteThrows()
	{
		const dependencies = _Dependencies();
		vi.mocked(dependencies.client.callTool).mockRejectedValue(new McpRemoteTransportError("network", McpRemoteDeliveryStates.MaybeDispatched));
		vi.mocked(dependencies.authority.completeAmbiguous).mockRejectedValue(new Error("database unavailable"));

		await expect(new RemoteMcpInvocationExecutor(dependencies).execute(_TARGET)).rejects.toBeInstanceOf(WorkflowTaskRetryableError);

		expect(dependencies.client.callTool).toHaveBeenCalledOnce();
		expect(dependencies.authority.completeAmbiguous).toHaveBeenCalledOnce();
	});

	it("does not reinterpret a completion error as a pre-dispatch client failure", async function _CompletionLookalike()
	{
		const dependencies = _Dependencies();
		vi.mocked(dependencies.authority.completeSucceeded).mockRejectedValue({ delivery: McpRemoteDeliveryStates.ProvenNotDispatched });

		await expect(new RemoteMcpInvocationExecutor(dependencies).execute(_TARGET)).rejects.toBeInstanceOf(WorkflowTaskRetryableError);

		expect(dependencies.client.callTool).toHaveBeenCalledOnce();
		expect(dependencies.authority.completeFailed).not.toHaveBeenCalled();
		expect(dependencies.authority.completeAmbiguous).not.toHaveBeenCalled();
	});

	it("does not redispatch after a result participant failure leaves a saved provider claim", async function _ParticipantFailureDoesNotRedispatch()
	{
		const dependencies = _Dependencies();
		vi.mocked(dependencies.authority.claim)
			.mockResolvedValueOnce({ outcome: RemoteMcpDispatchClaimOutcomes.IdentityRequired })
			.mockResolvedValueOnce({ outcome: RemoteMcpDispatchClaimOutcomes.Claimed, claim: _CLAIM })
			.mockResolvedValueOnce({ outcome: RemoteMcpDispatchClaimOutcomes.Terminal });
		vi.mocked(dependencies.authority.completeSucceeded).mockRejectedValue(new Error("remote resource rejected"));
		const executor = new RemoteMcpInvocationExecutor(dependencies);

		await expect(executor.execute(_TARGET)).rejects.toBeInstanceOf(WorkflowTaskRetryableError);
		await expect(executor.execute(_TARGET)).resolves.toBe(McpInvocationDispatchOutcomes.Terminal);

		expect(dependencies.client.callTool).toHaveBeenCalledOnce();
		expect(dependencies.authority.completeSucceeded).toHaveBeenCalledOnce();
		expect(dependencies.authority.completeFailed).not.toHaveBeenCalled();
		expect(dependencies.authority.completeAmbiguous).not.toHaveBeenCalled();
	});

	it("does not read credentials or call a provider for OCI and terminal winners", async function _SavedWinners()
	{
		const dependencies = _Dependencies();
		vi.mocked(dependencies.authority.claim)
			.mockResolvedValueOnce({ outcome: RemoteMcpDispatchClaimOutcomes.NotRemote })
			.mockResolvedValueOnce({ outcome: RemoteMcpDispatchClaimOutcomes.Terminal });
		const executor = new RemoteMcpInvocationExecutor(dependencies);

		await expect(executor.execute(_TARGET)).resolves.toBe(McpInvocationDispatchOutcomes.AwaitingOciCompanion);
		await expect(executor.execute(_TARGET)).resolves.toBe(McpInvocationDispatchOutcomes.Terminal);

		expect(dependencies.credentials.readExact).not.toHaveBeenCalled();
		expect(dependencies.client.callTool).not.toHaveBeenCalled();
		expect(dependencies.serverIdentity.read).not.toHaveBeenCalled();
	});

	it("ends a stalled credential read at the claim deadline and ignores its late success", async function _CredentialDeadline()
	{
		vi.useFakeTimers();
		try
		{
			const dependencies = _Dependencies();
			const claim = { ..._CLAIM, remainingClaimMilliseconds: 30_100 };
			vi.mocked(dependencies.authority.claim)
				.mockResolvedValueOnce({ outcome: RemoteMcpDispatchClaimOutcomes.IdentityRequired })
				.mockResolvedValueOnce({ outcome: RemoteMcpDispatchClaimOutcomes.Claimed, claim });
			let releaseCredential: (() => void) | undefined;
			vi.mocked(dependencies.credentials.readExact).mockImplementation(function _DelayedCredential()
			{
				return new Promise(function _WaitForCredential(resolve)
				{
					releaseCredential = function _ReleaseCredential()
					{
						resolve({ outcome: McpConnectionCredentialReadOutcomes.Ready, credential: { kind: McpConnectionCredentialKinds.None } });
					};
				});
			});
			const execution = new RemoteMcpInvocationExecutor(dependencies).execute(_TARGET);

			await vi.advanceTimersByTimeAsync(100);
			await expect(execution).resolves.toBe(McpInvocationDispatchOutcomes.Terminal);
			const credentialSignal = vi.mocked(dependencies.credentials.readExact).mock.calls[0]?.[1];
			expect(credentialSignal?.aborted).toBe(true);
			releaseCredential?.();
			await vi.advanceTimersByTimeAsync(1);

			expect(dependencies.client.callTool).not.toHaveBeenCalled();
			expect(dependencies.authority.completeFailed).toHaveBeenCalledExactlyOnceWith(claim, "mcp_remote_credential_unavailable");
		}
		finally
		{
			vi.useRealTimers();
		}
	});

	it("charges credential latency against the original provider timeout", async function _ConsumesOriginalAllowance()
	{
		vi.useFakeTimers();
		try
		{
			const dependencies = _Dependencies();
			const claim = { ..._CLAIM, remainingClaimMilliseconds: 35_000 };
			vi.mocked(dependencies.authority.claim)
				.mockResolvedValueOnce({ outcome: RemoteMcpDispatchClaimOutcomes.IdentityRequired })
				.mockResolvedValueOnce({ outcome: RemoteMcpDispatchClaimOutcomes.Claimed, claim });
			let releaseCredential: (() => void) | undefined;
			vi.mocked(dependencies.credentials.readExact).mockImplementation(function _DelayedCredential()
			{
				return new Promise(function _WaitForCredential(resolve)
				{
					releaseCredential = function _ReleaseCredential()
					{
						resolve({ outcome: McpConnectionCredentialReadOutcomes.Ready, credential: { kind: McpConnectionCredentialKinds.None } });
					};
				});
			});
			vi.mocked(dependencies.client.callTool).mockImplementation(function _IgnoreAbort()
			{
				return new Promise<never>(function _NeverResolve() {});
			});
			const execution = new RemoteMcpInvocationExecutor(dependencies).execute(_TARGET);

			await vi.advanceTimersByTimeAsync(2_000);
			releaseCredential?.();
			await vi.advanceTimersByTimeAsync(2_999);
			const signal = vi.mocked(dependencies.client.callTool).mock.calls[0]?.[0].signal;
			expect(signal?.aborted).toBe(false);
			expect(dependencies.authority.completeAmbiguous).not.toHaveBeenCalled();

			await vi.advanceTimersByTimeAsync(1);
			await expect(execution).resolves.toBe(McpInvocationDispatchOutcomes.Terminal);
			expect(signal?.aborted).toBe(true);
			expect(dependencies.authority.completeAmbiguous).toHaveBeenCalledExactlyOnceWith(claim, "mcp_remote_result_uncertain");
		}
		finally
		{
			vi.useRealTimers();
		}
	});

	it("refuses provider input at the exact start of the reserved completion allowance", async function _ExactExpiryBoundary()
	{
		const dependencies = _Dependencies();
		const claim = { ..._CLAIM, remainingClaimMilliseconds: 30_000 };
		vi.mocked(dependencies.authority.claim)
			.mockResolvedValueOnce({ outcome: RemoteMcpDispatchClaimOutcomes.IdentityRequired })
			.mockResolvedValueOnce({ outcome: RemoteMcpDispatchClaimOutcomes.Claimed, claim });

		await expect(new RemoteMcpInvocationExecutor(dependencies).execute(_TARGET)).resolves.toBe(McpInvocationDispatchOutcomes.Terminal);

		expect(dependencies.credentials.readExact).not.toHaveBeenCalled();
		expect(dependencies.client.callTool).not.toHaveBeenCalled();
	});

	it("accepts a provider result that resolves inside the original allowance", async function _ResponseBeforeDeadline()
	{
		vi.useFakeTimers();
		try
		{
			const dependencies = _Dependencies();
			const claim = { ..._CLAIM, remainingClaimMilliseconds: 35_000 };
			vi.mocked(dependencies.authority.claim)
				.mockResolvedValueOnce({ outcome: RemoteMcpDispatchClaimOutcomes.IdentityRequired })
				.mockResolvedValueOnce({ outcome: RemoteMcpDispatchClaimOutcomes.Claimed, claim });
			let releaseResult: (() => void) | undefined;
			vi.mocked(dependencies.client.callTool).mockImplementation(function _DelayedResult()
			{
				return new Promise<McpToolCallResult>(function _WaitForResult(resolve)
				{
					releaseResult = function _ReleaseResult()
					{
						resolve({ isError: false, content: [{ type: "text", text: "before deadline" }] });
					};
				});
			});
			const execution = new RemoteMcpInvocationExecutor(dependencies).execute(_TARGET);

			await vi.advanceTimersByTimeAsync(4_999);
			releaseResult?.();
			await expect(execution).resolves.toBe(McpInvocationDispatchOutcomes.Completed);

			expect(dependencies.authority.completeSucceeded).toHaveBeenCalledExactlyOnceWith(claim, { isError: false, content: [{ type: "text", text: "before deadline" }] });
			expect(dependencies.authority.completeAmbiguous).not.toHaveBeenCalled();
		}
		finally
		{
			vi.useRealTimers();
		}
	});

	it("uses database remaining time even when the process wall clock is far ahead", async function _IgnoresWallClockSkew()
	{
		vi.useFakeTimers();
		try
		{
			vi.setSystemTime(new Date("2199-01-01T00:00:00.000Z"));
			const dependencies = _Dependencies();
			const claim = { ..._CLAIM, notAfterEpochMs: new Date("2026-09-13T10:00:45.000Z").getTime() };
			vi.mocked(dependencies.authority.claim)
				.mockResolvedValueOnce({ outcome: RemoteMcpDispatchClaimOutcomes.IdentityRequired })
				.mockResolvedValueOnce({ outcome: RemoteMcpDispatchClaimOutcomes.Claimed, claim });

			await expect(new RemoteMcpInvocationExecutor(dependencies).execute(_TARGET)).resolves.toBe(McpInvocationDispatchOutcomes.Completed);

			expect(dependencies.client.callTool).toHaveBeenCalledOnce();
		}
		finally
		{
			vi.useRealTimers();
		}
	});

	it("derives remote claim time only from the remote request policy", function _RemoteLeasePolicy()
	{
		expect(_RemoteMcpClaimLeaseMilliseconds(1_000)).toBe(41_000);
		expect(_RemoteMcpClaimLeaseMilliseconds(60_000)).toBe(100_000);
	});
});
