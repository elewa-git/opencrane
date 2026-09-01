import { describe, expect, it } from "vitest";

import type { RunInputSnapshot } from "@opencrane/contracts";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { __DigestRunInputSnapshot } from "../run-input-snapshot-digest";

/** Build one complete schema-bound snapshot body without its self-referential digest. */
function _Snapshot(parametersSchema: JsonValue = { type: "object", additionalProperties: false }): Omit<RunInputSnapshot, "digest">
{
	return {
		runId: "run-1", attempt: 1, siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", snapshotVersion: 1, conversationId: null, messageIds: [], personaRevisionId: null, preferenceFactIds: [], artifactRevisionIds: [], skillRevisionIds: [], memoryQueryPolicy: {}, mcpTools: [{ toolRevisionId: "mcp-tool-revision-1", name: "query", description: "Search records", inputSchema: parametersSchema, inputSchemaDigest: ___DigestCanonicalJson(parametersSchema) }], modelRoute: {}, budgetPolicy: {}, executionSubject: { schemaVersion: 1, siloId: "silo-1", agentIdentityId: "identity-1", principalId: "principal-1", identity: { agentIdentityId: "identity-1", principalId: "principal-1", siloId: "silo-1", headRevision: "1", headDigest: `sha256:${"a".repeat(64)}`, decisionEvidenceId: "identity-decision", verifiedAt: "2026-08-01T00:00:00.000Z" }, membership: { principalId: "principal-1", siloId: "silo-1", revision: 1, assertionId: "membership", payloadDigest: `sha256:${"b".repeat(64)}`, decisionEvidenceId: "membership-decision", trustedUntil: "2099-08-02T00:00:00.000Z" }, capability: { agentIdentityId: "identity-1", computerId: "computer-1", capabilitySetDigest: `sha256:${"c".repeat(64)}`, effectiveContractDigest: `sha256:${"d".repeat(64)}`, decisionEvidenceId: "capability-decision", decidedAt: "2026-08-01T00:00:00.000Z" }, runScope: { siloId: "silo-1", runId: "run-1", attempt: 1, agentServiceId: "service-1", agentRevisionId: "revision-1" }, computerScope: { siloId: "silo-1", computerId: "computer-1", leaseId: "lease-1", leaseGeneration: 1 }, requester: { siloId: "silo-1", requesterPrincipalId: "requester-1", requestIdempotencyKey: "request-1", authenticatedAt: "2026-08-01T00:00:00.000Z" }, admission: { authorizingPrincipalId: "authorizer-1", decisionEvidenceId: "admission-decision", admittedAt: "2026-08-01T00:00:00.000Z" } }, promptCompilerVersion: "prompt-v1", compiledAt: "2026-08-01T00:00:00.000Z",
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
