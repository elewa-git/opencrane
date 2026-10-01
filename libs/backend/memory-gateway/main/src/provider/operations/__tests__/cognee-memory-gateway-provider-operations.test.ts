import { createHash } from "node:crypto";

import { MemoryGatewayErrorCodes, MemoryMutationDeliveryStates } from "@opencrane/contracts";
import { describe, expect, it } from "vitest";

import type { CogneeProviderSession } from "../../auth/cognee-provider-session.types";
import type { CogneeProviderHttpCommand, CogneeProviderHttpResponse } from "../../http/cognee-provider-http.types";
import { _CreateCogneeMemoryGatewayProviderOperations } from "../cognee-memory-gateway-provider-operations";

const _DATASET = "c70d9ca3-c5df-4c45-bf92-1c2c466776b0";
const _DOCUMENT = "9bbe5f52-3b0e-4f59-8fb8-d4c36e67a49d";
const _OTHER = "943a3b4f-b646-44dd-9037-8ea51593e98e";
const _CHUNK = "d1d8f531-6821-44ed-98ce-f6ccbe0bca06";
const _DATASET_NAME = "opaque-memory-dataset-name-that-is-long-enough-12345";

function _Digest(value: string): string
{
	return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function _Response(value: unknown, status = 200): CogneeProviderHttpResponse
{
	return { status, contentType: "application/json", body: new TextEncoder().encode(JSON.stringify(value)) };
}

function _Raw(value: string, status = 200): CogneeProviderHttpResponse
{
	return { status, contentType: "text/plain", body: new TextEncoder().encode(value) };
}

function _Document(contentDigest: string, documentId = _DOCUMENT): Record<string, unknown>
{
	return { id: documentId, name: "fact.txt", createdAt: "2026-09-13T08:30:00Z", updatedAt: null, extension: ".txt", mimeType: "text/plain", rawDataLocation: "/private/provider/fact.txt", datasetId: _DATASET, label: null, externalMetadata: null, contentDigest, byteLength: 10 };
}

function _Evidence(contentDigest: string, documents: readonly Record<string, unknown>[] = [_Document(contentDigest)]): unknown
{
	return { datasetId: _DATASET, inputEvidenceDigest: `sha256:${"a".repeat(64)}`, data: documents };
}

function _Session(replies: Array<CogneeProviderHttpResponse | Error>): { session: CogneeProviderSession; commands: CogneeProviderHttpCommand[]; readyCalls: { value: number } }
{
	const commands: CogneeProviderHttpCommand[] = [];
	const readyCalls = { value: 0 };
	return {
		commands,
		readyCalls,
		session: {
			async ensureReady(): Promise<void> { readyCalls.value += 1; },
			async exchange(command: CogneeProviderHttpCommand): Promise<CogneeProviderHttpResponse>
			{
				commands.push(command);
				const reply = replies.shift();
				if (reply instanceof Error)
					throw reply;
				if (reply === undefined)
					throw new Error("provider fixture exhausted");
				return reply;
			},
		},
	};
}

describe("Cognee memory gateway provider operations", function _Suite()
{
	it("ensures an existing opaque dataset without repeating creation", async function _EnsureReplay()
	{
		const session = _Session([_Response([{ id: _DATASET, name: _DATASET_NAME, createdAt: "2026-09-13T08:30:00Z", updatedAt: null, ownerId: _OTHER }])]);
		const provider = _CreateCogneeMemoryGatewayProviderOperations(session.session);
		await expect(provider.ensureDataset({ datasetName: _DATASET_NAME })).resolves.toEqual({ dataset: { datasetId: _DATASET, datasetName: _DATASET_NAME } });
		expect(session.readyCalls.value).toBe(0);
		expect(session.commands).toHaveLength(1);
		expect(session.commands[0]).toMatchObject({ method: "GET", path: "/api/v1/datasets" });
	});

	it("keeps an unavailable initial dataset read proven not sent", async function _EnsureReadFailure()
	{
		const session = _Session([new Error("private provider detail")]);
		const provider = _CreateCogneeMemoryGatewayProviderOperations(session.session);
		await expect(provider.ensureDataset({ datasetName: _DATASET_NAME })).rejects.toMatchObject({ error: MemoryGatewayErrorCodes.ProviderUnavailable, deliveryState: MemoryMutationDeliveryStates.ProvenNotSent });
		expect(session.commands.map(command => `${command.method} ${command.path}`)).toEqual(["GET /api/v1/datasets"]);
		expect(session.readyCalls.value).toBe(0);
	});

	it("recovers a dataset whose create response was lost", async function _EnsureRecovery()
	{
		const row = { id: _DATASET, name: _DATASET_NAME, createdAt: "2026-09-13T08:30:00Z", updatedAt: null, ownerId: _OTHER };
		const session = _Session([_Response([]), new Error("connection dropped"), _Response([row])]);
		const provider = _CreateCogneeMemoryGatewayProviderOperations(session.session);
		await expect(provider.ensureDataset({ datasetName: _DATASET_NAME })).resolves.toEqual({ dataset: { datasetId: _DATASET, datasetName: _DATASET_NAME } });
		expect(session.commands.map(command => `${command.method} ${command.path}`)).toEqual(["GET /api/v1/datasets", "POST /api/v1/datasets", "GET /api/v1/datasets"]);
		expect(session.readyCalls.value).toBe(1);
	});

	it("reconciles Add before dispatch and after an ambiguous response", async function _AddRecovery()
	{
		const content = "bounded fact";
		const digest = _Digest(content);
		const absent = _Evidence(digest, []);
		const present = _Evidence(digest);
		const session = _Session([_Response(absent), new Error("connection dropped"), _Response(present), _Raw(content)]);
		const provider = _CreateCogneeMemoryGatewayProviderOperations(session.session);
		await expect(provider.addDocument({ datasetId: _DATASET, content, contentDigest: digest })).resolves.toEqual({ datasetId: _DATASET, documentId: _DOCUMENT, contentDigest: digest });
		expect(session.commands.map(command => `${command.method} ${command.path}`)).toEqual([
			`GET /api/v1/datasets/${_DATASET}/data?include_cognify_evidence=true`,
			"POST /api/v1/add",
			`GET /api/v1/datasets/${_DATASET}/data?include_cognify_evidence=true`,
			`GET /api/v1/datasets/${_DATASET}/data/${_DOCUMENT}/raw`,
		]);
		expect(session.readyCalls.value).toBe(1);
	});

	it("does not dispatch Add when exact raw digest already exists", async function _AddReplay()
	{
		const content = "bounded fact";
		const digest = _Digest(content);
		const session = _Session([_Response(_Evidence(digest)), _Raw(content)]);
		const provider = _CreateCogneeMemoryGatewayProviderOperations(session.session);
		await expect(provider.addDocument({ datasetId: _DATASET, content, contentDigest: digest })).resolves.toMatchObject({ documentId: _DOCUMENT });
		expect(session.commands.every(command => command.path !== "/api/v1/add")).toBe(true);
		expect(session.readyCalls.value).toBe(0);
	});

	it("returns a complete raw digest with canonical document coordinates", async function _RawDigest()
	{
		const content = "bounded fact";
		const session = _Session([_Raw(content)]);
		const provider = _CreateCogneeMemoryGatewayProviderOperations(session.session);
		await expect(provider.readDocumentDigest({ datasetId: _DATASET.toUpperCase(), documentId: _DOCUMENT.toUpperCase() })).resolves.toEqual({ datasetId: _DATASET, documentId: _DOCUMENT, contentDigest: _Digest(content), byteLength: new TextEncoder().encode(content).byteLength });
		expect(session.commands[0]).toMatchObject({ method: "GET", path: `/api/v1/datasets/${_DATASET}/data/${_DOCUMENT}/raw` });
	});

	it("projects one bounded dataset search result", async function _Search()
	{
		const session = _Session([_Response([{ dataset_id: _DATASET, search_result: [{ id: _CHUNK, document_id: _DOCUMENT, text: "bounded fact" }] }])]);
		const provider = _CreateCogneeMemoryGatewayProviderOperations(session.session);
		await expect(provider.search({ datasetId: _DATASET.toUpperCase(), query: "fact", topK: 1 })).resolves.toEqual({ datasetId: _DATASET, facts: [{ documentId: _DOCUMENT, chunkId: _CHUNK, content: "bounded fact" }] });
		expect(session.commands[0]).toMatchObject({ method: "POST", path: "/api/v1/search", body: JSON.stringify({ search_type: "CHUNKS", dataset_ids: [_DATASET], query: "fact", top_k: 1 }) });
	});

	it("returns a content-free deletion receipt only after membership and raw absence", async function _Delete()
	{
		const digest = _Digest("existing");
		const session = _Session([_Response(_Evidence(digest)), _Response(null), _Response(_Evidence(digest, [])), _Response({ message: "missing" }, 404)]);
		const provider = _CreateCogneeMemoryGatewayProviderOperations(session.session);
		await expect(provider.deleteDocument({ datasetId: _DATASET, documentId: _DOCUMENT })).resolves.toEqual({ datasetId: _DATASET, documentId: _DOCUMENT });
		expect(session.commands.map(command => `${command.method} ${command.path}`)).toEqual([
			`GET /api/v1/datasets/${_DATASET}/data?include_cognify_evidence=true`,
			`DELETE /api/v1/datasets/${_DATASET}/data/${_DOCUMENT}`,
			`GET /api/v1/datasets/${_DATASET}/data?include_cognify_evidence=true`,
			`GET /api/v1/datasets/${_DATASET}/data/${_DOCUMENT}/raw`,
		]);
	});

	it("replays a deletion as a receipt when both absence reads already agree", async function _DeleteReplay()
	{
		const session = _Session([_Response(_Evidence(_Digest("existing"), [])), _Raw("missing", 404)]);
		const provider = _CreateCogneeMemoryGatewayProviderOperations(session.session);
		await expect(provider.deleteDocument({ datasetId: _DATASET, documentId: _DOCUMENT })).resolves.toEqual({ datasetId: _DATASET, documentId: _DOCUMENT });
		expect(session.readyCalls.value).toBe(0);
		expect(session.commands.some(command => command.method === "DELETE")).toBe(false);
	});

	it("keeps an unavailable initial deletion read proven not sent", async function _DeleteReadFailure()
	{
		const session = _Session([new Error("private provider detail")]);
		const provider = _CreateCogneeMemoryGatewayProviderOperations(session.session);
		await expect(provider.deleteDocument({ datasetId: _DATASET, documentId: _DOCUMENT })).rejects.toMatchObject({ error: MemoryGatewayErrorCodes.ProviderUnavailable, deliveryState: MemoryMutationDeliveryStates.ProvenNotSent });
		expect(session.commands.map(command => `${command.method} ${command.path}`)).toEqual([`GET /api/v1/datasets/${_DATASET}/data?include_cognify_evidence=true`]);
		expect(session.readyCalls.value).toBe(0);
	});

	it("keeps an unavailable pre-dispatch Add proven not sent", async function _PreDispatchFailure()
	{
		const content = "bounded fact";
		const session = _Session([new Error("private provider detail")]);
		const provider = _CreateCogneeMemoryGatewayProviderOperations(session.session);
		await expect(provider.addDocument({ datasetId: _DATASET, content, contentDigest: _Digest(content) })).rejects.toMatchObject({ error: MemoryGatewayErrorCodes.ProviderUnavailable, deliveryState: MemoryMutationDeliveryStates.ProvenNotSent });
		expect(session.commands).toHaveLength(1);
	});
});
