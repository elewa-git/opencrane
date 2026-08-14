import { context, ROOT_CONTEXT } from "@opentelemetry/api";
import type { Context } from "@opentelemetry/api";
import { isTracingSuppressed } from "@opentelemetry/core";
import { beforeAll, describe, expect, it } from "vitest";

import { MemoryGatewayTransportError } from "../cognee-http";
import { __CreateHttpCogneeMemoryGatewayClient } from "../http-cognee-memory-gateway-client";
import type { CogneeFetch } from "../http-cognee-memory-gateway-client.types";
import type { MemoryProvenance } from "../memory-gateway-client.types";
import { MemoryProvenanceIncompleteError } from "../memory-provenance";
import { MemoryGatewayProtocolError } from "../personal-memory-record";
import { MemoryGatewayUnavailableError } from "../unavailable-memory-gateway-client";

/** One recorded outbound exchange captured by the fetch seam. */
interface _RecordedRequest
{
	/** Absolute request URL as issued by the adapter. */
	readonly url: string;
	/** Decoded JSON body, when the exchange carried one. */
	readonly body: Record<string, unknown> | null;
	/** Authorization header, when the exchange carried one. */
	readonly authorization: string | null;
	/** Whether automatic child tracing was suppressed. */
	readonly tracingSuppressed: boolean;
}

/** Active context maintained by the synchronous test context manager. */
let _activeContext = ROOT_CONTEXT;

/** Install enough context propagation to observe fetch suppression at the test seam. */
function _RegisterContextManager(): void
{
	context.setGlobalContextManager({
		active(): Context { return _activeContext; },
		with<A extends unknown[], F extends (...args: A) => ReturnType<F>>(next: Context, callback: F, thisArg?: ThisParameterType<F>, ...args: A): ReturnType<F>
		{
			const previous = _activeContext;
			_activeContext = next;
			try { return callback.apply(thisArg, args); }
			finally { _activeContext = previous; }
		},
		bind<T>(_context: Context, target: T): T { return target; },
		enable() { return this; },
		disable() { return this; },
	});
}

beforeAll(function _registerContextManager(): void { _RegisterContextManager(); });

/** Provenance satisfying every mandatory attribution field. */
const _PROVENANCE: MemoryProvenance = { centralAgentId: "svc-1", agentRevisionId: "rev-1", runId: "run-1", recordedAt: "2026-08-01T10:00:00.000Z", sourceRef: "doc-1" };

/** Builds a fetch seam recording exchanges and answering by URL path. */
function _fetchSeam(recorded: _RecordedRequest[], answers: Record<string, () => Response>): CogneeFetch
{
	return async function _fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>
	{
		const url = new URL(String(input));
		const headers = new Headers(init?.headers);
		const rawBody = typeof init?.body === "string" ? init.body : null;
		const isJson = (headers.get("content-type") ?? "").includes("application/json");
		recorded.push({ url: url.pathname, body: rawBody !== null && isJson ? JSON.parse(rawBody) as Record<string, unknown> : null, authorization: headers.get("authorization"), tracingSuppressed: isTracingSuppressed(context.active()) });
		return answers[url.pathname]?.() ?? new Response(null, { status: 204 });
	};
}

