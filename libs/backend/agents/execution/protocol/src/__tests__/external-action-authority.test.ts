import { createHash } from "node:crypto";

import type { CompiledToolDefinition, RunInputSnapshot, RuntimeExternalActionCandidate } from "@opencrane/contracts";
import type { JsonValue } from "@opencrane/util";
import { __DigestCanonicalJson } from "@opencrane/backend/server/iam/authorization";
import type { ToolInvocationIntent, ToolInvocationReceipt, ToolInvocationRepository, ToolInvocationReservationResult } from "@opencrane/backend/server/iam/authorization";
import { describe, expect, it } from "vitest";

import { __ExecuteExternalAction } from "../external-action-authority.js";
import type { ExternalActionExecutor } from "../external-action-authority.types.js";

/** One granted tool revision the compiled input offers to the run. */
const TOOL: CompiledToolDefinition = { name: "search", toolRevisionId: "mcp-server:server-1", description: "search", requiresApproval: false, parametersSchema: { type: "object" } };

/** Immutable snapshot facts the authority binds a candidate to. */
function _snapshot(): RunInputSnapshot
{
	return { runId: "run-1", siloId: "silo-1", agentServiceId: "svc-1", agentRevisionId: "rev-1", identitySnapshot: { executionSubjectId: "user-1" } } as unknown as RunInputSnapshot;
}

/** Build a candidate whose argument digest is computed the same way the authority revalidates it. */
function _candidate(args: JsonValue, overrides: Partial<RuntimeExternalActionCandidate> = {}): RuntimeExternalActionCandidate
{
	return {
		protocolVersion: "opencrane.agent-runtime/v1",
		runtimeInstanceId: "instance-1",
		commandId: "command-1",
		candidateId: "candidate-1",
		runId: "run-1",
		attempt: 1,
		fence: 1,
		kind: "external_action",
		toolRevisionId: "mcp-server:server-1",
		toolInvocationId: "invocation-1",
		argumentsDigest: __DigestCanonicalJson(args),
		arguments: args,
		...overrides,
	};
}

/** In-memory reserve-before-dispatch tool-invocation repository keyed by fingerprint. */
class _Repository implements ToolInvocationRepository
{
	/** Recorded rows keyed by reservation id. */
	readonly rows = new Map<string, { state: string; receipt: ToolInvocationReceipt<JsonValue> }>();
	/** Fingerprints already reserved, mapped to their reservation id. */
	private readonly byFingerprint = new Map<string, string>();
	/** Seeded prior state simulating an earlier crash or completion. */
	constructor(private readonly seed?: ToolInvocationReservationResult<JsonValue>) {}
	/** Records the executor calls so a deferral or replay proves no dispatch happened. */
	reserveCalls = 0;

	async reserve<TResult>(intent: ToolInvocationIntent): Promise<ToolInvocationReservationResult<TResult>>
	{
		this.reserveCalls += 1;
		if (this.seed) return this.seed as unknown as ToolInvocationReservationResult<TResult>;
		const reservationId = `res-${intent.toolInvocationId}`;
		this.byFingerprint.set(intent.requestFingerprint, reservationId);
		this.rows.set(reservationId, { state: "Reserved", receipt: { toolInvocationId: intent.toolInvocationId, requestFingerprint: intent.requestFingerprint, result: null } });
		return { status: "reserved", reservationId } as ToolInvocationReservationResult<TResult>;
	}

	async markSucceeded<TResult>(reservationId: string, result: TResult): Promise<{ status: "succeeded"; receipt: ToolInvocationReceipt<TResult> } | { status: "conflict" }>
	{
		const row = this.rows.get(reservationId);
		if (!row || row.state !== "Reserved") return { status: "conflict" };
		row.state = "Succeeded";
		row.receipt = { ...row.receipt, result: result as unknown as JsonValue };
		return { status: "succeeded", receipt: row.receipt as unknown as ToolInvocationReceipt<TResult> };
	}

	async markFailed(reservationId: string, _failureCode: string): Promise<{ status: "failed" | "conflict" }>
	{
		const row = this.rows.get(reservationId);
		if (!row || row.state !== "Reserved") return { status: "conflict" };
		row.state = "Failed";
		return { status: "failed" };
	}
}

/** Executor that records dispatch and returns a fixed result. */
function _executor(result: JsonValue, calls: { count: number }): ExternalActionExecutor<JsonValue>
{
	return { async execute(): Promise<JsonValue> { calls.count += 1; return result; } };
}

