import { context, ROOT_CONTEXT } from "@opentelemetry/api";
import type { Context } from "@opentelemetry/api";
import { isTracingSuppressed } from "@opentelemetry/core";
import { MemoryGatewayErrorCodes, MemoryMutationDeliveryStates } from "@opencrane/contracts";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { __CreateHttpCogneeMemoryGatewayClient } from "../http-cognee-memory-gateway-client";
import type { CogneeFetch } from "../http-cognee-memory-gateway-client.types";
import { MemoryGatewayMutationFailure, MemoryGatewayProtocolError, MemoryGatewayReadFailure, MemoryGatewayTransportError } from "../memory-gateway-errors";
import type { MemoryGatewayOperationContext, MemoryProvenance } from "../memory-gateway-client.types";
import { MemoryProvenanceIncompleteError } from "../memory-provenance";
import { MemoryGatewayUnavailableError } from "../unavailable-memory-gateway-client";

/** Active context maintained by the synchronous test context manager. */
let _activeContext = ROOT_CONTEXT;

/** Installs enough context propagation to observe fetch suppression at the test seam. */
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

beforeAll(function _RegisterTestContext(): void { _RegisterContextManager(); });

const _DATASET_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const _DOCUMENT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const _CHUNK_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const _OPERATION_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const _PIPELINE_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const _OTHER_DATASET_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const _DATASET_NAME = "memory_dataset_012345678901234567890123456789";
const _DIGEST = `sha256:${"a".repeat(64)}`;
const _CONTEXT: MemoryGatewayOperationContext = { siloId: "silo-1", subjectId: "subject-1" };
const _PROVENANCE: MemoryProvenance = { centralAgentId: "svc-1", agentRevisionId: "rev-1", runId: "run-1", recordedAt: "2026-08-01T10:00:00.000Z", sourceRef: "doc-1" };

/** One outbound exchange captured without retaining its bearer value. */
interface _RecordedRequest
{
	/** Stable route path. */
	readonly path: string;
	/** Fixed route method. */
	readonly method: string | undefined;
	/** Decoded JSON body, or null for DELETE. */
	readonly body: Record<string, unknown> | null;
	/** Whether the expected sequential test bearer was attached. */
	readonly authorization: string | null;
	/** Whether automatic fetch tracing was suppressed. */
	readonly tracingSuppressed: boolean;
}

