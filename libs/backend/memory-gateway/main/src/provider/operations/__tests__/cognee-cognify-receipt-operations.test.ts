import { describe, expect, it } from "vitest";

import { MemoryGatewayErrorCodes, MemoryMutationDeliveryStates } from "@opencrane/contracts";

import type { CogneeProviderSession } from "../../auth/cognee-provider-session.types";
import type { CogneeProviderHttpCommand, CogneeProviderHttpResponse } from "../../http/cognee-provider-http.types";
import { _ListDocuments } from "../cognee-document-read-operations";
import { _CognifyDataset } from "../cognee-pipeline-operations";

/** Stable coordinates used by every receipt assertion. */
const _IDS = {
	dataset: "c70d9ca3-c5df-4c45-bf92-1c2c466776b0",
	document: "9bbe5f52-3b0e-4f59-8fb8-d4c36e67a49d",
	operation: "6a2345a9-4977-4bea-b7fd-134633125002",
	pipeline: "fa71b5bc-6385-4f82-a4b9-6df1f9d59271",
	other: "943a3b4f-b646-44dd-9037-8ea51593e98e",
} as const;

/** Digest returned for both the locked snapshot and its only document. */
const _DIGEST = `sha256:${"a".repeat(64)}`;

/** Valid mixed-case form of the saved operation UUID. */
const _MIXED_OPERATION_ID = "6A2345a9-4977-4bEA-b7fD-134633125002";

/** Commands sent to the fake provider session. */
interface RecordedProvider
{
	/** Calls made after the adapter validates its own input. */
	readonly commands: CogneeProviderHttpCommand[];
	/** Number of readiness checks made before Cognify dispatch. */
	readyCalls: number;
}

/** Encode a provider response as the session owner would return it. */
function _Response(value: unknown, status: number = 200): CogneeProviderHttpResponse
{
	return { status, contentType: "application/json", body: new TextEncoder().encode(JSON.stringify(value)) };
}

/** Return one provider document with private fields that the adapter must discard. */
function _EvidenceDocument(documentId: string = _IDS.document): Record<string, unknown>
{
	return {
		id: documentId,
		name: "fact.txt",
		createdAt: "2026-09-13T08:30:00Z",
		updatedAt: null,
		extension: ".txt",
		mimeType: "text/plain",
		rawDataLocation: "/cognee-storage/data/private/fact.txt",
		datasetId: _IDS.dataset,
		label: null,
		externalMetadata: null,
		contentDigest: _DIGEST,
		byteLength: 4,
	};
}

