import { describe, expect, it, vi } from "vitest";

import { ExternalActionClaimKinds, ExternalActionRecoveryModes, ToolInvocationCompletionOutcomes, ToolInvocationStates, type ToolInvocationRecord } from "@opencrane/backend/server/iam/authorization";
import type { McpToolCallResult } from "@opencrane/contracts";

import type { McpInvocationCompletionCommand } from "../mcp-invocation-result.types";
import { PrismaMcpInvocationCompletionRepository } from "../prisma-mcp-invocation-completion-repository";

/** Synthetic MCP name forwarded unchanged to the injected result participant. */
const _RUNTIME_TOOL_NAME = "reports.create_csv";

/** Raw provider result retained long enough for the result participant to capture its resource. */
const _RAW_RESULT: McpToolCallResult = { isError: false, content: [{ type: "resource", resource: { uri: "urn:opencrane:test:file", mimeType: "text/csv;charset=utf-8", text: "name\r\nAda\r\n" } }] };
/** Terminal-safe projection returned only after resource custody succeeds. */
const _PREPARED_RESULT: McpToolCallResult = { isError: false, content: [{ type: "text", text: "Generated file captured" }], structuredContent: { kind: "generated_file_captured", operationId: "operation-1" } };
/** TokenReview-confirmed executor coordinates carried into resource capture. */
const _WORKLOAD = { subject: "system:serviceaccount:mcp-executors:mcp-executor-default", namespace: "mcp-executors", serviceAccountName: "mcp-executor-default", podUid: "pod-1" } as const;

/** Build a complete claimed invocation while allowing one boundary field to vary. */
function _Invocation(patch: Partial<ToolInvocationRecord> = {}): ToolInvocationRecord
{
	return {
		id: "invocation-row-1", siloId: "silo-1", agentRevisionId: "agent-revision-1", authorizationEvidence: null, runId: "run-1", attempt: 1, mcpTaskId: null,
		requestIdentity: { runtimeInstanceId: "runtime-1", commandId: "command-1", candidateId: "candidate-1" }, toolInvocationId: "tool-call-1", toolRevisionId: "tool-revision-1",
		arguments: { report: "people" }, argumentsDigest: `sha256:${"1".repeat(64)}`, effectiveArguments: { report: "people" }, effectiveArgumentsDigest: `sha256:${"1".repeat(64)}`,
		requestFingerprint: `sha256:${"2".repeat(64)}`, approvalRequired: false, recoveryMode: ExternalActionRecoveryModes.Manual, recoveryKey: null,
		state: ToolInvocationStates.Claimed, preparationAttempt: 1, retryDeadlineAt: new Date("2099-01-01T00:00:00.000Z"), nextPreparationAttemptAt: new Date("2026-01-01T00:00:00.000Z"),
		claimAttempt: 1, claimKind: ExternalActionClaimKinds.Dispatch, claimFence: 7, claimExpiresAt: new Date("2099-01-01T00:00:00.000Z"), result: null, failureCode: null, revision: 3,
		...patch,
	};
}

/** Assemble one completion repository with observable transaction participants. */
function _Harness(invocation: ToolInvocationRecord | null = _Invocation())
{
	const transaction = {
		mcpRuntimeClock: { findUnique: vi.fn().mockResolvedValue({ now: new Date("2026-09-13T10:00:00.001Z") }) },
		mcpToolRevision: { findFirst: vi.fn().mockResolvedValue({ name: _RUNTIME_TOOL_NAME }) },
	};
	const invocations = { findById: vi.fn().mockResolvedValue(invocation), completeSucceeded: vi.fn().mockResolvedValue({ outcome: ToolInvocationCompletionOutcomes.Completed, invocation: { ..._Invocation(), state: ToolInvocationStates.Succeeded, result: _PREPARED_RESULT }, delivery: { toolInvocationId: "tool-call-1", outcome: "succeeded", result: _PREPARED_RESULT } }) };
	const results = { prepare: vi.fn().mockResolvedValue(_PREPARED_RESULT) };
	const command: McpInvocationCompletionCommand = {
		claimFence: "companion-fence-1", companionNotAfterEpochMs: new Date("2099-01-01T00:00:00.000Z").getTime(), executionId: "execution-1", executionReference: "execution-reference-1",
		podUid: "pod-1", result: _RAW_RESULT, serverRevisionId: "server-revision-1", siloId: "silo-1",
		toolClaim: { invocationId: "invocation-row-1", kind: ExternalActionClaimKinds.Dispatch, fence: 7, revision: 3 }, workload: _WORKLOAD, workloadUid: "job-1",
	};
	return { command, invocations, repository: new PrismaMcpInvocationCompletionRepository(transaction as never, invocations as never, results), results, transaction };
}

