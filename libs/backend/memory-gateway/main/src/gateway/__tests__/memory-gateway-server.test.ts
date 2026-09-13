import { describe, expect, it, vi } from "vitest";
import request from "supertest";

import type { CogneeProviderSession } from "../../provider/auth/cognee-provider-session.types";
import type { CogneeProviderHttpCommand, CogneeProviderHttpResponse } from "../../provider/http/cognee-provider-http.types";
import { __CreateMemoryGatewayServer } from "../memory-gateway-server";
import type { MemoryGatewayServerOptions } from "../memory-gateway-server.types";

/** Valid dataset UUID used by the private search boundary. */
const _DATASET_UUID = "3f6f6bd2-8a3e-4c8e-9a3f-6b1d2e4f5a6b";

/** Valid provider chunk projected by the gateway. */
const _CHUNK = { id: "c15db69b-bf7f-4b8e-83ca-4e18d72f5b07", document_id: "fbb3cf99-1b3a-486e-9308-7e31cf19e876", text: "known fact" };

/** Encode one authenticated provider response. */
function _ProviderResponse(value: unknown, status = 200): CogneeProviderHttpResponse
{
	return { status, contentType: "application/json", body: new TextEncoder().encode(JSON.stringify(value)) };
}

/** Build the complete private server dependencies with one intended override. */
function _Options(overrides: Partial<MemoryGatewayServerOptions> = {}): MemoryGatewayServerOptions
{
	const providerSession: CogneeProviderSession = {
		ensureReady: vi.fn(async function _ready() {}),
		exchange: vi.fn(async function _exchange() { return _ProviderResponse([{ dataset_id: _DATASET_UUID, search_result: [_CHUNK] }]); }),
	};
	return {
		providerSession,
		tokenReviewer: { __Review: vi.fn(async function _review() { return { username: "expected-server" }; }) },
		log: { error: vi.fn() },
		...overrides,
	};
}

/** Submit one valid private search request. */
function _Search(server: ReturnType<typeof __CreateMemoryGatewayServer>)
{
	return request(server).post("/api/v1/search").set("authorization", "Bearer projected-token").send({ query: "known facts", search_type: "CHUNKS", dataset_ids: [_DATASET_UUID.toUpperCase()], top_k: 5 });
}

describe("private memory gateway", function _suite()
{
	it("keeps liveness local and binds readiness to the provider login", async function _health()
	{
		const options = _Options();
		const server = __CreateMemoryGatewayServer(options);
		await expect(request(server).get("/livez")).resolves.toMatchObject({ status: 204 });
		expect(options.providerSession.ensureReady).not.toHaveBeenCalled();
		await expect(request(server).get("/readyz")).resolves.toMatchObject({ status: 204 });
		expect(options.providerSession.ensureReady).toHaveBeenCalledOnce();
	});

	it("reports unavailable when the provider session cannot authenticate", async function _unready()
	{
		const providerSession = _Options().providerSession;
		vi.mocked(providerSession.ensureReady).mockRejectedValue(new Error("synthetic credential detail"));
		const options = _Options({ providerSession });
		await expect(request(__CreateMemoryGatewayServer(options)).get("/readyz")).resolves.toMatchObject({ status: 503, body: { error: "memory_gateway_unavailable" } });
		expect(options.log.error).toHaveBeenCalledWith(expect.objectContaining({ err: expect.objectContaining({ message: "memory_gateway_unavailable" }) }), "memory gateway request failed");
	});

	it("rejects another workload before reading or forwarding bytes", async function _rejectsWrongServer()
	{
		const options = _Options({ tokenReviewer: { __Review: vi.fn(async function _review() { return null; }) } });
		await expect(_Search(__CreateMemoryGatewayServer(options))).resolves.toMatchObject({ status: 401 });
		expect(options.providerSession.exchange).not.toHaveBeenCalled();
	});

	it("sends one canonical request and returns only chunks from the matching dataset", async function _forwards()
	{
		const options = _Options();
		await expect(_Search(__CreateMemoryGatewayServer(options))).resolves.toMatchObject({ status: 200, body: [_CHUNK] });
		expect(options.providerSession.exchange).toHaveBeenCalledOnce();
		const command = vi.mocked(options.providerSession.exchange).mock.calls[0]![0] as CogneeProviderHttpCommand;
		expect(command.path).toBe("/api/v1/search");
		expect(command.headers).toEqual({ "content-type": "application/json" });
		expect(JSON.parse(new TextDecoder().decode(command.body as Uint8Array))).toEqual({ query: "known facts", search_type: "CHUNKS", dataset_ids: [_DATASET_UUID], top_k: 5 });
	});

	it("fails closed when Cognee returns another dataset envelope", async function _rejectsForeignEnvelope()
	{
		const providerSession = _Options().providerSession;
		vi.mocked(providerSession.exchange).mockResolvedValue(_ProviderResponse([{ dataset_id: "0f0e4b1c-9a52-4d0f-8c53-2f3ad34e1b10", search_result: [_CHUNK] }]));
		await expect(_Search(__CreateMemoryGatewayServer(_Options({ providerSession })))).resolves.toMatchObject({ status: 502, body: { error: "memory_gateway_unavailable" } });
	});

	it("refuses unknown fields, multiple datasets, and non-CHUNKS search before provider access", async function _rejectsInvalidSearch()
	{
		for (const body of [
			{ query: "known facts", search_type: "CHUNKS", dataset_ids: [_DATASET_UUID], top_k: 5, node_type: "TextSummary" },
			{ query: "known facts", search_type: "CHUNKS", dataset_ids: [_DATASET_UUID, "0f0e4b1c-9a52-4d0f-8c53-2f3ad34e1b10"], top_k: 5 },
			{ query: "known facts", search_type: "RAG_COMPLETION", dataset_ids: [_DATASET_UUID], top_k: 5 },
		])
		{
			const options = _Options();
			const call = request(__CreateMemoryGatewayServer(options)).post("/api/v1/search").set("authorization", "Bearer projected-token").send(body);
			await expect(call).resolves.toMatchObject({ status: 422, body: { error: "invalid_search" } });
			expect(options.providerSession.exchange).not.toHaveBeenCalled();
		}
	});

	it("refuses provider write routes before forwarding bytes", async function _rejectsWrites()
	{
		const options = _Options();
		const server = __CreateMemoryGatewayServer(options);
		await expect(request(server).post("/api/v1/add").set("authorization", "Bearer projected-token").send({ data: "secret" })).resolves.toMatchObject({ status: 404 });
		await expect(request(server).post("/api/v1/cognify").set("authorization", "Bearer projected-token").send({ datasets: ["ds-1"] })).resolves.toMatchObject({ status: 404 });
		expect(options.providerSession.exchange).not.toHaveBeenCalled();
	});
});
