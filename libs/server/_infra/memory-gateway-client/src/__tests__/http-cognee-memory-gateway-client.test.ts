import { context, ROOT_CONTEXT } from "@opentelemetry/api";
import type { Context } from "@opentelemetry/api";
import { isTracingSuppressed } from "@opentelemetry/core";
import { beforeAll, describe, expect, it } from "vitest";

import { MemoryGatewayRemoteRefusalError, MemoryGatewayTransportError } from "../cognee-http.js";
import { __CreateHttpCogneeMemoryGatewayClient } from "../http-cognee-memory-gateway-client.js";
import { MemoryGatewayProtocolError } from "../personal-memory-record.js";
import { MemoryProvenanceIncompleteError } from "../memory-provenance.js";
import type { CogneeFetch, PersonalMemoryDeliveryKey, PersonalMemoryDeliveryLedger, PersonalMemoryDeliveryRecord } from "../http-cognee-memory-gateway-client.types.js";
import type { MemoryProvenance } from "../memory-gateway-client.types.js";

/** One recorded outbound exchange captured by the fetch seam. */
interface _RecordedRequest
{
	/** Absolute request URL as issued by the adapter. */
	readonly url: string;
	/** HTTP method of the exchange. */
	readonly method: string;
	/** Decoded JSON body, when the exchange carried one. */
	readonly body: Record<string, unknown> | null;
	/** Authorization header, when the exchange carried one. */
	readonly authorization: string | null;
	/** Whether the transport initiated this exchange with automatic child tracing suppressed. */
	readonly tracingSuppressed: boolean;
}

/** Active context maintained by the synchronous test context manager. */
let _activeContext = ROOT_CONTEXT;

/** Install enough context propagation to observe the fetch suppression synchronously at the test seam. */
function _RegisterContextManager(): void
{
	context.setGlobalContextManager({
		active(): Context
		{
			return _activeContext;
		},
		with<A extends unknown[], F extends (...args: A) => ReturnType<F>>(next: Context, callback: F, thisArg?: ThisParameterType<F>, ...args: A): ReturnType<F>
		{
			const previous = _activeContext;
			_activeContext = next;
			try
			{
				return callback.apply(thisArg, args);
			}
			finally
			{
				_activeContext = previous;
			}
		},
		bind<T>(_context: Context, target: T): T
		{
			return target;
		},
		enable()
		{
			return this;
		},
		disable()
		{
			return this;
		},
	});
}

beforeAll(function _registerContextManager(): void
{
	_RegisterContextManager();
});

/** In-memory ledger double exercising the real replay and conflict semantics. */
class _FakeLedger implements PersonalMemoryDeliveryLedger
{
	/** Durable deliveries keyed by their canonical delivery coordinates. */
	readonly deliveries = new Map<string, PersonalMemoryDeliveryRecord>();

	/** Datasets resolvable per fact id, seeded by tests. */
	readonly factDatasets = new Map<string, string>();

	/** Forces the next recordDelivery to report a concurrent writer. */
	conflictOnce = false;

	/** Build the canonical map key for one delivery. */
	private _key(key: PersonalMemoryDeliveryKey): string
	{
		return `${key.siloId}|${key.cogneeDatasetId}|${key.subjectId}|${key.idempotencyKey}`;
	}

	/** Return durable evidence for a delivery key. */
	async findDelivery(key: PersonalMemoryDeliveryKey): Promise<PersonalMemoryDeliveryRecord | null>
	{
		return this.deliveries.get(this._key(key)) ?? null;
	}

	/** Persist evidence unless a concurrent writer is simulated or the key is taken. */
	async recordDelivery(key: PersonalMemoryDeliveryKey, record: PersonalMemoryDeliveryRecord): Promise<"recorded" | "conflict_existing">
	{
		if (this.conflictOnce)
		{
			this.conflictOnce = false;
			return "conflict_existing";
		}
		if (this.deliveries.has(this._key(key))) return "conflict_existing";
		this.deliveries.set(this._key(key), record);
		return "recorded";
	}

	/** Resolve the dataset holding a fact, or null when unknown. */
	async resolveFactDataset(reference: { readonly siloId: string; readonly subjectId: string; readonly factId: string }): Promise<{ readonly cogneeDatasetId: string } | null>
	{
		const dataset = this.factDatasets.get(reference.factId);
		return dataset === undefined ? null : { cogneeDatasetId: dataset };
	}