/** Replace OCI companion coordinates with the exact saved remote runtime fence. */
function _RemoteCommand(command: McpInvocationCompletionCommand): McpInvocationCompletionCommand
{
	return {
		executionId: command.executionId,
		remoteClaimFence: "remote-fence-1",
		remoteNotAfterEpochMs: new Date("2099-01-01T00:00:00.000Z").getTime(),
		result: command.result,
		serverRevisionId: command.serverRevisionId,
		siloId: command.siloId,
		toolClaim: command.toolClaim,
	};
}

describe("Prisma MCP invocation completion", function _DescribeCompletion()
{
	it("passes immutable execution and tool metadata to capture, then saves only its prepared result", async function _CapturesBeforeIamCompletion()
	{
		const harness = _Harness();

		await expect(harness.repository.complete(harness.command, new Date("2026-09-13T10:00:00.000Z"))).resolves.toBe(true);

		expect(harness.results.prepare).toHaveBeenCalledWith(expect.objectContaining({
			executionId: "execution-1", executionReference: "execution-reference-1", invocation: expect.objectContaining({ id: "invocation-row-1", requestIdentity: { runtimeInstanceId: "runtime-1", commandId: "command-1", candidateId: "candidate-1" } }),
			podUid: "pod-1", result: _RAW_RESULT, serverRevisionId: "server-revision-1", siloId: "silo-1", toolName: _RUNTIME_TOOL_NAME, workload: _WORKLOAD, workloadUid: "job-1",
		}));
		expect(harness.invocations.completeSucceeded).toHaveBeenCalledWith(harness.command.toolClaim, _PREPARED_RESULT, expect.any(Date));
	});

	it("passes verified remote proof to the participant before terminal persistence", async function _RemoteProofBeforeCompletion()
	{
		const harness = _Harness();
		const command = _RemoteCommand(harness.command);

		await expect(harness.repository.completeResult(command, new Date("2026-09-13T10:00:00.000Z"))).resolves.toEqual({ result: _PREPARED_RESULT, completedAt: new Date("2026-09-13T10:00:00.001Z") });

		expect(harness.transaction.mcpToolRevision.findFirst).toHaveBeenCalledWith({ where: { id: "tool-revision-1", siloId: "silo-1", serverRevisionId: "server-revision-1" }, select: { name: true } });
		expect(harness.results.prepare).toHaveBeenCalledWith(expect.objectContaining({ executionId: "execution-1", invocation: expect.objectContaining({ id: "invocation-row-1" }), remoteClaimFence: "remote-fence-1", toolName: _RUNTIME_TOOL_NAME }));
		expect(harness.results.prepare.mock.calls[0]?.[0]).not.toHaveProperty("workload");
		expect(harness.invocations.completeSucceeded).toHaveBeenCalledAfter(harness.results.prepare);
	});

	it("refuses a substituted remote server revision before its participant runs", async function _RejectsRemoteServerSubstitution()
	{
		const harness = _Harness();
		harness.transaction.mcpToolRevision.findFirst.mockResolvedValue(null);

		await expect(harness.repository.completeResult(_RemoteCommand(harness.command), new Date("2026-09-13T10:00:00.000Z"))).resolves.toBeNull();

		expect(harness.results.prepare).not.toHaveBeenCalled();
		expect(harness.invocations.completeSucceeded).not.toHaveBeenCalled();
	});

	it("rejects when fresh database time reaches the remote lease after result preparation", async function _RejectsRemoteExpiry()
	{
		const startedAt = new Date("2026-09-13T10:00:00.000Z");
		const harness = _Harness(_Invocation({ claimExpiresAt: new Date(startedAt.getTime() + 200) }));
		const command = { ..._RemoteCommand(harness.command), remoteNotAfterEpochMs: startedAt.getTime() + 100 };
		harness.transaction.mcpRuntimeClock.findUnique.mockResolvedValue({ now: new Date(startedAt.getTime() + 100) });

		await expect(harness.repository.completeResult(command, startedAt)).rejects.toThrow(/authority expired during result capture/u);

		expect(harness.transaction.mcpRuntimeClock.findUnique).toHaveBeenCalledAfter(harness.results.prepare);
		expect(harness.invocations.completeSucceeded).not.toHaveBeenCalled();
	});

	it("uses fresh database time for remote completion when the process wall clock is skewed", async function _RemoteClockSkew()
	{
		vi.useFakeTimers();
		try
		{
			const startedAt = new Date("2026-09-13T10:00:00.000Z");
			vi.setSystemTime(new Date("2199-01-01T00:00:00.000Z"));
			const harness = _Harness(_Invocation({ claimExpiresAt: new Date(startedAt.getTime() + 200) }));
			const command = { ..._RemoteCommand(harness.command), remoteNotAfterEpochMs: startedAt.getTime() + 200 };
			harness.transaction.mcpRuntimeClock.findUnique.mockResolvedValue({ now: new Date(startedAt.getTime() + 100) });

			await expect(harness.repository.completeResult(command, startedAt)).resolves.toEqual({ result: _PREPARED_RESULT, completedAt: new Date(startedAt.getTime() + 100) });

			expect(harness.invocations.completeSucceeded).toHaveBeenCalledWith(command.toolClaim, _PREPARED_RESULT, new Date(startedAt.getTime() + 100));
		}
		finally
		{
			vi.useRealTimers();
		}
	});

	it("does not fall back to the raw resource when its result participant fails", async function _RejectsCaptureFailure()
	{
		const harness = _Harness();
		harness.results.prepare.mockRejectedValue(new Error("capture rejected"));

		await expect(harness.repository.complete(harness.command, new Date("2026-09-13T10:00:00.000Z"))).rejects.toThrow(/capture rejected/u);

		expect(harness.invocations.completeSucceeded).not.toHaveBeenCalled();
	});

	it.each([
		["missing", { outcome: ToolInvocationCompletionOutcomes.Missing }],
		["conflicting winner", { outcome: ToolInvocationCompletionOutcomes.Winner, invocation: { ..._Invocation(), state: ToolInvocationStates.Succeeded, result: { isError: false, content: [] } } }],
	])("throws after capture when IAM reports a %s", async function _RejectsLostFence(_scenario, completion)
	{
		const harness = _Harness();
		harness.invocations.completeSucceeded.mockResolvedValue(completion);

		await expect(harness.repository.complete(harness.command, new Date("2026-09-13T10:00:00.000Z"))).rejects.toThrow(/lost its result fence/u);

		expect(harness.results.prepare).toHaveBeenCalledOnce();
	});

	it.each([
		["missing invocation", null],
		["foreign silo", _Invocation({ siloId: "silo-2" })],
		["wrong state", _Invocation({ state: ToolInvocationStates.Ready })],
		["wrong claim kind", _Invocation({ claimKind: ExternalActionClaimKinds.Reconcile })],
		["stale fence", _Invocation({ claimFence: 8 })],
		["stale revision", _Invocation({ revision: 4 })],
		["expired claim", _Invocation({ claimExpiresAt: new Date("2026-09-13T10:00:00.000Z") })],
	])("refuses a %s before result capture", async function _RejectsStaleClaim(_scenario, invocation)
	{
		const harness = _Harness(invocation);

		await expect(harness.repository.complete(harness.command, new Date("2026-09-13T10:00:00.000Z"))).resolves.toBe(false);

		expect(harness.transaction.mcpToolRevision.findFirst).not.toHaveBeenCalled();
		expect(harness.results.prepare).not.toHaveBeenCalled();
		expect(harness.invocations.completeSucceeded).not.toHaveBeenCalled();
	});

	it.each([
		["IAM claim", 100, 200],
		["companion claim", 200, 100],
	])("rejects when the fixed %s expires while capture prepares the result", async function _RejectsExpiry(_scenario, claimOffset, companionOffset)
	{
		vi.useFakeTimers();
		try
		{
			const startedAt = new Date("2026-09-13T10:00:00.000Z");
			vi.setSystemTime(startedAt);
			const harness = _Harness(_Invocation({ claimExpiresAt: new Date(startedAt.getTime() + claimOffset) }));
			harness.command = { ...harness.command, companionNotAfterEpochMs: startedAt.getTime() + companionOffset };
			harness.results.prepare.mockImplementation(async function _Prepare()
			{
				vi.setSystemTime(new Date(startedAt.getTime() + 150));
				return _PREPARED_RESULT;
			});

			await expect(harness.repository.complete(harness.command, startedAt)).rejects.toThrow(/authority expired during result capture/u);

			expect(harness.invocations.completeSucceeded).not.toHaveBeenCalled();
		}
		finally
		{
			vi.useRealTimers();
		}
	});
});
