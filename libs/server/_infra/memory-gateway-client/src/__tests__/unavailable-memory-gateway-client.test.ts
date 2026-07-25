import { describe, expect, it } from "vitest";

import { __AssertMemoryProvenanceComplete, MemoryProvenanceIncompleteError } from "../memory-provenance.js";
import { __AssertPersonalMemoryRecordResult, MemoryGatewayProtocolError } from "../personal-memory-record.js";
import type { MemoryProvenance } from "../memory-gateway-client.types.js";
import { __UnavailableMemoryGatewayClient, MemoryGatewayUnavailableError } from "../unavailable-memory-gateway-client.js";

/** Builds complete provenance for a central-agent scoped write. */
function _provenance(overrides: Partial<MemoryProvenance> = {}): MemoryProvenance
{
	return { centralAgentId: "svc-1", agentRevisionId: "rev-1", runId: "run-1", recordedAt: "2026-07-01T00:00:00.000Z", sourceRef: "slack:C123/ts", ...overrides };
}

describe("unavailable memory gateway client", function _suite()
{
	it("fails closed instead of returning an empty recall", async function _query()
	{
		const client = new __UnavailableMemoryGatewayClient();
		await expect(client.query({ siloId: "silo-1", subjectId: "subject-1", query: "what do I know", maxResults: 5 })).rejects.toBeInstanceOf(MemoryGatewayUnavailableError);
	});

	it("fails closed rather than minting a personal-memory fact identifier", async function _recordPersonalFact()
	{
		const client = new __UnavailableMemoryGatewayClient();
		await expect(client.recordPersonalFact({ siloId: "silo-1", subjectId: "user-1", cogneeDatasetId: "cognee-personal-user-1", content: "Use UK spelling", idempotencyKey: "interview-1:answer-1" })).rejects.toBeInstanceOf(MemoryGatewayUnavailableError);
	});

	it("fails closed rather than pretending a correction landed", async function _correct()
	{
		const client = new __UnavailableMemoryGatewayClient();
		await expect(client.correct({ siloId: "silo-1", subjectId: "subject-1", factId: "fact-1", correctedContent: "corrected" })).rejects.toBeInstanceOf(MemoryGatewayUnavailableError);
	});

	it("fails closed rather than pretending a fact was forgotten", async function _forget()
	{
		const client = new __UnavailableMemoryGatewayClient();
		await expect(client.forget({ siloId: "silo-1", subjectId: "subject-1", factId: "fact-1" })).rejects.toBeInstanceOf(MemoryGatewayUnavailableError);
	});

	it("fails closed on scoped recall", async function _recallScoped()
	{
		const client = new __UnavailableMemoryGatewayClient();
		await expect(client.recallScoped({ siloId: "silo-1", scope: "project", subjectType: "group", subjectId: "proj-1", query: "q", maxResults: 5 })).rejects.toBeInstanceOf(MemoryGatewayUnavailableError);
	});

	it("enforces complete provenance BEFORE failing closed on a scoped write", async function _injectScoped()
	{
		const client = new __UnavailableMemoryGatewayClient();
		// Missing provenance is a provenance error, not a gateway-unavailable error.
		await expect(client.injectScoped({ siloId: "silo-1", scope: "project", subjectType: "group", subjectId: "proj-1", content: "fact", provenance: _provenance({ runId: "" }) })).rejects.toBeInstanceOf(MemoryProvenanceIncompleteError);
		// Complete provenance still fails closed because no transport is configured.
		await expect(client.injectScoped({ siloId: "silo-1", scope: "project", subjectType: "group", subjectId: "proj-1", content: "fact", provenance: _provenance() })).rejects.toBeInstanceOf(MemoryGatewayUnavailableError);
	});
});

describe("memory provenance guard", function _provenanceSuite()
{
	it("accepts complete provenance", function _accepts()
	{
		expect(() => __AssertMemoryProvenanceComplete(_provenance())).not.toThrow();
	});

	it("rejects any missing or non-ISO field", function _rejects()
	{
		expect(() => __AssertMemoryProvenanceComplete(_provenance({ centralAgentId: "" }))).toThrow(MemoryProvenanceIncompleteError);
		expect(() => __AssertMemoryProvenanceComplete(_provenance({ sourceRef: "  " }))).toThrow(MemoryProvenanceIncompleteError);
		expect(() => __AssertMemoryProvenanceComplete(_provenance({ recordedAt: "not-a-date" }))).toThrow(MemoryProvenanceIncompleteError);
	});
});

describe("personal-memory record response guard", function _recordResponseSuite()
{
	it("accepts canonical gateway evidence and the explicit idempotency collision", function _accepts()
	{
		expect(() => __AssertPersonalMemoryRecordResult({ outcome: "recorded", idempotent: false, cogneeExternalId: "gateway-fact-1", contentDigest: `sha256:${"a".repeat(64)}` })).not.toThrow();
		expect(() => __AssertPersonalMemoryRecordResult({ outcome: "denied", reason: "idempotency_conflict" })).not.toThrow();
	});

	it("rejects noncanonical gateway digest evidence", function _rejects()
	{
		expect(() => __AssertPersonalMemoryRecordResult({ outcome: "recorded", idempotent: true, cogneeExternalId: "gateway-fact-1", contentDigest: "a".repeat(64) })).toThrow(MemoryGatewayProtocolError);
		expect(() => __AssertPersonalMemoryRecordResult({ outcome: "unexpected", idempotent: true, cogneeExternalId: "gateway-fact-1", contentDigest: `sha256:${"a".repeat(64)}` })).toThrow(MemoryGatewayProtocolError);
		expect(() => __AssertPersonalMemoryRecordResult({ outcome: "recorded", idempotent: false, cogneeExternalId: " ", contentDigest: `sha256:${"a".repeat(64)}` })).toThrow(MemoryGatewayProtocolError);
	});
});
