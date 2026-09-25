import { describe, expect, it, vi } from "vitest";
import request from "supertest";

import { MEMORY_GATEWAY_ROUTE_PATHS, MemoryGatewayErrorCodes, MemoryMutationDeliveryStates } from "@opencrane/contracts";

import { MemoryGatewayProviderMutationError, MemoryGatewayProviderReadError } from "../../provider/operations/memory-gateway-provider-error";
import type { MemoryGatewayProviderOperations } from "../../provider/operations/memory-gateway-provider-operations.types";
import { __CreateMemoryGatewayServer } from "../memory-gateway-server";

/** Distinct coordinates accepted by the shared wire contract. */
const _DATASET = "3f6f6bd2-8a3e-4c8e-9a3f-6b1d2e4f5a6b";
const _DOCUMENT = "fbb3cf99-1b3a-486e-9308-7e31cf19e876";
const _OPERATION = "6a2345a9-4977-4bea-b7fd-134633125002";
const _PIPELINE = "fa71b5bc-6385-4f82-a4b9-6df1f9d59271";
const _NAME = "opaque-memory-dataset-name-with-at-least-43-characters";
const _DIGEST = `sha256:${"a".repeat(64)}`;
const _DELETE = `/api/v1/memory/datasets/${_DATASET}/documents/${_DOCUMENT}`;

/** Provide typed receipt-producing operations so HTTP tests cannot accidentally contact Cognee. */
function _Operations(): MemoryGatewayProviderOperations
{
	return {
		ensureDataset: vi.fn().mockResolvedValue({ dataset: { datasetId: _DATASET, datasetName: _NAME } }),
		listDatasets: vi.fn().mockResolvedValue({ datasets: [] }),
		addDocument: vi.fn().mockResolvedValue({ datasetId: _DATASET, documentId: _DOCUMENT, contentDigest: _DIGEST }),
		listDocuments: vi.fn().mockResolvedValue({ datasetId: _DATASET, inputEvidenceDigest: _DIGEST, documents: [] }),
		readDocumentDigest: vi.fn().mockResolvedValue({ datasetId: _DATASET, documentId: _DOCUMENT, contentDigest: _DIGEST, byteLength: 4 }),
		cognifyDataset: vi.fn().mockResolvedValue({ datasetId: _DATASET, operationId: _OPERATION, inputEvidenceDigest: _DIGEST, pipelineRunId: _PIPELINE }),
		search: vi.fn().mockResolvedValue({ datasetId: _DATASET, facts: [] }),
		deleteDocument: vi.fn().mockResolvedValue({ datasetId: _DATASET, documentId: _DOCUMENT }),
	};
}

/** Construct the existing server around synthetic workload review and provider ports. */
function _Fixture(accepted = true)
{
	const operations = _Operations();
	const providerSession = { ensureReady: vi.fn().mockResolvedValue(undefined), exchange: vi.fn() };
	const tokenReviewer = { __Review: vi.fn().mockResolvedValue(accepted ? { username: "expected-server" } : null) };
	const log = { error: vi.fn() };
	const server = __CreateMemoryGatewayServer({ providerSession, providerOperations: operations, tokenReviewer, log });
	return { server, operations, providerSession, tokenReviewer, log };
}

/** Each shared POST route has exactly one provider operation and one delivery category. */
const _POSTS = [
	{ key: "ensureDataset", path: MEMORY_GATEWAY_ROUTE_PATHS.DatasetEnsure, mutation: true, body: { datasetName: _NAME } },
	{ key: "listDatasets", path: MEMORY_GATEWAY_ROUTE_PATHS.DatasetList, mutation: false, body: { datasetName: _NAME } },
	{ key: "addDocument", path: MEMORY_GATEWAY_ROUTE_PATHS.DocumentAdd, mutation: true, body: { datasetId: _DATASET, content: "fact", contentDigest: _DIGEST } },
	{ key: "listDocuments", path: MEMORY_GATEWAY_ROUTE_PATHS.DocumentList, mutation: false, body: { datasetId: _DATASET } },
	{ key: "readDocumentDigest", path: MEMORY_GATEWAY_ROUTE_PATHS.DocumentRawDigest, mutation: false, body: { datasetId: _DATASET, documentId: _DOCUMENT } },
	{ key: "cognifyDataset", path: MEMORY_GATEWAY_ROUTE_PATHS.DatasetCognify, mutation: true, body: { datasetId: _DATASET, operationId: _OPERATION, expectedInputEvidenceDigest: _DIGEST } },
	{ key: "search", path: MEMORY_GATEWAY_ROUTE_PATHS.Search, mutation: false, body: { datasetId: _DATASET, query: "fact", topK: 3 } },
] as const;

