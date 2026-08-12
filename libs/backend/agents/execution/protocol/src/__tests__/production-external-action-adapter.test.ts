import { ExternalActionRecoveryModes, ToolInvocationStates } from "@opencrane/backend/server/iam/authorization";
import { UPGRADE_SESSION_TOOL_REVISION } from "@opencrane/backend/agents/personal/configuration";
import { __UnavailableMemoryGatewayClient } from "@opencrane/backend/server/infra/memory-gateway-client";
import { __UnavailableObotMcpInvocationAdapter } from "@opencrane/backend/server/infra/obot-custody";
import { __UnavailableSandboxJobExecutor } from "@opencrane/backend/server/infra/sandbox-execution";
import type { RunInputSnapshot } from "@opencrane/contracts";
import { ___DigestCanonicalJson } from "@opencrane/util";
import { describe, expect, it, vi } from "vitest";

import { ExternalActionProviderOutcomeKinds, type ExternalActionExecutionContext, type ExternalActionWorkerInvocation } from "../external-action-worker.types.js";
import { ProductionExternalActionAdapterFactory } from "../production-external-action-adapter.js";

/** Build one saved invocation, as it exists just before the provider is called. */
function _invocation(toolRevisionId: string): ExternalActionWorkerInvocation
{
	const proposedArguments = { query: "proposed" };
	const effectiveArguments = { query: "approved" };
	return { id: "row-1", siloId: "silo-1", runId: "run-1", attempt: 1, agentRevisionId: "revision-1", subjectId: "user-1", candidateId: "candidate-1", toolInvocationId: "tool-1", toolRevisionId, arguments: proposedArguments, argumentsDigest: ___DigestCanonicalJson(proposedArguments), effectiveArguments, effectiveArgumentsDigest: ___DigestCanonicalJson(effectiveArguments), requestFingerprint: "sha256:fingerprint", approvalRequired: false, recoveryMode: ExternalActionRecoveryModes.Manual, recoveryKey: null, state: ToolInvocationStates.Ready, preparationAttempt: 1, retryDeadlineAt: new Date("2026-08-11T10:05:00.000Z"), nextPreparationAttemptAt: new Date("2026-08-11T10:00:00.000Z"), claimAttempt: 0, claimKind: null, claimFence: 0, claimExpiresAt: null, result: null, failureCode: null, revision: 2 };
}

/** Build one immutable personal snapshot. */
function _context(): ExternalActionExecutionContext
{
	return { snapshot: { runId: "run-1", siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", personaRevisionId: "persona-1", conversationId: "conversation-1", identitySnapshot: { kind: "user", executionSubjectId: "user-1" }, memoryQueryPolicy: null } as unknown as RunInputSnapshot };
}

/** Build a factory with fail-closed transports and an optional built-in proposal hook. */
function _factory(proposeUpgradeSession = vi.fn().mockResolvedValue({ changeId: "change-1" })): ProductionExternalActionAdapterFactory
{
	return new ProductionExternalActionAdapterFactory({
		transports: {
			integrations: { resolveAssignment: async function _resolve() { return { outcome: "unavailable" as const, reason: "revoked" as const }; } },
			obotMcpInvocation: new __UnavailableObotMcpInvocationAdapter(),
			sandboxExecutor: new __UnavailableSandboxJobExecutor(),
			memoryGateway: new __UnavailableMemoryGatewayClient(),
		},
		personalConfiguration: { proposeUpgradeSession },
		now: function _now() { return new Date("2026-08-11T10:00:00.000Z"); },
	});
}

describe("production external action adapter", function _suite()
{
	it("marks current provider ports as manual recovery", function _manualMode()
	{
		const adapter = _factory().prepare(_invocation("integration:calendar:calendar.read"), _context());
		expect(adapter.recoveryMode).toBe(ExternalActionRecoveryModes.Manual);
	});

	it("returns a bounded failure when live integration authority refuses before dispatch", async function _revokedIntegration()
	{
		const adapter = _factory().prepare(_invocation("integration:calendar:calendar.read"), _context());
		await expect(adapter.dispatch(null)).resolves.toEqual({ kind: ExternalActionProviderOutcomeKinds.Failed, failureCode: "integration_assignment_revoked" });
	});

	it("executes the built-in personal action from durable fields rather than runtime coordinates", async function _builtIn()
	{
		const proposeUpgradeSession = vi.fn().mockResolvedValue({ changeId: "change-1" });
		const invocation = _invocation(UPGRADE_SESSION_TOOL_REVISION);
		const adapter = _factory(proposeUpgradeSession).prepare(invocation, _context());
		await expect(adapter.dispatch(null)).resolves.toEqual({ kind: ExternalActionProviderOutcomeKinds.Succeeded, result: { changeId: "change-1" } });
		expect(proposeUpgradeSession).toHaveBeenCalledWith(expect.objectContaining({ runId: "run-1", toolInvocationId: "tool-1", arguments: { query: "approved" }, argumentsDigest: ___DigestCanonicalJson({ query: "approved" }) }), _context().snapshot, "2026-08-11T10:00:00.000Z");
	});

	it("rejects changed effective arguments before selecting a provider transport", function _changedApprovedArguments()
	{
		const invocation = { ..._invocation("integration:calendar:calendar.read"), effectiveArguments: { query: "changed" } };
		expect(function _prepare() { _factory().prepare(invocation, _context()); }).toThrow("effective arguments failed integrity validation");
	});
});
