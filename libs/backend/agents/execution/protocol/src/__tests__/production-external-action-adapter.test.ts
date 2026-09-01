import { ExternalActionClaimKinds, ExternalActionRecoveryModes, ToolInvocationStates, type ToolInvocationClaim } from "@opencrane/backend/server/iam/authorization";
import { PersonalMemoryPermissionVerificationOutcomes } from "@opencrane/backend/agents/execution/elicitation";
import { UPGRADE_SESSION_TOOL_REVISION } from "@opencrane/backend/agents/personal/configuration";
import { __UnavailableSandboxJobExecutor } from "@opencrane/backend/server/infra/sandbox-execution";
import type { RunInputSnapshot } from "@opencrane/contracts";
import { PERSONAL_MEMORY_RECALL_TOOL_REVISION } from "@opencrane/models/agents";
import { ___DigestCanonicalJson } from "@opencrane/util";
import { describe, expect, it, vi } from "vitest";

import { ExternalActionProviderOutcomeKinds, type ExternalActionExecutionContext, type ExternalActionWorkerInvocation } from "../external-action-worker.types";
import { ProductionExternalActionAdapterFactory } from "../production-external-action-adapter";
import { _ExecutionSubject, _ToolInvocationAuthorizationEvidence } from "./execution-subject.fixture";

/** Build one saved invocation, as it exists just before the provider is called. */
function _invocation(toolRevisionId: string): ExternalActionWorkerInvocation
{
	const proposedArguments = { query: "proposed" };
	const effectiveArguments = { query: "approved" };
	return { id: "row-1", siloId: "silo-1", runId: "run-1", attempt: 1, mcpTaskId: null, agentRevisionId: "revision-1", authorizationEvidence: _ToolInvocationAuthorizationEvidence(), candidateId: "candidate-1", toolInvocationId: "tool-1", toolRevisionId, arguments: proposedArguments, argumentsDigest: ___DigestCanonicalJson(proposedArguments), effectiveArguments, effectiveArgumentsDigest: ___DigestCanonicalJson(effectiveArguments), requestFingerprint: "sha256:fingerprint", approvalRequired: false, recoveryMode: ExternalActionRecoveryModes.Manual, recoveryKey: null, state: ToolInvocationStates.Ready, preparationAttempt: 1, retryDeadlineAt: new Date("2026-08-11T10:05:00.000Z"), nextPreparationAttemptAt: new Date("2026-08-11T10:00:00.000Z"), claimAttempt: 0, claimKind: null, claimFence: 0, claimExpiresAt: null, result: null, failureCode: null, revision: 2 };
}