/** Builds a strict JSON response. */
function _Json(value: unknown, status = 200): Response
{
	return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

/** Creates the client with a supplied fetch seam and rotating token reader. */
function _Client(fetch: CogneeFetch, readServerToken: () => Promise<string> = async function _Token() { return "projected-token"; }, requestTimeoutMilliseconds = 1_000)
{
	return __CreateHttpCogneeMemoryGatewayClient({ baseUrl: "http://memory-gateway.opencrane.svc.cluster.local:8080", requestTimeoutMilliseconds, serverTokenFile: "/var/run/opencrane/memory-gateway/token", fetch, readServerToken });
}

/** Returns the path from any Fetch input variant. */
function _Path(input: string | URL | Request): string
{
	return new URL(input instanceof Request ? input.url : input).pathname;
}

describe("authenticated memory-gateway client", function _ClientSuite()
{
	it("uses every stable route once, rereads the token, and keeps product context out of wire bodies", async function _AllRoutes()
	{
		const calls: _RecordedRequest[] = [];
		const fetchMock = vi.fn(async function _Fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>
		{
			const path = _Path(input);
			const rawBody = typeof init?.body === "string" ? init.body : null;
			calls.push({ path, method: init?.method, body: rawBody === null ? null : JSON.parse(rawBody) as Record<string, unknown>, authorization: new Headers(init?.headers).get("authorization"), tracingSuppressed: isTracingSuppressed(context.active()) });
			if (path.endsWith("/datasets/ensure"))
				return _Json({ dataset: { datasetId: _DATASET_ID, datasetName: _DATASET_NAME } });
			if (path.endsWith("/datasets/list"))
				return _Json({ datasets: [{ datasetId: _DATASET_ID, datasetName: _DATASET_NAME }] });
			if (path.endsWith("/documents/add"))
				return _Json({ datasetId: _DATASET_ID, documentId: _DOCUMENT_ID, contentDigest: _DIGEST });
			if (path.endsWith("/documents/list"))
				return _Json({ datasetId: _DATASET_ID, inputEvidenceDigest: _DIGEST, documents: [{ documentId: _DOCUMENT_ID, name: "fact.txt", mimeType: "text/plain", contentDigest: _DIGEST, byteLength: 4 }] });
			if (path.endsWith("/documents/raw-digest"))
				return _Json({ datasetId: _DATASET_ID, documentId: _DOCUMENT_ID, contentDigest: _DIGEST, byteLength: 4 });
			if (path.endsWith("/datasets/cognify"))
				return _Json({ datasetId: _DATASET_ID, operationId: _OPERATION_ID, inputEvidenceDigest: _DIGEST, pipelineRunId: _PIPELINE_ID });
			if (path.endsWith("/memory/search"))
				return _Json({ datasetId: _DATASET_ID, facts: [{ documentId: _DOCUMENT_ID, chunkId: _CHUNK_ID, content: "fact" }] });
			return _Json({ datasetId: _DATASET_ID, documentId: _DOCUMENT_ID });
		});
		let tokenReads = 0;
		const client = _Client(fetchMock, async function _ReadToken(): Promise<string>
		{
			tokenReads += 1;
			return `projected-token-${tokenReads}`;
		});

		await client.ensureDataset(_CONTEXT, { datasetName: _DATASET_NAME });
		await client.listDatasets(_CONTEXT, { datasetName: _DATASET_NAME });
		await client.addDocument(_CONTEXT, { datasetId: _DATASET_ID, content: "fact", contentDigest: _DIGEST });
		await client.listDocuments(_CONTEXT, { datasetId: _DATASET_ID });
		await client.readDocumentDigest(_CONTEXT, { datasetId: _DATASET_ID, documentId: _DOCUMENT_ID });
		await client.cognifyDataset(_CONTEXT, { datasetId: _DATASET_ID, operationId: _OPERATION_ID, expectedInputEvidenceDigest: _DIGEST });
		await client.query({ siloId: _CONTEXT.siloId, subjectId: _CONTEXT.subjectId, cogneeDatasetId: _DATASET_ID, query: "fact", maxResults: 1 });
		await client.deleteDocument(_CONTEXT, { datasetId: _DATASET_ID, documentId: _DOCUMENT_ID });

		expect(calls.map(function _Call(call) { return [call.method, call.path]; })).toEqual([
			["POST", "/api/v1/memory/datasets/ensure"],
			["POST", "/api/v1/memory/datasets/list"],
			["POST", "/api/v1/memory/documents/add"],
			["POST", "/api/v1/memory/documents/list"],
			["POST", "/api/v1/memory/documents/raw-digest"],
			["POST", "/api/v1/memory/datasets/cognify"],
			["POST", "/api/v1/memory/search"],
			["DELETE", `/api/v1/memory/datasets/${_DATASET_ID}/documents/${_DOCUMENT_ID}`],
		]);
		expect(calls.map(function _Authorization(call) { return call.authorization; })).toEqual(Array.from({ length: 8 }, function _Expected(_value, index) { return `Bearer projected-token-${index + 1}`; }));
		expect(calls.every(function _Suppressed(call) { return call.tracingSuppressed; })).toBe(true);
		expect(calls.every(function _NoContextBody(call) { return call.body === null || (!("siloId" in call.body) && !("subjectId" in call.body)); })).toBe(true);
		expect(calls[6]?.body).toEqual({ datasetId: _DATASET_ID, query: "fact", topK: 1 });
		expect(calls.some(function _OldSearch(call) { return call.path === "/api/v1/search"; })).toBe(false);
		expect(calls[7]?.body).toBeNull();
	});

	it("preserves personal and scoped recall projections through the shared search response", async function _RecallProjection()
	{
		const envelope = JSON.stringify({ v: 1, content: "shared", provenance: _PROVENANCE });
		const client = _Client(async function _Search(): Promise<Response>
		{
			return _Json({ datasetId: _DATASET_ID, facts: [
				{ documentId: _DOCUMENT_ID, chunkId: _CHUNK_ID, content: envelope },
				{ documentId: _DOCUMENT_ID, chunkId: _PIPELINE_ID, content: "not an envelope" },
			] });
		});

		await expect(client.query({ siloId: "silo-1", subjectId: "subject-1", cogneeDatasetId: _DATASET_ID, query: "q", maxResults: 1 })).resolves.toEqual({ facts: [{ cogneeDocumentId: _DOCUMENT_ID, cogneeChunkId: _CHUNK_ID, content: envelope }] });
		await expect(client.recallScoped({ siloId: "silo-1", cogneeDatasetId: _DATASET_ID, query: "q", maxResults: 2 })).resolves.toEqual({ facts: [{ cogneeDocumentId: _DOCUMENT_ID, cogneeChunkId: _CHUNK_ID, content: "shared", provenance: _PROVENANCE }] });
	});

	it("accepts provider-canonical lowercase UUID evidence for uppercase request coordinates", async function _CanonicalUuidCoordinates()
	{
		const client = _Client(async function _CanonicalResponse(input: string | URL | Request): Promise<Response>
		{
			const path = _Path(input);
			if (path.endsWith("/documents/add"))
				return _Json({ datasetId: _DATASET_ID, documentId: _DOCUMENT_ID, contentDigest: _DIGEST });
			if (path.endsWith("/documents/list"))
				return _Json({ datasetId: _DATASET_ID, inputEvidenceDigest: _DIGEST, documents: [] });
			if (path.endsWith("/documents/raw-digest"))
				return _Json({ datasetId: _DATASET_ID, documentId: _DOCUMENT_ID, contentDigest: _DIGEST, byteLength: 4 });
			if (path.endsWith("/datasets/cognify"))
				return _Json({ datasetId: _DATASET_ID, operationId: _OPERATION_ID, inputEvidenceDigest: _DIGEST, pipelineRunId: _PIPELINE_ID });
			if (path.endsWith("/memory/search"))
				return _Json({ datasetId: _DATASET_ID, facts: [] });
			return _Json({ datasetId: _DATASET_ID, documentId: _DOCUMENT_ID });
		});
		const datasetId = _DATASET_ID.toUpperCase();
		const documentId = _DOCUMENT_ID.toUpperCase();
		const operationId = _OPERATION_ID.toUpperCase();

		await expect(client.addDocument(_CONTEXT, { datasetId, content: "fact", contentDigest: _DIGEST })).resolves.toMatchObject({ datasetId: _DATASET_ID });
		await expect(client.listDocuments(_CONTEXT, { datasetId })).resolves.toMatchObject({ datasetId: _DATASET_ID });
		await expect(client.readDocumentDigest(_CONTEXT, { datasetId, documentId })).resolves.toMatchObject({ datasetId: _DATASET_ID, documentId: _DOCUMENT_ID });
		await expect(client.cognifyDataset(_CONTEXT, { datasetId, operationId, expectedInputEvidenceDigest: _DIGEST })).resolves.toMatchObject({ datasetId: _DATASET_ID, operationId: _OPERATION_ID });
		await expect(client.query({ siloId: _CONTEXT.siloId, subjectId: _CONTEXT.subjectId, cogneeDatasetId: datasetId, query: "fact", maxResults: 1 })).resolves.toEqual({ facts: [] });
		await expect(client.deleteDocument(_CONTEXT, { datasetId, documentId })).resolves.toEqual({ datasetId: _DATASET_ID, documentId: _DOCUMENT_ID });
	});

	it("rejects local request and context drift before token access", async function _LocalValidation()
	{
		const readServerToken = vi.fn(async function _Token() { return "projected-token"; });
		const fetchMock = vi.fn(async function _Unused(): Promise<Response> { return _Json({}); });
		const client = _Client(fetchMock, readServerToken);

		await expect(client.addDocument(_CONTEXT, { datasetId: "not-a-uuid", content: "fact", contentDigest: _DIGEST })).rejects.toMatchObject({ deliveryState: MemoryMutationDeliveryStates.ProvenNotSent });
		await expect(client.ensureDataset({ ..._CONTEXT, subjectId: " " }, { datasetName: _DATASET_NAME })).rejects.toMatchObject({ deliveryState: MemoryMutationDeliveryStates.ProvenNotSent });
		await expect(client.listDocuments({ ..._CONTEXT, siloId: "" }, { datasetId: _DATASET_ID })).rejects.not.toHaveProperty("deliveryState");
		expect(readServerToken).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("rejects mismatched response evidence and malformed mutation success as ambiguous", async function _Coordinates()
	{
		const wrongDataset = _Client(async function _WrongDataset(): Promise<Response>
		{
			return _Json({ datasetId: _OTHER_DATASET_ID, documentId: _DOCUMENT_ID, contentDigest: _DIGEST });
		});
		await expect(wrongDataset.addDocument(_CONTEXT, { datasetId: _DATASET_ID, content: "fact", contentDigest: _DIGEST })).rejects.toMatchObject({ deliveryState: MemoryMutationDeliveryStates.Ambiguous });

		const wrongCognify = _Client(async function _WrongCognify(): Promise<Response>
		{
			return _Json({ datasetId: _DATASET_ID, operationId: _OPERATION_ID, inputEvidenceDigest: `sha256:${"b".repeat(64)}`, pipelineRunId: _PIPELINE_ID });
		});
		await expect(wrongCognify.cognifyDataset(_CONTEXT, { datasetId: _DATASET_ID, operationId: _OPERATION_ID, expectedInputEvidenceDigest: _DIGEST })).rejects.toMatchObject({ deliveryState: MemoryMutationDeliveryStates.Ambiguous });

		const malformed = _Client(async function _Malformed(): Promise<Response>
		{
			return new Response("private-provider-body", { status: 200, headers: { "content-type": "application/json" } });
		});
		const failure = await malformed.deleteDocument(_CONTEXT, { datasetId: _DATASET_ID, documentId: _DOCUMENT_ID }).catch(function _Capture(error: unknown) { return error; });
		expect(failure).toBeInstanceOf(MemoryGatewayProtocolError);
		expect(failure).toMatchObject({ deliveryState: MemoryMutationDeliveryStates.Ambiguous });
		expect(String(failure)).not.toContain("private-provider-body");
	});

	it("separates gateway-declared read and mutation failures", async function _GatewayFailures()
	{
		const readClient = _Client(async function _NotFound(): Promise<Response>
		{
			return _Json({ error: MemoryGatewayErrorCodes.NotFound }, 404);
		});
		const readFailure = await readClient.listDocuments(_CONTEXT, { datasetId: _DATASET_ID }).catch(function _Capture(error: unknown) { return error; });
		expect(readFailure).toBeInstanceOf(MemoryGatewayReadFailure);
		expect(readFailure).toMatchObject({ error: MemoryGatewayErrorCodes.NotFound });
		expect(readFailure).not.toHaveProperty("deliveryState");

		const mutationClient = _Client(async function _Unavailable(): Promise<Response>
		{
			return _Json({ error: MemoryGatewayErrorCodes.ProviderUnavailable, deliveryState: MemoryMutationDeliveryStates.Ambiguous }, 503);
		});
		await expect(mutationClient.cognifyDataset(_CONTEXT, { datasetId: _DATASET_ID, operationId: _OPERATION_ID, expectedInputEvidenceDigest: _DIGEST })).rejects.toEqual(expect.objectContaining({ error: MemoryGatewayErrorCodes.ProviderUnavailable, deliveryState: MemoryMutationDeliveryStates.Ambiguous }));
		await expect(mutationClient.cognifyDataset(_CONTEXT, { datasetId: _DATASET_ID, operationId: _OPERATION_ID, expectedInputEvidenceDigest: _DIGEST })).rejects.toBeInstanceOf(MemoryGatewayMutationFailure);

		const mismatchedStatus = _Client(async function _Mismatch(): Promise<Response>
		{
			return _Json({ error: MemoryGatewayErrorCodes.NotFound, deliveryState: MemoryMutationDeliveryStates.Ambiguous }, 409);
		});
		await expect(mismatchedStatus.deleteDocument(_CONTEXT, { datasetId: _DATASET_ID, documentId: _DOCUMENT_ID })).rejects.toMatchObject({ deliveryState: MemoryMutationDeliveryStates.Ambiguous });
	});

	it("classifies token refusal before dispatch and network loss after dispatch", async function _TransportDelivery()
	{
		const fetchMock = vi.fn(async function _Network(): Promise<Response> { throw new Error("private provider address"); });
		const tokenFailure = _Client(fetchMock, async function _Token(): Promise<string> { throw new Error("projected-token-secret"); });
		const beforeDispatch = await tokenFailure.deleteDocument(_CONTEXT, { datasetId: _DATASET_ID, documentId: _DOCUMENT_ID }).catch(function _Capture(error: unknown) { return error; });
		expect(beforeDispatch).toBeInstanceOf(MemoryGatewayTransportError);
		expect(beforeDispatch).toMatchObject({ error: MemoryGatewayErrorCodes.ProviderUnavailable, transportCode: "token_unavailable", deliveryState: MemoryMutationDeliveryStates.ProvenNotSent });
		expect(String(beforeDispatch)).not.toContain("projected-token-secret");
		expect(fetchMock).not.toHaveBeenCalled();

		const afterDispatch = await _Client(fetchMock).addDocument(_CONTEXT, { datasetId: _DATASET_ID, content: "fact", contentDigest: _DIGEST }).catch(function _Capture(error: unknown) { return error; });
		expect(afterDispatch).toMatchObject({ error: MemoryGatewayErrorCodes.ProviderUnavailable, transportCode: "network", deliveryState: MemoryMutationDeliveryStates.Ambiguous });
		expect(String(afterDispatch)).not.toContain("private provider address");
		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it("keeps the timeout active through response consumption", async function _Timeout()
	{
		const client = _Client(async function _NeverEnds(): Promise<Response>
		{
			return new Response(new ReadableStream<Uint8Array>({ start() { return; } }), { headers: { "content-type": "application/json" } });
		}, undefined, 1_000);
		await expect(client.addDocument(_CONTEXT, { datasetId: _DATASET_ID, content: "fact", contentDigest: _DIGEST })).rejects.toMatchObject({ error: MemoryGatewayErrorCodes.ProviderUnavailable, transportCode: "timeout", deliveryState: MemoryMutationDeliveryStates.Ambiguous });
	}, 2_000);

	it("rejects oversized responses without exposing partial bytes", async function _Oversize()
	{
		const cancel = vi.fn(function _NeverSettles(): Promise<void> { return new Promise(function _Pending() { return; }); });
		const client = _Client(async function _Large(): Promise<Response>
		{
			return new Response(new ReadableStream<Uint8Array>({ cancel }), { headers: { "content-type": "application/json", "content-length": String((8 * 1024 * 1024) + 1) } });
		});
		const failure = await client.listDocuments(_CONTEXT, { datasetId: _DATASET_ID }).catch(function _Capture(error: unknown) { return error; });
		expect(failure).toMatchObject({ error: MemoryGatewayErrorCodes.ProviderUnavailable, transportCode: "response_too_large" });
		expect(failure).not.toHaveProperty("deliveryState");
		expect(String(failure)).not.toContain("private");
		expect(cancel).toHaveBeenCalledOnce();
	});

	it("retains fail-closed scoped injection and its provenance guard", async function _ScopedInjection()
	{
		const fetchMock = vi.fn(async function _Unused(): Promise<Response> { return _Json({}); });
		const client = _Client(fetchMock);
		await expect(client.injectScoped({ siloId: "silo-1", cogneeDatasetId: _DATASET_ID, content: "shared", provenance: { ..._PROVENANCE, runId: "" } })).rejects.toBeInstanceOf(MemoryProvenanceIncompleteError);
		await expect(client.injectScoped({ siloId: "silo-1", cogneeDatasetId: _DATASET_ID, content: "shared", provenance: _PROVENANCE })).rejects.toBeInstanceOf(MemoryGatewayUnavailableError);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
