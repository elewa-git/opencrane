import type { Server } from "node:http";

import { describe, expect, it, vi } from "vitest";

import { __CreateMemoryGatewayServer } from "@opencrane/backend/memory-gateway";
import type { CogneeProviderSession } from "@opencrane/backend/memory-gateway";
import { __CreateHttpCogneeMemoryGatewayClient } from "@opencrane/backend/server/infra/memory-gateway-client";
import { MemoryGatewayErrorCodes, MemoryMutationDeliveryStates } from "@opencrane/contracts";

/** Distinct provider coordinates used by the connected transport tests. */
const _DATASET = "3f6f6bd2-8a3e-4c8e-9a3f-6b1d2e4f5a6b";
const _DOCUMENT = "fbb3cf99-1b3a-486e-9308-7e31cf19e876";
const _CHUNK = "c15db69b-bf7f-4b8e-83ca-4e18d72f5b07";

/** Listen only on loopback; provider and Kubernetes identities are synthetic. */
async function _Listen(server: Server): Promise<string>
{
	await new Promise<void>(function _Start(resolve, reject)
	{
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address();
	if (address === null || typeof address === "string")
		throw new Error("Test listener has no TCP address");
	return `http://127.0.0.1:${address.port}`;
}

/** Close the temporary listener even when a contract assertion fails. */
async function _Close(server: Server): Promise<void>
{
	server.closeAllConnections();
	await new Promise<void>(function _Stop(resolve, reject)
	{
		server.close(function _Closed(error)
		{
			if (error)
				reject(error);
			else
				resolve();
		});
	});
}

/** Connect both production HTTP adapters while substituting only external identities and Cognee. */
async function _Fixture(token = "test-server-token")
{
	const exchange = vi.fn<CogneeProviderSession["exchange"]>().mockResolvedValue({
		status: 200,
		contentType: "application/json",
		body: new TextEncoder().encode(JSON.stringify([{ dataset_id: _DATASET, search_result: [{ id: _CHUNK, document_id: _DOCUMENT, text: "The office opens at eight.", score: 0.9 }] }])),
	});
	const providerSession = { ensureReady: vi.fn().mockResolvedValue(undefined), exchange };
	const tokenReviewer = { __Review: vi.fn(async function _Review(value: string) { return value === "test-server-token" ? { accepted: true } : null; }) };
	const server = __CreateMemoryGatewayServer({ providerSession, tokenReviewer, log: { error: vi.fn() } });
	const origin = await _Listen(server);
	const requestedPaths: string[] = [];
	const client = __CreateHttpCogneeMemoryGatewayClient({
		baseUrl: "http://memory-gateway.test-silo.svc.cluster.local",
		requestTimeoutMilliseconds: 1_000,
		serverTokenFile: "/unused-synthetic-token",
		readServerToken: async function _ReadToken() { return token; },
		fetch: async function _LoopbackFetch(input, init)
		{
			const url = new URL(String(input));
			requestedPaths.push(url.pathname);
			return fetch(new URL(url.pathname + url.search, origin), init);
		},
	});
	return { server, origin, client, exchange, tokenReviewer, requestedPaths };
}

describe("memory gateway and server client contract", function _Suite()
{
	it("carries a recall through both real adapters using the shared route and private Cognee translation", async function _Query()
	{
		const f = await _Fixture();
		try
		{
			const result = await f.client.query({ siloId: "test-silo", subjectId: "subject", cogneeDatasetId: _DATASET, query: "office hours", maxResults: 3 });
			expect(result).toEqual({ facts: [{ cogneeDocumentId: _DOCUMENT, cogneeChunkId: _CHUNK, content: "The office opens at eight." }] });
			expect(f.requestedPaths).toEqual(["/api/v1/memory/search"]);
			expect(f.tokenReviewer.__Review).toHaveBeenCalledWith("test-server-token");
			expect(f.exchange).toHaveBeenCalledTimes(1);
			const request = f.exchange.mock.calls[0][0];
			expect(request).toMatchObject({ method: "POST", path: "/api/v1/search" });
			expect(JSON.parse(String(request.body))).toEqual({ query: "office hours", search_type: "CHUNKS", dataset_ids: [_DATASET], top_k: 3 });
		}
		finally { await _Close(f.server); }
	});

	it("rejects another dataset through both adapters instead of reporting an empty recall", async function _WrongDataset()
	{
		const f = await _Fixture();
		try
		{
			f.exchange.mockResolvedValueOnce({ status: 200, contentType: "application/json", body: new TextEncoder().encode(JSON.stringify([{ dataset_id: _DOCUMENT, search_result: [] }])) });
			await expect(f.client.query({ siloId: "test-silo", subjectId: "subject", cogneeDatasetId: _DATASET, query: "office hours", maxResults: 3 })).rejects.toMatchObject({ error: MemoryGatewayErrorCodes.ProviderProtocol });
			expect(f.exchange).toHaveBeenCalledTimes(1);
		}
		finally { await _Close(f.server); }
	});

	it("rejects the deleted inbound search route before provider access", async function _OldRoute()
	{
		const f = await _Fixture();
		try
		{
			const response = await fetch(`${f.origin}/api/v1/search`, { method: "POST", headers: { authorization: "Bearer test-server-token" }, body: "{}" });
			expect(response.status).toBe(404);
			expect(f.exchange).not.toHaveBeenCalled();
		}
		finally { await _Close(f.server); }
	});

	it("returns a deletion receipt after read-only recovery proves the exact document is already absent", async function _RecoverDeletion()
	{
		const f = await _Fixture();
		try
		{
			f.exchange.mockResolvedValueOnce({ status: 200, contentType: "application/json", body: new TextEncoder().encode(JSON.stringify({ datasetId: _DATASET, inputEvidenceDigest: `sha256:${"a".repeat(64)}`, data: [] })) });
			f.exchange.mockResolvedValueOnce({ status: 404, contentType: "application/json", body: new TextEncoder().encode("{}") });
			const receipt = await f.client.deleteDocument({ siloId: "test-silo", subjectId: "subject" }, { datasetId: _DATASET, documentId: _DOCUMENT });
			expect(receipt).toEqual({ datasetId: _DATASET, documentId: _DOCUMENT });
			expect(f.exchange.mock.calls.map(function _Method(call) { return call[0].method; })).toEqual(["GET", "GET"]);
			expect(f.requestedPaths).toEqual([`/api/v1/memory/datasets/${_DATASET}/documents/${_DOCUMENT}`]);
		}
		finally { await _Close(f.server); }
	});

	it.each(["ensure", "delete"] as const)("reports a failed %s recovery read as proven non-delivery", async function _ReadBeforeMutation(operation)
	{
		const f = await _Fixture();
		try
		{
			f.exchange.mockResolvedValueOnce({ status: 503, contentType: "application/json", body: new TextEncoder().encode("{}") });
			const context = { siloId: "test-silo", subjectId: "subject" };
			const result = operation === "ensure"
				? f.client.ensureDataset(context, { datasetName: "opaque-memory-dataset-name-that-is-long-enough-12345" })
				: f.client.deleteDocument(context, { datasetId: _DATASET, documentId: _DOCUMENT });
			await expect(result).rejects.toMatchObject({ error: MemoryGatewayErrorCodes.ProviderUnavailable, deliveryState: MemoryMutationDeliveryStates.ProvenNotSent });
			expect(f.exchange.mock.calls.map(function _Method(call) { return call[0].method; })).toEqual(["GET"]);
		}
		finally { await _Close(f.server); }
	});

	it("carries an authentication refusal back as proven non-delivery without a provider mutation", async function _DeniedMutation()
	{
		const f = await _Fixture("wrong-token");
		try
		{
			await expect(f.client.deleteDocument({ siloId: "test-silo", subjectId: "subject" }, { datasetId: _DATASET, documentId: _DOCUMENT })).rejects.toMatchObject({ deliveryState: MemoryMutationDeliveryStates.ProvenNotSent });
			expect(f.exchange).not.toHaveBeenCalled();
		}
		finally { await _Close(f.server); }
	});
});
