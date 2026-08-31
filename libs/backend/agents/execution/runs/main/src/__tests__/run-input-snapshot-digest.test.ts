import { describe, expect, it } from "vitest";

import { RunInputSnapshotIdentityKinds, type RunInputSnapshot } from "@opencrane/contracts";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { __DigestRunInputSnapshot } from "../run-input-snapshot-digest";

/** Build one complete schema-bound snapshot body without its self-referential digest. */
function _Snapshot(parametersSchema: JsonValue = { type: "object", additionalProperties: false }): Omit<RunInputSnapshot, "digest">
{
	return {
		runId: "run-1", siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", snapshotVersion: 1, conversationId: null, messageIds: [], personaRevisionId: null, preferenceFactIds: [], artifactRevisionIds: [], skillRevisionIds: [], memoryQueryPolicy: {}, mcpTools: [{ toolRevisionId: "mcp-tool-revision-1", name: "query", description: "Search records", inputSchema: parametersSchema, inputSchemaDigest: ___DigestCanonicalJson(parametersSchema) }], modelRoute: {}, budgetPolicy: {}, identitySnapshot: { kind: RunInputSnapshotIdentityKinds.Service, executionSubjectId: "agent-service:service-1", agentServiceId: "service-1", effectiveBoundaryAttachments: [], effectiveBoundaryAttachmentDigest: "sha256:scope", fleetMembershipRevision: 1, fleetMembershipIssuer: "issuer", fleetMembershipIssuerKeyId: "key", fleetMembershipAssertionId: "assertion", fleetMembershipPayloadDigest: "sha256:membership", fleetMembershipTrustedUntil: "2026-08-02T00:00:00.000Z" }, capabilitySetDigest: "sha256:capability", effectiveContractDigest: "sha256:contract", promptCompilerVersion: "prompt-v1", compiledAt: "2026-08-01T00:00:00.000Z",
	};
}

describe("run input snapshot digest", function _RunInputSnapshotDigestSuite()
{
	it("is idempotent and changes when the frozen tool schema changes", function _BindsToolSchema()
	{
		const first = __DigestRunInputSnapshot(_Snapshot());
		const second = __DigestRunInputSnapshot(_Snapshot());
		const changed = __DigestRunInputSnapshot(_Snapshot({ type: "object", additionalProperties: true }));

		expect(second).toBe(first);
		expect(changed).not.toBe(first);
	});
});
