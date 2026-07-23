import { describe, expect, it } from "vitest";

import type { RunInputSnapshot } from "@opencrane/contracts";

import { __IsUpgradeSessionAvailable, UPGRADE_SESSION_TOOL } from "../upgrade-session.js";

/** Build the smallest immutable snapshot needed to test personal-tool eligibility. */
function _Snapshot(overrides: Partial<RunInputSnapshot> = {}): RunInputSnapshot
{
	return { runId: "run-1", siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "agent-1", snapshotVersion: 1, threadId: "thread-1", messageIds: [], personaRevisionId: "persona-1", preferenceFactIds: [], artifactRevisionIds: [], skillRevisionIds: [], memoryFacts: [], memoryQueryPolicy: {}, toolGrantIds: [], modelRoute: {}, budgetPolicy: {}, identitySnapshot: { executionSubjectId: "user-1", fleetMembershipRevision: 1, fleetMembershipIssuer: "issuer", fleetMembershipIssuerKeyId: "key", fleetMembershipAssertionId: "assertion", fleetMembershipPayloadDigest: "sha256:payload", fleetMembershipTrustedUntil: "2026-07-23T01:00:00.000Z" }, capabilitySetDigest: "sha256:capability", effectiveContractDigest: "sha256:contract", promptCompilerVersion: "test", digest: "sha256:snapshot", compiledAt: "2026-07-23T00:00:00.000Z", ...overrides };
}

describe("upgrade_session tool", function _UpgradeSessionSuite()
{
	it("is available only to a personal conversation snapshot", function _PersonalConversation()
	{
		expect(__IsUpgradeSessionAvailable(_Snapshot())).toBe(true);
		expect(__IsUpgradeSessionAvailable(_Snapshot({ personaRevisionId: null }))).toBe(false);
		expect(__IsUpgradeSessionAvailable(_Snapshot({ threadId: null }))).toBe(false);
	});

	it("is first-party and never opens deferred approval for the invocation", function _Descriptor()
	{
		expect(UPGRADE_SESSION_TOOL).toMatchObject({ name: "upgrade_session", toolRevisionId: "opencrane:personal:upgrade_session:v1", requiresApproval: false });
	});
});
