import type { RunInputSnapshot as PrismaRunInputSnapshot } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { RunInputSnapshotIdentityKinds } from "@opencrane/contracts";

import { __ProjectRuntimeInputSnapshot } from "../runtime-input-snapshot-projector";

/** Builds a complete persisted row with the JSON fields that cross the runtime wire boundary. */
function _Row(): PrismaRunInputSnapshot
{
	return {
		id: "snapshot-1",
		runId: "run-1",
		snapshotVersion: 1,
		siloId: "silo-1",
		agentServiceId: "service-1",
		agentRevisionId: "revision-1",
		effectiveContractDigest: "sha256:contract",
		personaRevisionId: null,
		conversationId: "conversation-1",
		messageIds: ["message-1"],
		preferenceFactIds: ["fact-1"],
		artifactRevisionIds: ["artifact-1"],
		retiredMemoryFacts: [],
		identitySnapshot: { kind: RunInputSnapshotIdentityKinds.User, executionSubjectId: "subject-1", executionIssuer: "issuer-1", principalId: "principal-1", fleetMembershipRevision: 1, fleetMembershipIssuer: "issuer", fleetMembershipIssuerKeyId: "key-1", fleetMembershipAssertionId: "assertion-1", fleetMembershipPayloadDigest: "sha256:membership", fleetMembershipTrustedUntil: "2026-08-29T00:01:00.000Z" },
		modelRoute: { model: "model-1" },
		mcpTools: [{ toolRevisionId: "tool-1", name: "search", description: null, inputSchema: { type: "object" }, inputSchemaDigest: "sha256:schema" }],
		skillRevisionIds: ["skill-revision-1"],
		memoryQueryPolicy: { scope: "silo" },
		budgetPolicy: { maxTokens: 100 },
		capabilitySetDigest: "sha256:capabilities",
		promptCompilerVersion: "prompt-v1",
		digest: "sha256:snapshot",
		compiledAt: new Date("2026-08-29T00:00:00.000Z"),
	};
}

describe("runtime input snapshot projector", function _DescribeRuntimeInputSnapshotProjector()
{
	it("maps the persisted snapshot JSON and timestamp without exposing persistence-only fields", function _MapsSnapshot()
	{
		const snapshot = __ProjectRuntimeInputSnapshot(_Row());

		expect(snapshot).toEqual(expect.objectContaining({ runId: "run-1", mcpTools: [{ toolRevisionId: "tool-1", name: "search", description: null, inputSchema: { type: "object" }, inputSchemaDigest: "sha256:schema" }], identitySnapshot: expect.objectContaining({ kind: RunInputSnapshotIdentityKinds.User }), compiledAt: "2026-08-29T00:00:00.000Z" }));
		expect(snapshot).not.toHaveProperty("id");
		expect(snapshot).not.toHaveProperty("retiredMemoryFacts");
	});
});