/** Return the repaired provider's completed Cognify receipt. */
function _CompletedRun(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown>
{
	return {
		status: "PipelineRunCompleted",
		pipeline_run_id: _IDS.pipeline,
		dataset_id: _IDS.dataset,
		dataset_name: "opaque-memory-dataset",
		operation_id: _IDS.operation,
		input_evidence_digest: _DIGEST,
		payload: null,
		data_ingestion_info: null,
		...overrides,
	};
}

/** Build a fake authenticated provider session with ordered replies. */
function _Session(replies: Array<CogneeProviderHttpResponse | Error>, recorded: RecordedProvider): CogneeProviderSession
{
	return {
		async ensureReady(): Promise<void>
		{
			recorded.readyCalls += 1;
		},
		async exchange(command: CogneeProviderHttpCommand): Promise<CogneeProviderHttpResponse>
		{
			recorded.commands.push(command);
			const reply = replies.shift();
			if (reply instanceof Error)
				throw reply;
			if (reply === undefined)
				throw new Error("provider fixture exhausted");
			return reply;
		},
	};
}

/** Return empty command evidence for each test. */
function _Recorded(): RecordedProvider
{
	return { commands: [], readyCalls: 0 };
}

describe("Cognee Cognify recovery receipt adapter", function _Suite()
{
	it("reads one locked metadata-only input snapshot", async function _Evidence()
	{
		const recorded = _Recorded();
		const provider = _Response({ datasetId: _IDS.dataset, inputEvidenceDigest: _DIGEST, data: [_EvidenceDocument()] });
		const result = await _ListDocuments(_Session([provider], recorded), { datasetId: _IDS.dataset.toUpperCase() });
		expect(recorded.commands).toEqual([{ method: "GET", path: `/api/v1/datasets/${_IDS.dataset}/data?include_cognify_evidence=true`, signal: undefined }]);
		expect(result).toEqual({
			datasetId: _IDS.dataset,
			inputEvidenceDigest: _DIGEST,
			documents: [{ documentId: _IDS.document, name: "fact.txt", mimeType: "text/plain", contentDigest: _DIGEST, byteLength: 4 }],
		});
		expect(JSON.stringify(result)).not.toContain("rawDataLocation");
		expect(JSON.stringify(result)).not.toContain("private/fact");
	});

	it("rejects duplicate documents and unknown provider fields", async function _RejectEvidence()
	{
		const duplicate = _Response({ datasetId: _IDS.dataset, inputEvidenceDigest: _DIGEST, data: [_EvidenceDocument(), _EvidenceDocument(_IDS.document.toUpperCase())] });
		const unknown = _Response({ datasetId: _IDS.dataset, inputEvidenceDigest: _DIGEST, data: [_EvidenceDocument()], rawContent: "private fact" });
		await expect(_ListDocuments(_Session([duplicate], _Recorded()), { datasetId: _IDS.dataset })).rejects.toMatchObject({ error: MemoryGatewayErrorCodes.ProviderProtocol });
		await expect(_ListDocuments(_Session([unknown], _Recorded()), { datasetId: _IDS.dataset })).rejects.toMatchObject({ error: MemoryGatewayErrorCodes.ProviderProtocol });
	});

	it("sends the saved operation and input digest and returns the terminal receipt", async function _Cognify()
	{
		const recorded = _Recorded();
		const response = _Response({ [_IDS.dataset]: _CompletedRun() });
		const request = { datasetId: _IDS.dataset, operationId: _IDS.operation, expectedInputEvidenceDigest: _DIGEST };
		const result = await _CognifyDataset(_Session([response], recorded), request);
		expect(recorded.readyCalls).toBe(1);
		expect(recorded.commands).toHaveLength(1);
		expect(recorded.commands[0]).toMatchObject({ method: "POST", path: "/api/v1/cognify", headers: { "content-type": "application/json" } });
		expect(JSON.parse(String(recorded.commands[0]?.body))).toEqual({
			dataset_ids: [_IDS.dataset],
			run_in_background: false,
			chunk_size: 128,
			operation_id: _IDS.operation,
			expected_input_evidence_digest: _DIGEST,
		});
		expect(result).toEqual({ datasetId: _IDS.dataset, operationId: _IDS.operation, inputEvidenceDigest: _DIGEST, pipelineRunId: _IDS.pipeline });
	});

	it("normalizes mixed-case command UUIDs before dispatch and receipt comparison", async function _NormalizeCommandCoordinates()
	{
		const recorded = _Recorded();
		const request = { datasetId: _IDS.dataset.toUpperCase(), operationId: _MIXED_OPERATION_ID, expectedInputEvidenceDigest: _DIGEST };
		const result = await _CognifyDataset(_Session([_Response({ [_IDS.dataset]: _CompletedRun() })], recorded), request);
		expect(JSON.parse(String(recorded.commands[0]?.body))).toMatchObject({ dataset_ids: [_IDS.dataset], operation_id: _IDS.operation });
		expect(result).toEqual({ datasetId: _IDS.dataset, operationId: _IDS.operation, inputEvidenceDigest: _DIGEST, pipelineRunId: _IDS.pipeline });
	});

	it("returns the same pipeline receipt when the provider replays a completed operation", async function _Replay()
	{
		const recorded = _Recorded();
		const receipt = _Response({ [_IDS.dataset]: _CompletedRun() });
		const request = { datasetId: _IDS.dataset, operationId: _IDS.operation, expectedInputEvidenceDigest: _DIGEST };
		const session = _Session([receipt, receipt], recorded);
		const first = await _CognifyDataset(session, request);
		const replay = await _CognifyDataset(session, request);
		expect(replay).toEqual(first);
		expect(replay.pipelineRunId).toBe(_IDS.pipeline);
	});

	it.each([
		["dataset", { dataset_id: _IDS.other }],
		["operation", { operation_id: _IDS.other }],
		["digest", { input_evidence_digest: `sha256:${"b".repeat(64)}` }],
		["nonterminal", { status: "PipelineRunStarted" }],
		["unknown field", { secret: "provider detail" }],
	])("rejects a mismatched or nonterminal %s receipt", async function _RejectReceipt(_name, overrides)
	{
		const provider = _Response({ [_IDS.dataset]: _CompletedRun(overrides) });
		const request = { datasetId: _IDS.dataset, operationId: _IDS.operation, expectedInputEvidenceDigest: _DIGEST };
		await expect(_CognifyDataset(_Session([provider], _Recorded()), request)).rejects.toMatchObject({ error: MemoryGatewayErrorCodes.ProviderProtocol, deliveryState: MemoryMutationDeliveryStates.Ambiguous });
	});

	it("rejects result-map UUID case variants instead of collapsing their cardinality", async function _RejectCaseVariantRunKeys()
	{
		const provider = _Response({ [_IDS.dataset]: _CompletedRun(), [_IDS.dataset.toUpperCase()]: _CompletedRun() });
		const request = { datasetId: _IDS.dataset, operationId: _IDS.operation, expectedInputEvidenceDigest: _DIGEST };
		await expect(_CognifyDataset(_Session([provider], _Recorded()), request)).rejects.toMatchObject({ error: MemoryGatewayErrorCodes.ProviderProtocol, deliveryState: MemoryMutationDeliveryStates.Ambiguous });
	});

	it("keeps provider outages ambiguous and removes provider content from the error", async function _Outage()
	{
		const request = { datasetId: _IDS.dataset, operationId: _IDS.operation, expectedInputEvidenceDigest: _DIGEST };
		const failure = await _CognifyDataset(_Session([new Error("private fact and credential")], _Recorded()), request).catch(function _Capture(error: unknown) { return error; });
		expect(failure).toMatchObject({ error: MemoryGatewayErrorCodes.ProviderUnavailable, deliveryState: MemoryMutationDeliveryStates.Ambiguous });
		expect(String(failure)).not.toContain("private fact");
		expect(String(failure)).not.toContain("credential");
	});

	it("marks a provider conflict as proven not sent", async function _Conflict()
	{
		const request = { datasetId: _IDS.dataset, operationId: _IDS.operation, expectedInputEvidenceDigest: _DIGEST };
		await expect(_CognifyDataset(_Session([_Response({ error: "provider detail" }, 409)], _Recorded()), request)).rejects.toMatchObject({ error: MemoryGatewayErrorCodes.Conflict, deliveryState: MemoryMutationDeliveryStates.ProvenNotSent });
	});
});
