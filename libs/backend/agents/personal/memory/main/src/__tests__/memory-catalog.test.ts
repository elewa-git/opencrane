import { describe, expect, it, vi } from "vitest";

import { __RecordMemoryFact } from "../memory-catalog.js";
import { __ProvisionPersonalMemoryDataset } from "../personal-memory-dataset.js";

describe("memory catalog", function ()
{
	it("records provenance metadata without accepting fact content", async function ()
	{
		const recordFactAtomically = vi.fn().mockResolvedValue({ status: "recorded" });
		const result = await __RecordMemoryFact({ recordFactAtomically }, { datasetId: "dataset-1", cogneeExternalId: "cognee-fact-1", contentDigest: `sha256:${"a".repeat(64)}`, consentState: "explicit", sensitivity: "ordinary", provenance: { questionId: "q1" }, source: { artifactRevisionId: null, messageId: "message-1", explicitUserStatement: false, explicitUserId: null }, supersedesFactId: null, recordedBy: "user-1", idempotencyKey: "fact-1" });
		expect(result).toEqual({ outcome: "recorded", idempotent: false });
		expect(recordFactAtomically).toHaveBeenCalledOnce();
	});

	it("rejects ambiguous provenance", async function ()
	{
		const recordFactAtomically = vi.fn();
		const result = await __RecordMemoryFact({ recordFactAtomically }, { datasetId: "dataset-1", cogneeExternalId: "cognee-fact-1", contentDigest: `sha256:${"a".repeat(64)}`, consentState: "explicit", sensitivity: "ordinary", provenance: {}, source: { artifactRevisionId: "artifact-revision-1", messageId: "message-1", explicitUserStatement: false, explicitUserId: null }, supersedesFactId: null, recordedBy: "user-1", idempotencyKey: "fact-1" });
		expect(result).toEqual({ outcome: "denied", reason: "invalid_command" });
		expect(recordFactAtomically).not.toHaveBeenCalled();
	});

	it("requires the explicit-user provenance marker for an explicit statement", async function ()
	{
		const recordFactAtomically = vi.fn();
		const result = await __RecordMemoryFact({ recordFactAtomically }, { datasetId: "dataset-1", cogneeExternalId: "cognee-fact-1", contentDigest: `sha256:${"a".repeat(64)}`, consentState: "explicit", sensitivity: "ordinary", provenance: { sourceKind: "explicit-user-fact" }, source: { artifactRevisionId: null, messageId: null, explicitUserStatement: true, explicitUserId: "user-1" }, supersedesFactId: null, recordedBy: "user-1", idempotencyKey: "fact-1" });
		expect(result).toEqual({ outcome: "denied", reason: "invalid_command" });
		expect(recordFactAtomically).not.toHaveBeenCalled();
	});

	it("rejects a database-ambiguous explicit marker beside an artifact source", async function ()
	{
		const recordFactAtomically = vi.fn();
		const result = await __RecordMemoryFact({ recordFactAtomically }, { datasetId: "dataset-1", cogneeExternalId: "cognee-fact-1", contentDigest: `sha256:${"a".repeat(64)}`, consentState: "explicit", sensitivity: "ordinary", provenance: { user_statement: true }, source: { artifactRevisionId: "artifact-revision-1", messageId: null, explicitUserStatement: false, explicitUserId: null }, supersedesFactId: null, recordedBy: "user-1", idempotencyKey: "fact-1" });
		expect(result).toEqual({ outcome: "denied", reason: "invalid_command" });
		expect(recordFactAtomically).not.toHaveBeenCalled();
	});

	it("rejects an explicit statement whose provenance names a different user", async function ()
	{
		const recordFactAtomically = vi.fn();
		const result = await __RecordMemoryFact({ recordFactAtomically }, { datasetId: "dataset-1", cogneeExternalId: "cognee-fact-1", contentDigest: `sha256:${"a".repeat(64)}`, consentState: "explicit", sensitivity: "ordinary", provenance: { user_statement: true, sourceKind: "explicit-user-fact", sourceUserId: "user-2" }, source: { artifactRevisionId: null, messageId: null, explicitUserStatement: true, explicitUserId: "user-1" }, supersedesFactId: null, recordedBy: "user-1", idempotencyKey: "fact-1" });
		expect(result).toEqual({ outcome: "denied", reason: "invalid_command" });
		expect(recordFactAtomically).not.toHaveBeenCalled();
	});
});

describe("personal memory dataset provisioner", function _provisionSuite()
{
	it("registers only a complete verified scope and preserves exact replay success", async function _provisions()
	{
		const provisionPersonalDatasetAtomically = vi.fn().mockResolvedValue({ status: "provisioned" });
		const command = { siloId: "silo-1", organizationId: "org-1", subjectId: "user-1", cogneeDatasetId: "cognee-dataset-1", createdBy: "user-1" };
		await expect(__ProvisionPersonalMemoryDataset({ provisionPersonalDatasetAtomically }, command)).resolves.toEqual({ outcome: "provisioned", idempotent: false });
		provisionPersonalDatasetAtomically.mockResolvedValue({ status: "idempotent" });
		await expect(__ProvisionPersonalMemoryDataset({ provisionPersonalDatasetAtomically }, command)).resolves.toEqual({ outcome: "provisioned", idempotent: true });
	});

	it("rejects a provision request whose initiator is not the personal dataset owner", async function _rejectsUntrustedOwner()
	{
		const provisionPersonalDatasetAtomically = vi.fn();
		await expect(__ProvisionPersonalMemoryDataset({ provisionPersonalDatasetAtomically }, { siloId: "silo-1", organizationId: "org-1", subjectId: "user-1", cogneeDatasetId: "cognee-dataset-1", createdBy: "operator-1" })).resolves.toEqual({ outcome: "denied", reason: "invalid_command" });
		expect(provisionPersonalDatasetAtomically).not.toHaveBeenCalled();
	});
});
