import { MemoryGatewayErrorCodes, MemoryMutationDeliveryStates } from "@opencrane/contracts";
import { describe, expect, it } from "vitest";

import { MemoryGatewayReadFailure } from "../memory-gateway-errors";
import type { MemoryGatewayOperationContext, MemoryProvenance } from "../memory-gateway-client.types";
import { __AssertMemoryProvenanceComplete, MemoryProvenanceIncompleteError } from "../memory-provenance";
import { __UnavailableMemoryGatewayClient, MemoryGatewayUnavailableError } from "../unavailable-memory-gateway-client";

const _CONTEXT: MemoryGatewayOperationContext = { siloId: "silo-1", subjectId: "subject-1" };
const _DATASET_ID = "11111111-1111-4111-8111-111111111111";
const _DOCUMENT_ID = "22222222-2222-4222-8222-222222222222";
const _OPERATION_ID = "33333333-3333-4333-8333-333333333333";
const _DATASET_NAME = "memory_dataset_012345678901234567890123456789";
const _DIGEST = `sha256:${"a".repeat(64)}`;

/** Builds complete provenance for a shared-scope write. */
function _Provenance(overrides: Partial<MemoryProvenance> = {}): MemoryProvenance
{
	return { centralAgentId: "svc-1", agentRevisionId: "rev-1", runId: "run-1", recordedAt: "2026-07-01T00:00:00.000Z", sourceRef: "slack:C123/ts", ...overrides };
}

describe("unavailable memory gateway client", function _Suite()
{
	it("fails every read without mutation delivery evidence", async function _Reads()
	{
		const client = new __UnavailableMemoryGatewayClient();
		const reads = [
			client.query({ siloId: "silo-1", cogneeDatasetId: _DATASET_ID, subjectId: "subject-1", query: "q", maxResults: 5 }),
			client.listDatasets(_CONTEXT, { datasetName: _DATASET_NAME }),
			client.listDocuments(_CONTEXT, { datasetId: _DATASET_ID }),
			client.readDocumentDigest(_CONTEXT, { datasetId: _DATASET_ID, documentId: _DOCUMENT_ID }),
			client.recallScoped({ siloId: "silo-1", cogneeDatasetId: _DATASET_ID, query: "q", maxResults: 5 }),
		];
		for (const read of reads)
		{
			const failure = await read.catch(function _Capture(error: unknown) { return error; });
			expect(failure).toBeInstanceOf(MemoryGatewayReadFailure);
			expect(failure).toMatchObject({ error: MemoryGatewayErrorCodes.ProviderUnavailable });
			expect(failure).not.toHaveProperty("deliveryState");
		}
	});

	it("fails every single-step mutation as proven not sent", async function _Mutations()
	{
		const client = new __UnavailableMemoryGatewayClient();
		const mutations = [
			client.ensureDataset(_CONTEXT, { datasetName: _DATASET_NAME }),
			client.addDocument(_CONTEXT, { datasetId: _DATASET_ID, content: "fact", contentDigest: _DIGEST }),
			client.cognifyDataset(_CONTEXT, { datasetId: _DATASET_ID, operationId: _OPERATION_ID, expectedInputEvidenceDigest: _DIGEST }),
			client.deleteDocument(_CONTEXT, { datasetId: _DATASET_ID, documentId: _DOCUMENT_ID }),
		];
		for (const mutation of mutations)
		{
			const failure = await mutation.catch(function _Capture(error: unknown) { return error; });
			expect(failure).toBeInstanceOf(MemoryGatewayUnavailableError);
			expect(failure).toMatchObject({ error: MemoryGatewayErrorCodes.ProviderUnavailable, deliveryState: MemoryMutationDeliveryStates.ProvenNotSent });
		}
	});

	it("enforces complete provenance before failing closed on scoped injection", async function _ScopedWrite()
	{
		const client = new __UnavailableMemoryGatewayClient();
		await expect(client.injectScoped({ siloId: "silo-1", cogneeDatasetId: _DATASET_ID, content: "fact", provenance: _Provenance({ runId: "" }) })).rejects.toBeInstanceOf(MemoryProvenanceIncompleteError);
		await expect(client.injectScoped({ siloId: "silo-1", cogneeDatasetId: _DATASET_ID, content: "fact", provenance: _Provenance() })).rejects.toMatchObject({ deliveryState: MemoryMutationDeliveryStates.ProvenNotSent });
	});
});

describe("memory provenance guard", function _ProvenanceSuite()
{
	it("accepts complete provenance and rejects missing or invalid fields", function _Validate()
	{
		expect(() => __AssertMemoryProvenanceComplete(_Provenance())).not.toThrow();
		expect(() => __AssertMemoryProvenanceComplete(_Provenance({ centralAgentId: "" }))).toThrow(MemoryProvenanceIncompleteError);
		expect(() => __AssertMemoryProvenanceComplete(_Provenance({ sourceRef: "  " }))).toThrow(MemoryProvenanceIncompleteError);
		expect(() => __AssertMemoryProvenanceComplete(_Provenance({ recordedAt: "not-a-date" }))).toThrow(MemoryProvenanceIncompleteError);
	});
});