/** Build one immutable personal snapshot. */
function _context(): ExternalActionExecutionContext
{
	return { snapshot: { runId: "run-1", siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", personaRevisionId: "persona-1", conversationId: "conversation-1", executionSubject: _ExecutionSubject(), memoryQueryPolicy: null } as unknown as RunInputSnapshot };
}

/** Advance one prepared invocation into the exact dispatch claim passed to the adapter. */
function _claimed(invocation: ExternalActionWorkerInvocation): { readonly invocation: ExternalActionWorkerInvocation; readonly claim: ToolInvocationClaim }
{
	const claimedInvocation = { ...invocation, state: ToolInvocationStates.Claimed, claimKind: ExternalActionClaimKinds.Dispatch, claimFence: 1, claimExpiresAt: new Date("2026-08-11T10:01:00.000Z"), revision: invocation.revision + 1 };
	return { invocation: claimedInvocation, claim: { invocationId: invocation.id, kind: ExternalActionClaimKinds.Dispatch, fence: 1, revision: claimedInvocation.revision } };
}

/** Build a factory with fail-closed transports and an optional built-in proposal hook. */
function _factory(proposeUpgradeSession = vi.fn().mockResolvedValue({ changeId: "change-1" }), verifyMemoryPermission = vi.fn().mockResolvedValue({ outcome: PersonalMemoryPermissionVerificationOutcomes.Denied })): ProductionExternalActionAdapterFactory
{
	return new ProductionExternalActionAdapterFactory({
		transports: {
			sandboxExecutor: new __UnavailableSandboxJobExecutor(),
		},
		personalConfiguration: { proposeUpgradeSession },
		personalMemoryPermissions: { openMemoryPermission: vi.fn(), verifyMemoryPermission },
		now: function _now() { return new Date("2026-08-11T10:00:00.000Z"); },
	});
}

describe("production external action adapter", function _suite()
{
	it("rejects standalone MCP tasks before creating an AgentRun command", function _RejectsStandaloneMcpTask()
	{
		const invocation = { ..._invocation("sandbox:image-1"), runId: null, attempt: null, mcpTaskId: "mcp-task-1" };
		expect(function _prepare() { _factory().prepare(invocation, _context()); }).toThrow("not owned by an AgentRun");
	});

	it("marks current provider ports as manual recovery", function _manualMode()
	{
		const adapter = _factory().prepare(_invocation("sandbox:image-1"), _context());
		expect(adapter.recoveryMode).toBe(ExternalActionRecoveryModes.Manual);
	});

	it("returns a bounded failure for a retired integration revision", async function _retiredIntegration()
	{
		const invocation = _invocation("integration:calendar:calendar.read");
		const adapter = _factory().prepare(invocation, _context());
		const claimed = _claimed(invocation);
		await expect(adapter.dispatch(null, claimed.invocation, claimed.claim)).resolves.toEqual({ kind: ExternalActionProviderOutcomeKinds.Failed, failureCode: "external_action_unsupported" });
	});

	it("executes the built-in personal action from durable fields rather than runtime coordinates", async function _builtIn()
	{
		const proposeUpgradeSession = vi.fn().mockResolvedValue({ changeId: "change-1" });
		const invocation = _invocation(UPGRADE_SESSION_TOOL_REVISION);
		const adapter = _factory(proposeUpgradeSession).prepare(invocation, _context());
		const claimed = _claimed(invocation);
		await expect(adapter.dispatch(null, claimed.invocation, claimed.claim)).resolves.toEqual({ kind: ExternalActionProviderOutcomeKinds.Succeeded, result: { changeId: "change-1" } });
		expect(proposeUpgradeSession).toHaveBeenCalledWith(expect.objectContaining({ runId: "run-1", toolInvocationId: "tool-1", arguments: { query: "approved" }, argumentsDigest: ___DigestCanonicalJson({ query: "approved" }) }), _context().snapshot, "2026-08-11T10:00:00.000Z");
	});

	it("rejects changed effective arguments before selecting a provider transport", function _changedApprovedArguments()
	{
		const invocation = { ..._invocation("sandbox:image-1"), effectiveArguments: { query: "changed" } };
		expect(function _prepare() { _factory().prepare(invocation, _context()); }).toThrow("effective arguments failed integrity validation");
	});

	it("denies a stale personal-memory receipt before Cognee can be called", async function _staleMemoryReceipt()
	{
		const verifyMemoryPermission = vi.fn().mockResolvedValue({ outcome: PersonalMemoryPermissionVerificationOutcomes.Denied });
		const invocation = _invocation(PERSONAL_MEMORY_RECALL_TOOL_REVISION);
		const context = _context();
		const adapter = _factory(undefined, verifyMemoryPermission).prepare(invocation, context);
		const claimed = _claimed(invocation);
		await expect(adapter.dispatch(null, claimed.invocation, claimed.claim)).resolves.toEqual({ kind: ExternalActionProviderOutcomeKinds.Failed, failureCode: "memory_permission_unavailable" });
		expect(verifyMemoryPermission).toHaveBeenCalledWith(claimed.invocation, claimed.claim, context.snapshot, new Date("2026-08-11T10:00:00.000Z"));
	});

	it("stops at safe delivery after exact permission without persisting fact content", async function _authorizedMemoryReceipt()
	{
		const verifyMemoryPermission = vi.fn().mockResolvedValue({ outcome: PersonalMemoryPermissionVerificationOutcomes.Authorized });
		const invocation = _invocation(PERSONAL_MEMORY_RECALL_TOOL_REVISION);
		const adapter = _factory(undefined, verifyMemoryPermission).prepare(invocation, _context());
		const claimed = _claimed(invocation);
		await expect(adapter.dispatch(null, claimed.invocation, claimed.claim)).resolves.toEqual({ kind: ExternalActionProviderOutcomeKinds.Failed, failureCode: "safe_delivery_required" });
		expect(verifyMemoryPermission).toHaveBeenCalledOnce();
	});
});
