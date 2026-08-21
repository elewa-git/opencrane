import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

import { _CreateDurableExecutionQualificationSession } from "./durable-execution-qualification-session";
import type { _DurableExecutionQualificationInput, _DurableExecutionQualificationSession } from "./durable-execution-qualification-session.types";
import type { DurableExecutionConnectionEvidence, DurableExecutionQualificationOptions, DurableExecutionQualificationResult } from "./durable-execution-qualification.types";

interface _PendingSample
{
	/** Resolves with the handler's start time for one admitted task. */
	readonly started: Promise<number>;
	/** Records the handler's start time when the temporary task begins. */
	readonly resolve: (startedAt: number) => void;
}

interface _QualificationRuntime
{
	/** Creates the resource-owning live session, or an injected test session. */
	readonly createSession: (options: Parameters<typeof _CreateDurableExecutionQualificationSession>[0]) => _DurableExecutionQualificationSession;
	/** Reads the monotonic clock used for pickup latency. */
	readonly now: () => number;
	/** Delays admissions so workers return to idle polling between samples. */
	readonly wait: (milliseconds: number) => Promise<void>;
	/** Rejects a sample that never reaches its registered handler. */
	readonly withTimeout: (sample: Promise<number>, timeoutMs: number) => Promise<number>;
}

const _WarmupCount = 5;