	/** Replace a corrected fact id while retaining its resolved dataset. */
	async replaceFactReference(reference: { readonly siloId: string; readonly subjectId: string; readonly factId: string; readonly replacementFactId: string }): Promise<"replaced" | "missing">
	{
		const dataset = this.factDatasets.get(reference.factId);
		if (dataset === undefined) return "missing";
		this.factDatasets.delete(reference.factId);
		this.factDatasets.set(reference.replacementFactId, dataset);
		return "replaced";
	}
}

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
		recorded.push({ url: url.pathname, method: init?.method ?? "GET", body: rawBody !== null && isJson ? JSON.parse(rawBody) as Record<string, unknown> : null, authorization: headers.get("authorization"), tracingSuppressed: isTracingSuppressed(context.active()) });
		const answer = answers[url.pathname];
		if (answer) return answer();
		return new Response(null, { status: 204 });
	};
}

/** Builds a JSON response. */
function _json(payload: unknown, status = 200): Response
{
	return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

/** Creates a client bound to the recording seam and fake ledger. */
function _client(recorded: _RecordedRequest[], answers: Record<string, () => Response>, ledger: _FakeLedger, extra: Partial<Parameters<typeof __CreateHttpCogneeMemoryGatewayClient>[0]> = {})
{
	return __CreateHttpCogneeMemoryGatewayClient({ baseUrl: "http://memory-gateway:8080", requestTimeoutMilliseconds: 30_000, ledger, serverTokenFile: "/var/run/opencrane/memory-gateway/token", readServerToken: async function _readToken() { return "projected-token"; }, fetch: _fetchSeam(recorded, answers), ...extra });
}

describe("Cognee memory gateway recall", function _RecallSuite()
{
	it("searches the frozen dataset and bounds the projected facts", async function _Query()
	{
		const recorded: _RecordedRequest[] = [];
		const answers = { "/api/v1/search": function _search() { return _json({ results: [{ id: "f1", text: "one" }, { id: "f2", text: "two" }, { id: "f3", text: "three" }] }); } };
		const result = await _client(recorded, answers, new _FakeLedger()).query({ siloId: "silo-1", cogneeDatasetId: "ds-1", subjectId: "user-1", query: "what", maxResults: 2 });

		expect(result.facts).toEqual([{ factId: "f1", content: "one" }, { factId: "f2", content: "two" }]);
		expect(recorded[0].body).toMatchObject({ query: "what", search_type: "CHUNKS", datasets: ["ds-1"], top_k: 2 });
	});

	it("drops an entry without a gateway-minted id rather than synthesising one", async function _DropsMalformed()
	{
		const answers = { "/api/v1/search": function _search() { return _json({ results: [{ text: "orphan" }, { id: "f2", text: "kept" }] }); } };
		const result = await _client([], answers, new _FakeLedger()).query({ siloId: "silo-1", cogneeDatasetId: "ds-1", subjectId: "user-1", query: "q", maxResults: 10 });
		expect(result.facts).toEqual([{ factId: "f2", content: "kept" }]);
	});

	it("rejects an unrecognised response instead of returning an empty recall", async function _RejectsUnknownShape()
	{
		const answers = { "/api/v1/search": function _search() { return _json({ unexpected: true }); } };
		await expect(_client([], answers, new _FakeLedger()).query({ siloId: "silo-1", cogneeDatasetId: "ds-1", subjectId: "user-1", query: "q", maxResults: 5 })).rejects.toBeInstanceOf(MemoryGatewayProtocolError);
	});
});

describe("Cognee personal-memory retention", function _RecordSuite()
{
	/** Command shared by the retention cases. */
	const _command = { siloId: "silo-1", subjectId: "user-1", cogneeDatasetId: "ds-1", content: "remember this", idempotencyKey: "key-1" };

	/** Answers accepting an add and a cognify. */
	const _answers = { "/api/v1/add": function _add() { return _json({ id: "fact-99" }); }, "/api/v1/cognify": function _cognify() { return _json({ ok: true }); } };

	it("records a fresh fact and returns canonical gateway evidence", async function _Fresh()
	{
		const recorded: _RecordedRequest[] = [];
		const ledger = new _FakeLedger();
		const result = await _client(recorded, _answers, ledger).recordPersonalFact(_command);

		expect(result).toMatchObject({ outcome: "recorded", idempotent: false, cogneeExternalId: "fact-99" });
		expect((result as { contentDigest: string }).contentDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
		expect(ledger.deliveries.size).toBe(1);
		expect(recorded.some(function _isAdd(entry) { return entry.url === "/api/v1/add"; })).toBe(true);
	});

	it("replays an identical delivery without any remote write", async function _Replay()
	{
		const ledger = new _FakeLedger();
		await _client([], _answers, ledger).recordPersonalFact(_command);

		const replayRecorded: _RecordedRequest[] = [];
		const replay = await _client(replayRecorded, _answers, ledger).recordPersonalFact(_command);

		expect(replay).toMatchObject({ outcome: "recorded", idempotent: true, cogneeExternalId: "fact-99" });
		expect(replayRecorded).toHaveLength(0);
	});

	it("denies a reused key carrying different content", async function _Conflict()
	{
		const ledger = new _FakeLedger();
		await _client([], _answers, ledger).recordPersonalFact(_command);
		const denied = await _client([], _answers, ledger).recordPersonalFact({ ..._command, content: "something else" });
		expect(denied).toEqual({ outcome: "denied", reason: "idempotency_conflict" });
	});

	it("yields to a concurrent writer that won the delivery key", async function _Race()
	{
		// The key is free on the first lookup, so the write proceeds; by the time evidence is bound a
		// competing writer owns the key with different content, which must deny rather than overwrite.
		const ledger = new _FakeLedger();
		ledger.conflictOnce = true;
		let lookups = 0;
		ledger.findDelivery = async function _findDelivery(): Promise<PersonalMemoryDeliveryRecord | null>
		{
			lookups += 1;
			return lookups === 1 ? null : { contentDigest: `sha256:${"b".repeat(64)}`, cogneeExternalId: "winner" };
		};

		const result = await _client([], _answers, ledger).recordPersonalFact(_command);
		expect(result).toEqual({ outcome: "denied", reason: "idempotency_conflict" });
		expect(lookups).toBe(2);
	});

	it("retains delivery evidence when indexing fails so a retry cannot duplicate the fact", async function _CognifyFailure()
	{
		const answers = { "/api/v1/add": function _add() { return _json({ id: "fact-1" }); }, "/api/v1/cognify": function _cognify() { return new Response("boom", { status: 500 }); } };
		const ledger = new _FakeLedger();
		const first = await _client([], answers, ledger).recordPersonalFact(_command);
		const retryRecorded: _RecordedRequest[] = [];
		const replay = await _client(retryRecorded, answers, ledger).recordPersonalFact(_command);
		expect(first).toMatchObject({ outcome: "recorded", idempotent: false, cogneeExternalId: "fact-1" });
		expect(replay).toMatchObject({ outcome: "recorded", idempotent: true, cogneeExternalId: "fact-1" });
		expect(retryRecorded).toHaveLength(0);
	});

	it("fails closed when the gateway mints no identifier", async function _NoIdentifier()
	{
		const answers = { "/api/v1/add": function _add() { return _json({ accepted: true }); } };
		await expect(_client([], answers, new _FakeLedger()).recordPersonalFact(_command)).rejects.toBeInstanceOf(MemoryGatewayProtocolError);
	});
});

describe("Cognee fact mutation", function _MutationSuite()
{
	it("replaces the resolved remote identity so correction can be followed by forgetting", async function _Correct()
	{
		const recorded: _RecordedRequest[] = [];
		const ledger = new _FakeLedger();
		ledger.factDatasets.set("fact-1", "ds-7");
		const answers = { "/api/v1/add": function _add() { return _json({ id: "fact-2" }); } };
		await _client(recorded, answers, ledger).correct({ siloId: "silo-1", subjectId: "user-1", factId: "fact-1", correctedContent: "fixed" });

		expect(recorded[0]).toMatchObject({ url: "/api/v1/add", body: { data: "fixed", datasetName: "ds-7" } });
		expect(recorded[2]).toMatchObject({ url: "/api/v1/datasets/ds-7/data/fact-1", method: "DELETE" });
		await _client(recorded, answers, ledger).forget({ siloId: "silo-1", subjectId: "user-1", factId: "fact-2" });
		expect(recorded[3]).toMatchObject({ url: "/api/v1/datasets/ds-7/data/fact-2", method: "DELETE" });
	});

	it("does not delete the current fact when the replacement cannot be indexed", async function _CorrectionIndexFailure()
	{
		const recorded: _RecordedRequest[] = [];
		const ledger = new _FakeLedger();
		ledger.factDatasets.set("fact-1", "ds-7");
		const answers = { "/api/v1/add": function _add() { return _json({ id: "fact-2" }); }, "/api/v1/cognify": function _cognify() { return new Response("unavailable", { status: 503 }); } };
		await expect(_client(recorded, answers, ledger).correct({ siloId: "silo-1", subjectId: "user-1", factId: "fact-1", correctedContent: "fixed" })).rejects.toBeInstanceOf(MemoryGatewayTransportError);
		expect(recorded.some(function _deletesOldFact(entry) { return entry.url === "/api/v1/datasets/ds-7/data/fact-1"; })).toBe(false);
		expect(ledger.factDatasets.get("fact-1")).toBe("ds-7");
	});

	it("retains the old mapping after a delete failure so correction can be retried", async function _CorrectionDeleteFailure()
	{
		const recorded: _RecordedRequest[] = [];
		const ledger = new _FakeLedger();
		ledger.factDatasets.set("fact-1", "ds-7");
		const answers = { "/api/v1/add": function _add() { return _json({ id: "fact-2" }); }, "/api/v1/datasets/ds-7/data/fact-1": function _delete() { return new Response("unavailable", { status: 503 }); } };
		await expect(_client(recorded, answers, ledger).correct({ siloId: "silo-1", subjectId: "user-1", factId: "fact-1", correctedContent: "fixed" })).rejects.toBeInstanceOf(MemoryGatewayTransportError);
		expect(ledger.factDatasets.get("fact-1")).toBe("ds-7");
	});

	it("refuses to mutate a fact it cannot resolve", async function _UnknownFact()
	{
		const recorded: _RecordedRequest[] = [];
		await expect(_client(recorded, {}, new _FakeLedger()).forget({ siloId: "silo-1", subjectId: "user-1", factId: "ghost" })).rejects.toBeInstanceOf(MemoryGatewayRemoteRefusalError);
		expect(recorded).toHaveLength(0);
	});
});

describe("Cognee scoped knowledge", function _ScopedSuite()
{
	it("rejects incomplete provenance before any transport", async function _ProvenanceFirst()
	{
		const recorded: _RecordedRequest[] = [];
		const command = { siloId: "silo-1", cogneeDatasetId: "frozen-team-dataset", content: "shared", provenance: { ..._PROVENANCE, runId: "" } };
		await expect(_client(recorded, {}, new _FakeLedger()).injectScoped(command)).rejects.toBeInstanceOf(MemoryProvenanceIncompleteError);
		expect(recorded).toHaveLength(0);
	});

	it("writes a provenance envelope into the caller-frozen scoped dataset", async function _Inject()
	{
		const recorded: _RecordedRequest[] = [];
		const answers = { "/api/v1/add": function _add() { return _json({ id: "f1" }); } };
		await _client(recorded, answers, new _FakeLedger()).injectScoped({ siloId: "silo-1", cogneeDatasetId: "frozen-team-dataset", content: "shared", provenance: _PROVENANCE });

		expect(recorded[0].body).toMatchObject({ datasetName: "frozen-team-dataset" });
		expect(JSON.parse(String(recorded[0].body?.["data"]))).toEqual({ v: 1, content: "shared", provenance: _PROVENANCE });
	});

	it("recalls attributable records and drops unattributable ones", async function _Recall()
	{
		const answers = {
			"/api/v1/search": function _search()
			{
				return _json({ results: [
					{ id: "f1", text: JSON.stringify({ v: 1, content: "kept", provenance: _PROVENANCE }) },
					{ id: "f2", text: JSON.stringify({ v: 1, content: "no provenance" }) },
					{ id: "f3", text: "not an envelope" },
				] });
			},
		};
		const result = await _client([], answers, new _FakeLedger()).recallScoped({ siloId: "silo-1", cogneeDatasetId: "frozen-team-dataset", query: "q", maxResults: 10 });
		expect(result.facts).toEqual([{ factId: "f1", content: "kept", provenance: _PROVENANCE }]);
	});

});

describe("Cognee transport and authentication", function _TransportSuite()
{
	it("maps an HTTP failure to a bounded transport code", async function _HttpFailure()
	{
		const answers = { "/api/v1/search": function _search() { return new Response("no", { status: 503 }); } };
		const failure = await _client([], answers, new _FakeLedger()).query({ siloId: "s", cogneeDatasetId: "d", subjectId: "u", query: "q", maxResults: 1 }).catch(function _capture(error: unknown) { return error; });
		expect(failure).toBeInstanceOf(MemoryGatewayTransportError);
		expect((failure as MemoryGatewayTransportError).code).toBe("http_503");
	});

	it("refuses a body beyond the protocol ceiling", async function _Oversize()
	{
		const answers = { "/api/v1/search": function _search() { return new Response("x", { status: 200, headers: { "content-type": "application/json", "content-length": String(512 * 1024) } }); } };
		const failure = await _client([], answers, new _FakeLedger()).query({ siloId: "s", cogneeDatasetId: "d", subjectId: "u", query: "q", maxResults: 1 }).catch(function _capture(error: unknown) { return error; });
		expect((failure as MemoryGatewayTransportError).code).toBe("oversize");
	});

	it("attaches a fresh projected server token to every gateway request", async function _Auth()
	{
		const recorded: _RecordedRequest[] = [];
		const answers = {
			"/api/v1/search": function _search() { return _json({ results: [] }); },
		};
		const client = _client(recorded, answers, new _FakeLedger(), { readServerToken: async function _readToken() { return "projected-token"; } });
		const result = await client.query({ siloId: "s", cogneeDatasetId: "d", subjectId: "u", query: "q", maxResults: 5 });

		expect(result.facts).toEqual([]);
		expect(recorded).toHaveLength(1);
		expect(recorded[0].authorization).toBe("Bearer projected-token");
		expect(recorded[0].tracingSuppressed).toBe(true);
	});
});
