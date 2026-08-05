import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { FixedServiceAccountTokenReviewer } from "@opencrane/backend/_server/workload-identity";

import { _CreateServer } from "../server.js";

/** Fixed private-gateway configuration used by the transport-boundary cases. */
const _CONFIG = { port: 8080, cogneeUrl: "http://opencrane-cognee.default.svc.cluster.local:8000", namespace: "default", serverServiceAccountName: "opencrane-opencrane-server", serverTokenAudience: "opencrane-memory-gateway", requestTimeoutMilliseconds: 30_000 };

/** Build a TokenReview seam for the exact expected server or one deliberate mismatch. */
function _Reviewer(username = "system:serviceaccount:default:opencrane-opencrane-server"): FixedServiceAccountTokenReviewer
{
	return { __Review: vi.fn(async function _review() { return username === "system:serviceaccount:default:opencrane-opencrane-server" ? { username, namespace: "default", serviceAccountName: "opencrane-opencrane-server", audiences: ["opencrane-memory-gateway"] } : null; }) };
}

afterEach(function _restoreFetch()
{
	vi.unstubAllGlobals();
});

describe("private memory gateway", function _suite()
{
	it("answers health probes without exposing or contacting Cognee", async function _health()
	{
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		await expect(request(_CreateServer(_CONFIG, _Reviewer())).get("/readyz")).resolves.toMatchObject({ status: 204 });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("rejects a token for a different ServiceAccount before forwarding bytes", async function _rejectsWrongServer()
	{
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		await expect(request(_CreateServer(_CONFIG, _Reviewer("system:serviceaccount:default:other-server"))).post("/api/v1/search").set("authorization", "Bearer projected-token").send({ query: "secret" })).resolves.toMatchObject({ status: 401 });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("forwards only an authenticated allowlisted operation to private Cognee", async function _forwards()
	{
		const fetchMock = vi.fn(async function _fetch(_input: string | URL | Request, _init?: RequestInit): Promise<Response> { return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { "content-type": "application/json" } }); });
		vi.stubGlobal("fetch", fetchMock);
		await expect(request(_CreateServer(_CONFIG, _Reviewer())).post("/api/v1/search").set("authorization", "Bearer projected-token").send({ query: "known facts", datasets: ["frozen-dataset"] })).resolves.toMatchObject({ status: 200, body: { results: [] } });
		expect(fetchMock).toHaveBeenCalledOnce();
		const forwarded = fetchMock.mock.calls[0]![0] as URL;
		expect(forwarded.toString()).toBe("http://opencrane-cognee.default.svc.cluster.local:8000/api/v1/search");
	});

	it("refuses Cognee write routes before reading or forwarding bytes", async function _rejectsWrites()
	{
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const server = _CreateServer(_CONFIG, _Reviewer());
		await expect(request(server).post("/api/v1/add").set("authorization", "Bearer projected-token").send({ data: "secret" })).resolves.toMatchObject({ status: 404 });
		await expect(request(server).post("/api/v1/cognify").set("authorization", "Bearer projected-token").send({ datasets: ["ds-1"] })).resolves.toMatchObject({ status: 404 });
		await expect(request(server).delete("/api/v1/datasets/ds-1/data/fact-1").set("authorization", "Bearer projected-token")).resolves.toMatchObject({ status: 404 });
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
