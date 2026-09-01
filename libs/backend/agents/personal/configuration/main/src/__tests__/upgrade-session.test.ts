import { describe, expect, it } from "vitest";

import type { RunInputSnapshot } from "@opencrane/contracts";

import { __IsUpgradeSessionAvailable, UPGRADE_SESSION_TOOL } from "../upgrade-session/upgrade-session";

/** Build the smallest immutable snapshot needed to test personal-tool eligibility. */
function _Snapshot(overrides: Partial<RunInputSnapshot> = {}): RunInputSnapshot
{
	return { runId: "run-1", attempt: 1, siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "agent-1", snapshotVersion: 1, conversationId: "conversation-1", messageIds: [], personaRevisionId: "persona-1", preferenceFactIds: [], artifactRevisionIds: [], skillRevisionIds: [], memoryQueryPolicy: {}, mcpTools: [], modelRoute: {}, budgetPolicy: {}, executionSubject: _ExecutionSubject(), promptCompilerVersion: "test", digest: "sha256:snapshot", compiledAt: "2026-07-23T00:00:00.000Z", ...overrides };
}

/** Builds the execution subject that binds this personal test run to one principal. */
function _ExecutionSubject(): RunInputSnapshot["executionSubject"]
{
	return {
		schemaVersion: 1,
		siloId: "silo-1",
		agentIdentityId: "identity-1",
		principalId: "user-1",
		identity: { agentIdentityId: "identity-1", principalId: "user-1", siloId: "silo-1", headRevision: "1", headDigest: `sha256:${"a".repeat(64)}`, decisionEvidenceId: "identity-decision-1", verifiedAt: "2026-07-23T00:00:00.000Z" },
		membership: { principalId: "user-1", siloId: "silo-1", revision: 1, assertionId: "assertion-1", payloadDigest: `sha256:${"b".repeat(64)}`, decisionEvidenceId: "membership-decision-1", trustedUntil: "2026-07-23T01:00:00.000Z" },
		capability: { agentIdentityId: "identity-1", computerId: "computer-1", capabilitySetDigest: `sha256:${"c".repeat(64)}`, effectiveContractDigest: `sha256:${"d".repeat(64)}`, decisionEvidenceId: "capability-decision-1", decidedAt: "2026-07-23T00:00:00.000Z" },
		runScope: { siloId: "silo-1", runId: "run-1", attempt: 1, agentServiceId: "service-1", agentRevisionId: "agent-1" },
		computerScope: { siloId: "silo-1", computerId: "computer-1", leaseId: "lease-1", leaseGeneration: 1 },
		requester: { siloId: "silo-1", requesterPrincipalId: "user-1", requestIdempotencyKey: "request-1", authenticatedAt: "2026-07-23T00:00:00.000Z" },
		admission: { authorizingPrincipalId: "user-1", decisionEvidenceId: "admission-decision-1", admittedAt: "2026-07-23T00:00:00.000Z" },
	};
}

describe("upgrade_session tool", function _UpgradeSessionSuite()
{
	it("is available only to a personal conversation snapshot", function _PersonalConversation()
	{
		expect(__IsUpgradeSessionAvailable(_Snapshot())).toBe(true);
		expect(__IsUpgradeSessionAvailable(_Snapshot({ personaRevisionId: null }))).toBe(false);
		expect(__IsUpgradeSessionAvailable(_Snapshot({ conversationId: null }))).toBe(false);
	});

	it("is first-party and never opens deferred approval for the invocation", function _Descriptor()
	{
		expect(UPGRADE_SESSION_TOOL).toMatchObject({ name: "upgrade_session", toolRevisionId: "opencrane:personal:upgrade_session:v1", requiresApproval: false });
		expect(UPGRADE_SESSION_TOOL.parametersSchema).toMatchObject({ oneOf: expect.arrayContaining([expect.objectContaining({ additionalProperties: false })]) });
		expect(UPGRADE_SESSION_TOOL.parametersSchema).toMatchObject({ oneOf: expect.arrayContaining([expect.objectContaining({ properties: expect.objectContaining({ modelAlias: expect.objectContaining({ pattern: "\\S" }) }) })]) });
	});
});
