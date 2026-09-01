import type { Prisma, RunInputSnapshot as PrismaRunInputSnapshot } from "@prisma/client";
import { describe, expect, it } from "vitest";

import type { ExecutionSubject } from "@opencrane/contracts";

import { __ProjectRuntimeInputSnapshot } from "../runtime-input-snapshot-projector";

/** Builds a complete persisted row with the JSON fields that cross the runtime wire boundary. */
function _Row(): PrismaRunInputSnapshot
{
	const executionSubject = _ExecutionSubject();
	return {
		id: "snapshot-1",
		runId: "run-1",
		attempt: 1,
		snapshotVersion: 1,
		siloId: "silo-1",
		agentServiceId: "service-1",
		agentRevisionId: "revision-1",
		agentIdentityId: executionSubject.agentIdentityId,
		principalId: executionSubject.principalId,
		executionSubject: executionSubject as unknown as Prisma.JsonValue,
		personaRevisionId: null,
		conversationId: "conversation-1",
		messageIds: ["message-1"],
		preferenceFactIds: ["fact-1"],
		artifactRevisionIds: ["artifact-1"],
		retiredMemoryFacts: [],
		modelRoute: { model: "model-1" },
		mcpTools: [{ toolRevisionId: "tool-1", name: "search", description: null, inputSchema: { type: "object" }, inputSchemaDigest: "sha256:schema" }],
		skillRevisionIds: ["skill-revision-1"],
		memoryQueryPolicy: { scope: "silo" },
		budgetPolicy: { maxTokens: 100 },
		promptCompilerVersion: "prompt-v1",
		digest: "sha256:snapshot",
		compiledAt: new Date("2026-08-29T00:00:00.000Z"),
	};
}

/** Builds one fully-bound execution subject accepted by the target runtime wire contract. */
function _ExecutionSubject(): ExecutionSubject
{
	return {
		schemaVersion: 1,
		siloId: "silo-1",
		agentIdentityId: "identity-1",
		principalId: "principal-1",
		identity: { agentIdentityId: "identity-1", principalId: "principal-1", siloId: "silo-1", headRevision: "1", headDigest: `sha256:${"a".repeat(64)}`, decisionEvidenceId: "identity-decision-1", verifiedAt: "2026-08-29T00:00:00.000Z" },
		membership: { principalId: "principal-1", siloId: "silo-1", revision: 1, assertionId: "membership-1", payloadDigest: `sha256:${"b".repeat(64)}`, decisionEvidenceId: "membership-decision-1", trustedUntil: "2099-08-29T00:00:00.000Z" },
		capability: { agentIdentityId: "identity-1", computerId: "computer-1", capabilitySetDigest: `sha256:${"c".repeat(64)}`, effectiveContractDigest: `sha256:${"d".repeat(64)}`, decisionEvidenceId: "capability-decision-1", decidedAt: "2026-08-29T00:00:00.000Z" },
		runScope: { siloId: "silo-1", runId: "run-1", attempt: 1, agentServiceId: "service-1", agentRevisionId: "revision-1" },
		computerScope: { siloId: "silo-1", computerId: "computer-1", leaseId: "lease-1", leaseGeneration: 1 },
		requester: { siloId: "silo-1", requesterPrincipalId: "principal-1", requestIdempotencyKey: "request-1", authenticatedAt: "2026-08-29T00:00:00.000Z" },
		admission: { authorizingPrincipalId: "principal-1", decisionEvidenceId: "admission-decision-1", admittedAt: "2026-08-29T00:00:00.000Z" },
	};
}

describe("runtime input snapshot projector", function _DescribeRuntimeInputSnapshotProjector()
{
	it("maps the persisted snapshot JSON and timestamp without exposing persistence-only fields", function _MapsSnapshot()
	{
		const snapshot = __ProjectRuntimeInputSnapshot(_Row());

		expect(snapshot).toEqual(expect.objectContaining({ runId: "run-1", attempt: 1, mcpTools: [{ toolRevisionId: "tool-1", name: "search", description: null, inputSchema: { type: "object" }, inputSchemaDigest: "sha256:schema" }], executionSubject: expect.objectContaining({ agentIdentityId: "identity-1", principalId: "principal-1" }), compiledAt: "2026-08-29T00:00:00.000Z" }));
		expect(snapshot).not.toHaveProperty("id");
		expect(snapshot).not.toHaveProperty("retiredMemoryFacts");
	});
});