/** Reject a live-gate integer before it can create an unbounded run. */
function _BoundedInteger(name: string, value: number, minimum: number, maximum: number): number
{
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${name} must be an integer from ${minimum} through ${maximum}.`);
	return value;
}

/**
 * Resolve a nearest-rank percentile from an already bounded sample set.
 *
 * Called by: {@link __QualifyDurableExecutionPickup} when it emits the safe Gate D2 report.
 */
export function _DurableExecutionQualificationPercentile(samples: readonly number[], percentile: number): number
{
	if (samples.length === 0 || percentile <= 0 || percentile > 1) throw new Error("A percentile requires samples and a rank from zero through one.");
	const sorted = [...samples].sort(function _Ascending(left, right) { return left - right; });
	return sorted[Math.max(0, Math.ceil(percentile * sorted.length) - 1)];
}

/** Create a local completion signal before its task is transactionally admitted. */
function _Pending(): _PendingSample
{
	let resolve = function _Uninitialized(_startedAt: number): void {};
	const started = new Promise<number>(function _RememberResolver(accept) { resolve = accept; });
	return { started, resolve };
}

/** Build public connection evidence without exposing database identity or failures. */
function _ConnectionEvidence(connectionCounts: readonly number[], expectedCount: number): DurableExecutionConnectionEvidence
{
	return connectionCounts.length !== expectedCount ? { available: false } : { available: true, peakConnections: Math.max(...connectionCounts) };
}

/**
 * Admit Gate D2 only when latency and complete connection-budget evidence both pass.
 *
 * Called by: {@link __QualifyDurableExecutionPickup} after every measured task and observation.
 */
export function _DurableExecutionQualificationPassed(p95: number, thresholdMs: number, connectionCeiling: number, connectionEvidence: DurableExecutionConnectionEvidence): boolean
{
	return p95 <= thresholdMs && connectionEvidence.available && connectionEvidence.peakConnections <= connectionCeiling;
}

/** Wait without reading wall-clock time into a latency result. */
async function _Wait(milliseconds: number): Promise<void>
{
	await new Promise<void>(function _Delay(resolve) { setTimeout(resolve, milliseconds); });
}

/** Fail a sample that was admitted but never reached its registered handler. */
async function _WithTimeout(sample: Promise<number>, timeoutMs: number): Promise<number>
{
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try
	{
		return await Promise.race([
			sample,
			new Promise<number>(function _Timeout(_resolve, reject) { timeout = setTimeout(function _Reject() { reject(new Error("Qualification task pickup timed out.")); }, timeoutMs); }),
		]);
	}
	finally
	{
		if (timeout !== undefined) clearTimeout(timeout);
	}
}

const _ProductionRuntime: _QualificationRuntime = {
	createSession: _CreateDurableExecutionQualificationSession,
	now: function _Now(): number { return performance.now(); },
	wait: _Wait,
	withTimeout: _WithTimeout,
};

/**
 * Measure idle-worker pickup through the real adapter and caller-owned Prisma transaction.
 *
 * The CLI invokes this only against a verified live silo. It returns `passed: false` when either
 * p95 exceeds the threshold or complete connection evidence exceeds the named ceiling. Admission,
 * timeout, ownership, or cleanup failures throw so an incomplete run cannot look like a gate result.
 *
 * Called by: `qualify-durable-execution.cli.ts` after the deploy wrapper verifies the exact release.
 */
export async function __QualifyDurableExecutionPickup(options: DurableExecutionQualificationOptions, runtime: _QualificationRuntime = _ProductionRuntime): Promise<DurableExecutionQualificationResult>
{
	const sampleCount = _BoundedInteger("sampleCount", options.sampleCount, 10, 500);
	const pollIntervalMs = _BoundedInteger("pollIntervalMs", options.pollIntervalMs, 10, 1_000);
	const thresholdMs = _BoundedInteger("thresholdMs", options.thresholdMs, 10, 5_000);
	const databasePoolSize = _BoundedInteger("databasePoolSize", options.databasePoolSize, 1, 8);
	const runId = randomUUID().replaceAll("-", "").slice(0, 20);
	const pending = new Map<number, _PendingSample>();
	const latencies: number[] = [];
	const connectionCounts: number[] = [];
	const session = runtime.createSession({ applicationName: `opencrane-d2-${runId}`, databasePoolSize, databaseUrl: options.databaseUrl, pollIntervalMs, queueName: `opencrane-absurd-qualification-${runId}`, runId, siloId: options.siloId });
	let runFailure: unknown;
	try
	{
		await session.start(function _TaskStarted(input: _DurableExecutionQualificationInput): void
		{
			const sample = pending.get(input.sampleIndex);
			if (sample === undefined) throw new Error("Qualification task has no pending sample.");
			pending.delete(input.sampleIndex);
			sample.resolve(runtime.now());
		});
		for (let sampleIndex = 0; sampleIndex < sampleCount + _WarmupCount; sampleIndex += 1)
		{
			await runtime.wait((pollIntervalMs * 2) + ((sampleIndex * 17) % pollIntervalMs));
			const sample = _Pending();
			pending.set(sampleIndex, sample);
			const admittedAt = runtime.now();
			await session.admit({ sampleIndex, siloId: options.siloId });
			const startedAt = await runtime.withTimeout(sample.started, Math.max(5_000, thresholdMs * 10));
			if (sampleIndex >= _WarmupCount) latencies.push(startedAt - admittedAt);
			const connectionCount = await session.connectionCount();
			if (connectionCount !== null) connectionCounts.push(connectionCount);
		}
	}
	catch (error)
	{
		runFailure = error;
	}
	await session.close();
	if (runFailure !== undefined) throw runFailure;
	const p50 = _DurableExecutionQualificationPercentile(latencies, 0.5);
	const p95 = _DurableExecutionQualificationPercentile(latencies, 0.95);
	const p99 = _DurableExecutionQualificationPercentile(latencies, 0.99);
	const connectionCeiling = databasePoolSize + 1;
	const connectionEvidence = _ConnectionEvidence(connectionCounts, sampleCount + _WarmupCount);
	return {
		passed: _DurableExecutionQualificationPassed(p95, thresholdMs, connectionCeiling, connectionEvidence),
		sampleCount,
		warmupCount: _WarmupCount,
		pollIntervalMs,
		thresholdMs,
		databasePoolSize,
		connectionCeiling,
		transport: "kubectl-port-forward",
		latencyMs: { p50, p95, p99, max: Math.max(...latencies) },
		connectionEvidence,
	};
}