/** Builds a JSON response. */
function _json(payload: unknown, status = 200): Response
{
	return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

/** Creates a client bound to the recording seam. */
function _client(recorded: _RecordedRequest[], answers: Record<string, () => Response>, extra: Partial<Parameters<typeof __CreateHttpCogneeMemoryGatewayClient>[0]> = {})
{
	return __CreateHttpCogneeMemoryGatewayClient({ baseUrl: "http://opencrane-memory-gateway.opencrane.svc.cluster.local:8080", requestTimeoutMilliseconds: 30_000, serverTokenFile: "/var/run/opencrane/memory-gateway/token", readServerToken: async function _readToken() { return "projected-token"; }, fetch: _fetchSeam(recorded, answers), ...extra });
}

describe("Cognee memory gateway reads", function _ReadSuite()
{
	it("rejects external HTTP origins before a projected token can be read", function _RejectExternalOrigin()
	{
		let tokenRead = false;
		expect(function _CreateExternalClient()
		{
			_client([], {}, { baseUrl: "http://attacker.example:8080", readServerToken: async function _readToken() { tokenRead = true; return "projected-token"; } });
		}).toThrow("MEMORY_GATEWAY_URL must be one release-local Kubernetes Service HTTP origin");
		expect(tokenRead).toBe(false);
	});

	it("searches only the frozen dataset and bounds projected facts", async function _Query()
	{
		const recorded: _RecordedRequest[] = [];
		const answers = { "/api/v1/search": function _search() { return _json([{ id: "f1", text: "one" }, { id: "f2", text: "two" }, { id: "f3", text: "three" }]); } };
		const result = await _client(recorded, answers).query({ siloId: "silo-1", cogneeDatasetId: "11111111-1111-4111-8111-111111111111", subjectId: "user-1", query: "what", maxResults: 2 });
		expect(result.facts).toEqual([{ factId: "f1", content: "one" }, { factId: "f2", content: "two" }]);
		expect(recorded[0].body).toEqual({ query: "what", search_type: "CHUNKS", dataset_ids: ["11111111-1111-4111-8111-111111111111"], top_k: 2 });
		expect(recorded[0].body).not.toHaveProperty("datasets");
	});

	it("drops malformed entries and rejects an unrecognised response", async function _ValidateResponse()
	{
		const malformed = { "/api/v1/search": function _search() { return _json([{ text: "orphan" }, { id: "f2", text: "kept" }]); } };
		await expect(_client([], malformed).query({ siloId: "silo-1", cogneeDatasetId: "22222222-2222-4222-8222-222222222222", subjectId: "user-1", query: "q", maxResults: 10 })).resolves.toEqual({ facts: [{ factId: "f2", content: "kept" }] });
		const unknown = { "/api/v1/search": function _search() { return _json({ unexpected: true }); } };
		await expect(_client([], unknown).query({ siloId: "silo-1", cogneeDatasetId: "22222222-2222-4222-8222-222222222222", subjectId: "user-1", query: "q", maxResults: 5 })).rejects.toBeInstanceOf(MemoryGatewayProtocolError);
	});

	it("recalls only attributable scoped records", async function _ScopedRecall()
	{
		const answers = { "/api/v1/search": function _search() { return _json([
			{ id: "f1", text: JSON.stringify({ v: 1, content: "kept", provenance: _PROVENANCE }) },
			{ id: "f2", text: JSON.stringify({ v: 1, content: "no provenance" }) },
		]); } };
		const result = await _client([], answers).recallScoped({ siloId: "silo-1", cogneeDatasetId: "33333333-3333-4333-8333-333333333333", query: "q", maxResults: 10 });
		expect(result.facts).toEqual([{ factId: "f1", content: "kept", provenance: _PROVENANCE }]);
	});
});

describe("Cognee memory gateway writes", function _WriteSuite()
{
	it("keeps personal record, correction, and forgetting fail-closed without transport", async function _PersonalWritesUnavailable()
	{
		const recorded: _RecordedRequest[] = [];
		const client = _client(recorded, {});
		await expect(client.recordPersonalFact({ siloId: "silo-1", subjectId: "user-1", cogneeDatasetId: "ds-1", content: "remember", idempotencyKey: "key-1" })).rejects.toBeInstanceOf(MemoryGatewayUnavailableError);
		await expect(client.correct({ siloId: "silo-1", subjectId: "user-1", factId: "fact-1", correctedContent: "fixed" })).rejects.toBeInstanceOf(MemoryGatewayUnavailableError);
		await expect(client.forget({ siloId: "silo-1", subjectId: "user-1", factId: "fact-1" })).rejects.toBeInstanceOf(MemoryGatewayUnavailableError);
		expect(recorded).toHaveLength(0);
	});

	it("validates scoped provenance before the fail-closed write", async function _ScopedWriteUnavailable()
	{
		const recorded: _RecordedRequest[] = [];
		const client = _client(recorded, {});
		await expect(client.injectScoped({ siloId: "silo-1", cogneeDatasetId: "ds-1", content: "shared", provenance: { ..._PROVENANCE, runId: "" } })).rejects.toBeInstanceOf(MemoryProvenanceIncompleteError);
		await expect(client.injectScoped({ siloId: "silo-1", cogneeDatasetId: "ds-1", content: "shared", provenance: _PROVENANCE })).rejects.toBeInstanceOf(MemoryGatewayUnavailableError);
		expect(recorded).toHaveLength(0);
	});
});

describe("Cognee transport and authentication", function _TransportSuite()
{
	it("maps HTTP and oversize failures to bounded transport codes", async function _BoundedFailures()
	{
		const unavailable = { "/api/v1/search": function _search() { return new Response("no", { status: 503 }); } };
		const httpFailure = await _client([], unavailable).query({ siloId: "s", cogneeDatasetId: "d", subjectId: "u", query: "q", maxResults: 1 }).catch(function _capture(error: unknown) { return error; });
		expect((httpFailure as MemoryGatewayTransportError).code).toBe("http_503");
		const oversize = { "/api/v1/search": function _search() { return new Response("x", { status: 200, headers: { "content-type": "application/json", "content-length": String(512 * 1024) } }); } };
		const oversizeFailure = await _client([], oversize).query({ siloId: "s", cogneeDatasetId: "d", subjectId: "u", query: "q", maxResults: 1 }).catch(function _capture(error: unknown) { return error; });
		expect((oversizeFailure as MemoryGatewayTransportError).code).toBe("oversize");
	});

	it("attaches a fresh projected token and suppresses child tracing", async function _Auth()
	{
		const recorded: _RecordedRequest[] = [];
		const answers = { "/api/v1/search": function _search() { return _json([]); } };
		await _client(recorded, answers).query({ siloId: "s", cogneeDatasetId: "d", subjectId: "u", query: "q", maxResults: 5 });
		expect(recorded[0]).toMatchObject({ authorization: "Bearer projected-token", tracingSuppressed: true });
	});
});