describe("external action authority", function _suite()
{
	it("reserves before dispatch and completes the receipt", async function _executes()
	{
		const repository = new _Repository();
		const calls = { count: 0 };
		const result = await __ExecuteExternalAction(repository, { candidate: _candidate({ q: "a" }), snapshot: _snapshot(), compiledTools: [TOOL], approvalRequired: false }, _executor({ ok: true }, calls));
		expect(result.outcome).toBe("executed");
		expect(repository.reserveCalls).toBe(1);
		expect(calls.count).toBe(1);
		expect([...repository.rows.values()][0].state).toBe("Succeeded");
	});

	it("denies a candidate whose tool revision the snapshot never granted", async function _ungranted()
	{
		const repository = new _Repository();
		const calls = { count: 0 };
		const result = await __ExecuteExternalAction(repository, { candidate: _candidate({ q: "a" }, { toolRevisionId: "mcp-server:other" }), snapshot: _snapshot(), compiledTools: [TOOL], approvalRequired: false }, _executor({}, calls));
		expect(result).toEqual({ outcome: "denied", reason: "tool_revision_not_granted" });
		expect(repository.reserveCalls).toBe(0);
		expect(calls.count).toBe(0);
	});

	it("denies when the argument digest does not match the arguments", async function _digest()
	{
		const repository = new _Repository();
		const calls = { count: 0 };
		const result = await __ExecuteExternalAction(repository, { candidate: _candidate({ q: "a" }, { argumentsDigest: "sha256:tampered" }), snapshot: _snapshot(), compiledTools: [TOOL], approvalRequired: false }, _executor({}, calls));
		expect(result).toEqual({ outcome: "denied", reason: "arguments_digest_mismatch" });
		expect(repository.reserveCalls).toBe(0);
	});

	it("defers an approval-gated action at the reservation without dispatching", async function _deferred()
	{
		const repository = new _Repository();
		const calls = { count: 0 };
		const result = await __ExecuteExternalAction(repository, { candidate: _candidate({ q: "a" }), snapshot: _snapshot(), compiledTools: [TOOL], approvalRequired: true }, _executor({}, calls));
		expect(result.outcome).toBe("deferred");
		expect(repository.reserveCalls).toBe(1);
		expect(calls.count).toBe(0);
	});

	it("replays a succeeded receipt idempotently without a second dispatch", async function _replay()
	{
		const receipt: ToolInvocationReceipt<JsonValue> = { toolInvocationId: "invocation-1", requestFingerprint: "sha256:5f0f0b5c0a1d2e3f4a5b6c7d8e9f00112233445566778899aabbccddeeff0011", result: { ok: true } };
		const candidate = _candidate({ q: "a" });
		// Bind the seeded receipt to the exact fingerprint the authority will compute for the candidate.
		const repository = new _Repository({ status: "existing_succeeded", receipt: { ...receipt, requestFingerprint: _fingerprint(candidate) } });
		const calls = { count: 0 };
		const result = await __ExecuteExternalAction(repository, { candidate, snapshot: _snapshot(), compiledTools: [TOOL], approvalRequired: false }, _executor({}, calls));
		expect(result.outcome).toBe("replayed");
		expect(calls.count).toBe(0);
	});

	it("never re-executes a reserved or failed row", async function _noReexec()
	{
		const repository = new _Repository({ status: "existing_reserved" });
		const calls = { count: 0 };
		const result = await __ExecuteExternalAction(repository, { candidate: _candidate({ q: "a" }), snapshot: _snapshot(), compiledTools: [TOOL], approvalRequired: false }, _executor({}, calls));
		expect(result).toEqual({ outcome: "denied", reason: "invocation_replay" });
		expect(calls.count).toBe(0);
	});

	it("marks the invocation failed and denies when the executor throws", async function _failClosed()
	{
		const repository = new _Repository();
		const result = await __ExecuteExternalAction(repository, { candidate: _candidate({ q: "a" }), snapshot: _snapshot(), compiledTools: [TOOL], approvalRequired: false }, { async execute(): Promise<JsonValue> { throw new Error("obot custody unavailable"); } });
		expect(result).toEqual({ outcome: "denied", reason: "invocation_execution_failed" });
		expect([...repository.rows.values()][0].state).toBe("Failed");
	});
});

/** Recompute the authority's fingerprint so a seeded replay receipt can bind to the exact candidate. */
function _fingerprint(candidate: RuntimeExternalActionCandidate): string
{
	// Mirror `_requestFingerprint` in the authority exactly (JSON.stringify + SHA-256, not JCS).
	const canonical = JSON.stringify(["opencrane-tool-invocation-fingerprint-v1", candidate.runId, candidate.attempt, candidate.toolRevisionId, candidate.toolInvocationId, candidate.argumentsDigest]);
	return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}