describe("private memory gateway HTTP boundary", function _Suite()
{
	it("keeps liveness local and checks the existing provider session for readiness", async function _Health()
	{
		const f = _Fixture();
		expect((await request(f.server).get("/livez")).status).toBe(204);
		expect(f.providerSession.ensureReady).not.toHaveBeenCalled();
		expect((await request(f.server).get("/readyz")).status).toBe(204);
		f.providerSession.ensureReady.mockRejectedValue(new Error("private login failure"));
		expect((await request(f.server).get("/readyz")).body).toEqual({ error: MemoryGatewayErrorCodes.ProviderUnavailable });
		expect(JSON.stringify(f.log.error.mock.calls)).not.toContain("private login failure");
	});

	it.each(_POSTS)("binds $key to its authenticated shared request and validates its receipt", async function _Post(row)
	{
		const f = _Fixture();
		const result = await request(f.server).post(row.path).set("authorization", "Bearer projected-token").send(row.body);
		expect(result.status).toBe(200);
		expect(f.operations[row.key]).toHaveBeenCalledWith(row.body, expect.any(AbortSignal));
		expect(f.operations[row.key]).toHaveBeenCalledTimes(1);
		expect(f.tokenReviewer.__Review).toHaveBeenCalledWith("projected-token");
		expect(f.providerSession.exchange).not.toHaveBeenCalled();
	});

	it.each(_POSTS)("refuses $key before parsing unauthorized bytes and reports its delivery category", async function _Unauthorized(row)
	{
		const f = _Fixture(false);
		const response = await request(f.server).post(row.path).set("authorization", "Bearer wrong-token").type("json").send("not json");
		expect(response.status).toBe(401);
		const body = row.mutation ? { error: MemoryGatewayErrorCodes.Unauthorized, deliveryState: MemoryMutationDeliveryStates.ProvenNotSent } : { error: MemoryGatewayErrorCodes.Unauthorized };
		expect(response.body).toEqual(body);
		expect(f.operations[row.key]).not.toHaveBeenCalled();
	});

	it.each(_POSTS)("rejects extra $key fields and wrong HTTP methods without a provider call", async function _Invalid(row)
	{
		const f = _Fixture();
		const response = await request(f.server).post(row.path).set("authorization", "Bearer token").send({ ...row.body, subjectId: "browser-subject" });
		expect(response.status).toBe(422);
		expect(response.body.deliveryState).toBe(row.mutation ? MemoryMutationDeliveryStates.ProvenNotSent : undefined);
		expect((await request(f.server).get(row.path).set("authorization", "Bearer token")).status).toBe(404);
		expect(f.operations[row.key]).not.toHaveBeenCalled();
	});

	it("takes deletion coordinates from the path and refuses body and malformed coordinates", async function _Delete()
	{
		const f = _Fixture();
		const response = await request(f.server).delete(_DELETE).set("authorization", "Bearer token");
		expect(response.body).toEqual({ datasetId: _DATASET, documentId: _DOCUMENT });
		expect(f.operations.deleteDocument).toHaveBeenCalledWith({ datasetId: _DATASET, documentId: _DOCUMENT }, expect.any(AbortSignal));
		expect((await request(f.server).delete(_DELETE).set("authorization", "Bearer token").send({ datasetId: _DATASET })).status).toBe(422);
		expect((await request(f.server).delete(_DELETE.replace(_DOCUMENT, "invalid")).set("authorization", "Bearer token")).status).toBe(422);
		expect(f.operations.deleteDocument).toHaveBeenCalledTimes(1);
	});

	it("reports a rejected deletion as proven non-delivery", async function _DeleteRefusal()
	{
		const f = _Fixture(false);
		const response = await request(f.server).delete(_DELETE).set("authorization", "Bearer wrong-token");
		expect(response.status).toBe(401);
		expect(response.body).toEqual({ error: MemoryGatewayErrorCodes.Unauthorized, deliveryState: MemoryMutationDeliveryStates.ProvenNotSent });
		expect(f.operations.deleteDocument).not.toHaveBeenCalled();
	});

	it("removes the old inbound search route and hides unknown routes", async function _OldPath()
	{
		const f = _Fixture();
		expect((await request(f.server).post("/api/v1/search").send({})).status).toBe(404);
		expect((await request(f.server).post("/api/v1/add").send({})).status).toBe(404);
		expect(f.tokenReviewer.__Review).not.toHaveBeenCalled();
		expect(f.operations.search).not.toHaveBeenCalled();
	});

	it("preserves provider mutation ambiguity and fixed error codes without private details", async function _MutationFailure()
	{
		const f = _Fixture();
		vi.mocked(f.operations.deleteDocument).mockRejectedValueOnce(new MemoryGatewayProviderMutationError(MemoryGatewayErrorCodes.Conflict, MemoryMutationDeliveryStates.ProvenNotSent));
		expect((await request(f.server).delete(_DELETE).set("authorization", "Bearer token")).body).toEqual({ error: MemoryGatewayErrorCodes.Conflict, deliveryState: MemoryMutationDeliveryStates.ProvenNotSent });
		vi.mocked(f.operations.deleteDocument).mockRejectedValueOnce(new Error("private provider body"));
		const unknown = await request(f.server).delete(_DELETE).set("authorization", "Bearer token");
		expect(unknown.body).toEqual({ error: MemoryGatewayErrorCodes.ProviderUnavailable, deliveryState: MemoryMutationDeliveryStates.Ambiguous });
		expect(JSON.stringify(f.log.error.mock.calls)).not.toContain("private provider body");
	});

	it("validates successful receipts before sending them and separates read failures from mutation failures", async function _ResponseValidation()
	{
		const f = _Fixture();
		vi.mocked(f.operations.deleteDocument).mockResolvedValueOnce({ datasetId: _DATASET, documentId: "bad" });
		expect((await request(f.server).delete(_DELETE).set("authorization", "Bearer token")).body).toEqual({ error: MemoryGatewayErrorCodes.ProviderProtocol, deliveryState: MemoryMutationDeliveryStates.Ambiguous });
		vi.mocked(f.operations.search).mockRejectedValueOnce(new MemoryGatewayProviderReadError(MemoryGatewayErrorCodes.NotFound));
		expect((await request(f.server).post(MEMORY_GATEWAY_ROUTE_PATHS.Search).set("authorization", "Bearer token").send({ datasetId: _DATASET, query: "fact", topK: 3 })).body).toEqual({ error: MemoryGatewayErrorCodes.NotFound });
	});

	it("rejects oversized and malformed bodies before mutation dispatch", async function _BodyLimits()
	{
		const f = _Fixture();
		for (const body of ["not json", JSON.stringify({ content: "x".repeat(1024 * 1024 + 1) })])
		{
			const response = await request(f.server).post(MEMORY_GATEWAY_ROUTE_PATHS.DocumentAdd).set("authorization", "Bearer token").type("json").send(body);
			expect(response.body).toEqual({ error: MemoryGatewayErrorCodes.InvalidRequest, deliveryState: MemoryMutationDeliveryStates.ProvenNotSent });
		}
		expect(f.operations.addDocument).not.toHaveBeenCalled();
	});
});
