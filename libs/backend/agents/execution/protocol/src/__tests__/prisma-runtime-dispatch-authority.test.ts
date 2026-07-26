import type { PrismaClient } from "@prisma/client";
import type { Logger } from "@opencrane/observability";
import { describe, expect, it, vi } from "vitest";

import { AGENT_RUNTIME_PROTOCOL_V1, type CompiledRunInput, type RuntimeCandidate, type RuntimeCommandEnvelope } from "@opencrane/contracts";

import { PrismaRuntimeDispatchAuthority } from "../prisma-runtime-dispatch-authority.js";
import type { RunInputCompiler, RuntimeExternalActionRunner, RuntimeStreamWorkloadIdentity } from "../prisma-runtime-dispatch-authority.types.js";
import type { RuntimeProtocolClock } from "../runtime-protocol-authority.types.js";

/** Fixed reviewed identity for the registered runtime Pod under test. */
const _identity: RuntimeStreamWorkloadIdentity = { subject: "system:serviceaccount:runtime-ns:agent-runtime-personal", namespace: "runtime-ns", serviceAccountName: "agent-runtime-personal", podUid: "pod-1" };

/** Fixed stream-open message from the connecting runtime instance. */
const _open = { protocolVersion: AGENT_RUNTIME_PROTOCOL_V1, runtimeInstanceId: "instance-1", podUid: "pod-1" } as const;

/** Trusted server clock fixed inside the assignment lease for deterministic tests. */
const _clock = { nowEpochMs(): number { return Date.parse("2026-07-20T00:01:00.000Z"); } };

/** Mutable command-stream row mirrored from the runtime.prisma model. */
interface FakeStreamRow
{
	/** Run identifier. */
	runId: string;
	/** Positive attempt. */
	attempt: number;
	/** Server-owned lease fence. */
	fence: number;
	/** Per-attempt input generation. */
	inputGeneration: number;
	/** Bound runtime instance, or null when released. */
	runtimeInstanceId: string | null;
	/** Next required command sequence. */
	nextCommandSequence: number;
	/** Accepted candidate ids. */
	acceptedCandidateIds: string[];
}

/** Mutable dispatched-command row mirrored from the runtime.prisma model. */
interface FakeCommandRow
{
	/** Run identifier. */
	runId: string;
	/** Positive attempt. */
	attempt: number;
	/** Monotonic sequence. */
	sequence: number;
	/** Idempotency key. */
	commandId: string;
	/** Command kind. */
	kind: string;
	/** Server-owned fence. */
	fence: number;
	/** Persisted resume payload, if any. */
	payload?: unknown;
	/** Issuance instant. */
	issuedAt: Date;
	/** Hard expiry. */
	expiresAt: Date;
}

/** Mutable durable retry row mirrored from the runtime retry-budget model. */
interface FakeExternalActionRetryRow
{
	/** Logical run identifier. */
	runId: string;
	/** Positive attempt identifier. */
	attempt: number;
	/** Idempotent runtime candidate identifier. */
	candidateId: string;
	/** Number of server-granted retries already consumed. */
	retryCount: number;
	/** Hard server-owned retry deadline. */
	retryDeadlineAt: Date;
}

/** Options controlling the durable state the fake exposes to the adapter. */
interface FakeOptions
{
	/** Prisma run-state enum member for the owning run. */
	readonly runState: string;
	/** Registered Pod UID, or null to simulate an unregistered assignment. */
	readonly podUid?: string | null;
	/** Assignment state, defaulting to the registered state. */
	readonly assignmentState?: string;
	/** Optional composition-root runner invoked for an admitted external-action candidate. */
	readonly externalActionRunner?: RuntimeExternalActionRunner;
	/** Optional structured logger injected to assert handled dispatch failures remain observable. */
	readonly logger?: Logger;
	/** Optional trusted clock for retry-window expiry assertions. */
	readonly clock?: RuntimeProtocolClock;
	/** Approved deferred-tool results available for a resume frame. */
	readonly approvedDeferredResults?: readonly unknown[];
}

/** Minimal in-memory Prisma double covering only the reads and writes the adapter performs. */
function _fakePrisma(options: FakeOptions): { prisma: PrismaClient; streams: FakeStreamRow[]; commands: FakeCommandRow[]; retries: FakeExternalActionRetryRow[]; approvals: { id: string; deferredToolResult: unknown; resumeTokenHash: string | null }[] }
{
	const streams: FakeStreamRow[] = [];
	const commands: FakeCommandRow[] = [];
	const retries: FakeExternalActionRetryRow[] = [];
	const approvals: { id: string; deferredToolResult: unknown; resumeTokenHash: string | null }[] = [...(options.approvedDeferredResults ?? [])].map(function _row(result, index) { return { id: `approval-${index}`, deferredToolResult: result, resumeTokenHash: `hash-${index}` }; });
	const assignment = { runId: "run-1", attempt: 1, agentServiceId: "svc-1", agentRevisionId: "rev-1", siloId: "silo-1", subjectId: "user-1", audience: "opencrane-agent-runtime", serviceAccountName: _identity.serviceAccountName, namespace: _identity.namespace, workloadKind: "Job", workloadUid: "wl-1", workloadProfile: "profile", podUid: options.podUid === undefined ? "pod-1" : options.podUid, state: options.assignmentState ?? "Registered", expiresAt: new Date("2026-07-20T00:05:00.000Z"), createdAt: new Date("2026-07-20T00:00:00.000Z") };
	const run = { id: "run-1", attempt: 1, agentServiceId: "svc-1", agentRevisionId: "rev-1", siloId: "silo-1", state: options.runState, inputSnapshotDigest: "sha256:snap" };
	const snapshot = { runId: "run-1", siloId: "silo-1", agentServiceId: "svc-1", agentRevisionId: "rev-1", snapshotVersion: 1, threadId: null, messageIds: [], personaRevisionId: null, preferenceFactIds: [], artifactRevisionIds: [], skillRevisionIds: [], memoryFacts: [], memoryQueryPolicy: {}, toolGrantIds: [], modelRoute: {}, budgetPolicy: {}, identitySnapshot: { executionSubjectId: "user-1", fleetMembershipRevision: 3 }, capabilitySetDigest: "sha256:cap", effectiveContractDigest: "sha256:contract", promptCompilerVersion: "v1", digest: "sha256:snap", compiledAt: new Date("2026-07-20T00:00:00.000Z") };

	/** Return whether a stream row satisfies the guard fields present in a where clause. */
	function _streamMatches(row: FakeStreamRow, where: Record<string, unknown>): boolean
	{
		if (row.runId !== where["runId"] || row.attempt !== where["attempt"]) return false;
		if ("nextCommandSequence" in where && row.nextCommandSequence !== where["nextCommandSequence"]) return false;
		if ("runtimeInstanceId" in where && row.runtimeInstanceId !== where["runtimeInstanceId"]) return false;
		return true;
	}

	const client = {
		async $transaction(run_: (tx: unknown) => Promise<unknown>) { return run_(client); },
		async $queryRaw() { return []; },
		workloadAssignment: {
			async findUnique(args: { where: { namespace_podUid?: { namespace: string; podUid: string } } })
			{
				const key = args.where.namespace_podUid;
				return key && assignment.podUid === key.podUid && assignment.namespace === key.namespace ? assignment : null;
			},
		},
		agentRun: { async findUnique(args: { where: { id: string } }) { return args.where.id === run.id ? run : null; } },
		runInputSnapshot: { async findUnique(args: { where: { runId_digest?: { runId: string; digest: string } } }) { return args.where.runId_digest && args.where.runId_digest.digest === snapshot.digest ? snapshot : null; } },
		runtimeCommandStream: {
			async findUnique(args: { where: { runId_attempt: { runId: string; attempt: number } } }) { return streams.find(row => row.runId === args.where.runId_attempt.runId && row.attempt === args.where.runId_attempt.attempt) ?? null; },
			async create(args: { data: { runId: string; attempt: number; runtimeInstanceId: string } }) { const row = { runId: args.data.runId, attempt: args.data.attempt, fence: 1, inputGeneration: 0, runtimeInstanceId: args.data.runtimeInstanceId, nextCommandSequence: 1, acceptedCandidateIds: [] }; streams.push(row); return row; },
			async updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> })
			{
				let count = 0;
				for (const row of streams.filter(candidate => _streamMatches(candidate, args.where)))
				{
					count += 1;
					if ("nextCommandSequence" in args.data) row.nextCommandSequence = args.data["nextCommandSequence"] as number;
					if ("runtimeInstanceId" in args.data) row.runtimeInstanceId = args.data["runtimeInstanceId"] as string | null;
					const candidatePush = (args.data["acceptedCandidateIds"] as { push?: string } | undefined)?.push;
					if (typeof candidatePush === "string") row.acceptedCandidateIds.push(candidatePush);
				}
				return { count };
			},
		},
		runtimeDispatchedCommand: {
			async findMany(args: { where: { runId: string; attempt: number } }) { return commands.filter(row => row.runId === args.where.runId && row.attempt === args.where.attempt).sort((left, right) => left.sequence - right.sequence); },
			async create(args: { data: FakeCommandRow }) { commands.push({ ...args.data }); return args.data; },
		},
		runtimeExternalActionRetry: {
			async findUnique(args: { where: { runId_attempt_candidateId: { runId: string; attempt: number; candidateId: string } } })
			{
				const key = args.where.runId_attempt_candidateId;
				const row = retries.find(candidate => candidate.runId === key.runId && candidate.attempt === key.attempt && candidate.candidateId === key.candidateId);
				return row === undefined ? null : { ...row };
			},
			async create(args: { data: FakeExternalActionRetryRow })
			{
				retries.push({ ...args.data });
				return args.data;
			},
			async updateMany(args: { where: { runId: string; attempt: number; candidateId: string; retryCount: number }; data: { retryCount: { increment: number } } })
			{
				const row = retries.find(candidate => candidate.runId === args.where.runId && candidate.attempt === args.where.attempt && candidate.candidateId === args.where.candidateId && candidate.retryCount === args.where.retryCount);
				if (row === undefined) return { count: 0 };
				row.retryCount += args.data.retryCount.increment;
				return { count: 1 };
			},
		},
		approvalRequest: {
			async findMany() { return approvals.filter(row => row.resumeTokenHash !== null); },
			async updateMany(args: { where: { id: { in: string[] } }; data: { resumeTokenHash: null } })
			{
				let count = 0;
				for (const row of approvals.filter(candidate => args.where.id.in.includes(candidate.id))) { row.resumeTokenHash = args.data.resumeTokenHash; count += 1; }
				return { count };
			},
		},
	};
	return { prisma: client as unknown as PrismaClient, streams, commands, retries, approvals };
}

/** Deterministic fake compiler: same snapshot digest always yields byte-identical compiled input. */
const _compileRunInput: RunInputCompiler = async function _compile(snapshot): Promise<CompiledRunInput>
{
	return { promptCompilerVersion: "v1", runId: snapshot.runId, attempt: 1, instructions: "compiled", messages: [], tools: [], model: { modelAlias: "silo-default", maxOutputTokens: null }, budget: { maxTotalTokens: null, maxCostUsdMicros: null, maxToolInvocations: null, wallClockDeadlineEpochMs: null }, digest: `sha256:${snapshot.digest}` };
};

/** Build the adapter under test over a fake with the requested durable state. */
function _authority(options: FakeOptions)
{
	const fake = _fakePrisma(options);
	return { authority: new PrismaRuntimeDispatchAuthority(fake.prisma, { namespace: "runtime-ns", commandTtlMilliseconds: 60_000, externalActionRetryLimit: 3, externalActionRetryWindowMilliseconds: 30_000 }, _compileRunInput, options.externalActionRunner, options.clock ?? _clock, options.logger), ...fake };
}

/** Build a runtime event candidate bound to a dispatched command. */
function _candidate(commandId: string): RuntimeCandidate
{
	return { protocolVersion: AGENT_RUNTIME_PROTOCOL_V1, runtimeInstanceId: "instance-1", commandId, candidateId: "candidate-1", runId: "run-1", attempt: 1, fence: 1, kind: "event", eventType: "run.attempt_acknowledged", payload: {} };
}

describe("PrismaRuntimeDispatchAuthority", function _describeDispatchAuthority()
{
	it("mints one start_attempt command, advances the sequence, and persists it durably", async function _mintsStart()
	{
		const context = _authority({ runState: "Running" });

		const command = await context.authority.__NextCommand(_identity, _open, 0);

		expect(command?.kind).toBe("start_attempt");
		expect(command?.sequence).toBe(1);
		expect(context.commands).toHaveLength(1);
		expect(context.streams[0]?.nextCommandSequence).toBe(2);
		expect(command?.kind === "start_attempt" ? command.payload.compiledInput.digest : null).toBe("sha256:sha256:snap");
	});

	it("idempotently redelivers the same start command to a reconnecting instance", async function _redelivers()
	{
		const context = _authority({ runState: "Running" });

		const first = await context.authority.__NextCommand(_identity, _open, 0);
		const redelivered = await context.authority.__NextCommand(_identity, _open, 0);

		expect(redelivered).toEqual(first);
		expect(context.commands).toHaveLength(1);
		expect(context.streams[0]?.nextCommandSequence).toBe(2);
	});

	it("returns null once the sole start command is already at the connection frontier", async function _noneDue()
	{
		const context = _authority({ runState: "Running" });

		await context.authority.__NextCommand(_identity, _open, 0);
		const next = await context.authority.__NextCommand(_identity, _open, 1);

		expect(next).toBeNull();
	});

	it("mints no command for a terminal run", async function _terminalRun()
	{
		const context = _authority({ runState: "Completed" });

		expect(await context.authority.__NextCommand(_identity, _open, 0)).toBeNull();
		expect(context.commands).toHaveLength(0);
	});

	it("mints one cancel_attempt as a positive stop signal while cancelling", async function _mintsCancel()
	{
		const context = _authority({ runState: "Cancelling" });

		const command = await context.authority.__NextCommand(_identity, _open, 0);

		expect(command?.kind).toBe("cancel_attempt");
		expect(command?.kind === "cancel_attempt" ? command.payload.reason : null).toBe("cancelled");
		expect(context.commands).toHaveLength(1);
		// A late candidate is refused while cancelling, so cancelled output cannot reopen the run.
		const late = await context.authority.__AdmitCandidate(_identity, _candidate(command?.commandId ?? "command-1"));
		expect(late.accepted).toBe(false);
	});

	it("mints a resume_attempt carrying the approved deferred results after start", async function _mintsResume()
	{
		const context = _authority({ runState: "Running", approvedDeferredResults: [{ ok: true }] });

		const start = await context.authority.__NextCommand(_identity, _open, 0);
		const resume = await context.authority.__NextCommand(_identity, _open, 1);

		expect(start?.kind).toBe("start_attempt");
		expect(resume?.kind).toBe("resume_attempt");
		expect(resume?.kind === "resume_attempt" ? resume.payload.deferredToolResults : null).toEqual([{ ok: true }]);
	});

	it("consumes the single-use resume token so no duplicate resume is minted", async function _singleUseResume()
	{
		const context = _authority({ runState: "Running", approvedDeferredResults: [{ ok: true }] });

		await context.authority.__NextCommand(_identity, _open, 0);
		await context.authority.__NextCommand(_identity, _open, 1);
		// The resume token is now consumed; a further poll past the resume frame mints nothing.
		const afterResume = await context.authority.__NextCommand(_identity, _open, 2);

		expect(afterResume).toBeNull();
		expect(context.approvals.every(row => row.resumeTokenHash === null)).toBe(true);
		expect(context.commands.filter(row => row.kind === "ResumeAttempt")).toHaveLength(1);
	});

	it("redelivers a resume frame byte-identically after its token was consumed", async function _resumeRedeliver()
	{
		const context = _authority({ runState: "Running", approvedDeferredResults: [{ ok: true }] });

		await context.authority.__NextCommand(_identity, _open, 0);
		const resume = await context.authority.__NextCommand(_identity, _open, 1);
		const redelivered = await context.authority.__NextCommand(_identity, _open, 1);

		expect(redelivered).toEqual(resume);
	});

	it("dispatches an admitted external-action candidate through the injected runner", async function _runsExternalAction()
	{
		let ran = 0;
		const context = _authority({ runState: "Running", externalActionRunner: { async run() { ran += 1; return { outcome: "completed" as const }; } } });
		const start = await context.authority.__NextCommand(_identity, _open, 0);
		const candidate: RuntimeCandidate = { protocolVersion: AGENT_RUNTIME_PROTOCOL_V1, runtimeInstanceId: "instance-1", commandId: start?.commandId ?? "command-1", candidateId: "candidate-ext", runId: "run-1", attempt: 1, fence: 1, kind: "external_action", toolRevisionId: "mcp-server:server-1", toolInvocationId: "invocation-1", argumentsDigest: "sha256:d", arguments: { q: "a" } };

		const result = await context.authority.__AdmitCandidate(_identity, candidate);

		expect(result.accepted).toBe(true);
		expect(ran).toBe(1);
	});

	it("retries only an explicit pre-reservation runner failure within its durable server budget", async function _surfacesExternalActionFailure()
	{
		let attempts = 0;
		const error = new Error("temporary tool authority outage");
		const logger = { error: vi.fn() } as unknown as Logger;
		const context = _authority({ runState: "Running", logger, externalActionRunner: { async run() { attempts += 1; return { outcome: "retryable" as const, error }; } } });
		const start = await context.authority.__NextCommand(_identity, _open, 0);
		const candidate: RuntimeCandidate = { protocolVersion: AGENT_RUNTIME_PROTOCOL_V1, runtimeInstanceId: "instance-1", commandId: start?.commandId ?? "command-1", candidateId: "candidate-ext-retry", runId: "run-1", attempt: 1, fence: 1, kind: "external_action", toolRevisionId: "mcp-server:server-1", toolInvocationId: "invocation-retry", argumentsDigest: "sha256:d", arguments: { q: "a" } };

		const first = await context.authority.__AdmitCandidate(_identity, candidate);
		const replay = await context.authority.__AdmitCandidate(_identity, candidate);

		expect(attempts).toBe(2);
		expect(first).toEqual({ accepted: false, reason: "external_action_dispatch_retryable", retryable: true, retryAfterMilliseconds: 1_000 });
		expect(replay).toEqual(first);
		expect(context.retries).toEqual([{ runId: "run-1", attempt: 1, candidateId: "candidate-ext-retry", retryCount: 2, retryDeadlineAt: new Date("2026-07-20T00:01:30.000Z") }]);
		expect(logger.error).toHaveBeenCalledWith({ err: error, runId: "run-1", attempt: 1, candidateId: "candidate-ext-retry", toolInvocationId: "invocation-retry", toolRevisionId: "mcp-server:server-1", retryCount: 2, failureKind: "external_action_dispatch_retryable" }, "runtime external action dispatch failed before reservation");
	});

	it("exhausts the durable retry budget instead of returning an unbounded retry response", async function _exhaustsExternalActionRetries()
	{
		const context = _authority({ runState: "Running", externalActionRunner: { async run() { return { outcome: "retryable" as const, error: new Error("compiler unavailable") }; } } });
		const start = await context.authority.__NextCommand(_identity, _open, 0);
		const candidate: RuntimeCandidate = { protocolVersion: AGENT_RUNTIME_PROTOCOL_V1, runtimeInstanceId: "instance-1", commandId: start?.commandId ?? "command-1", candidateId: "candidate-ext-exhausted", runId: "run-1", attempt: 1, fence: 1, kind: "external_action", toolRevisionId: "mcp-server:server-1", toolInvocationId: "invocation-exhausted", argumentsDigest: "sha256:d", arguments: { q: "a" } };

		expect(await context.authority.__AdmitCandidate(_identity, candidate)).toMatchObject({ retryable: true });
		expect(await context.authority.__AdmitCandidate(_identity, candidate)).toMatchObject({ retryable: true });
		expect(await context.authority.__AdmitCandidate(_identity, candidate)).toMatchObject({ retryable: true });
		expect(await context.authority.__AdmitCandidate(_identity, candidate)).toEqual({ accepted: false, reason: "external_action_dispatch_retry_exhausted" });
		expect(context.retries[0]?.retryCount).toBe(3);
	});

	it("exhausts a retry window from server time even when its count remains below the limit", async function _expiresExternalActionRetries()
	{
		let nowEpochMs = Date.parse("2026-07-20T00:01:00.000Z");
		const clock = { nowEpochMs(): number { return nowEpochMs; } };
		const context = _authority({ runState: "Running", clock, externalActionRunner: { async run() { return { outcome: "retryable" as const, error: new Error("compiler unavailable") }; } } });
		const start = await context.authority.__NextCommand(_identity, _open, 0);
		const candidate: RuntimeCandidate = { protocolVersion: AGENT_RUNTIME_PROTOCOL_V1, runtimeInstanceId: "instance-1", commandId: start?.commandId ?? "command-1", candidateId: "candidate-ext-expired", runId: "run-1", attempt: 1, fence: 1, kind: "external_action", toolRevisionId: "mcp-server:server-1", toolInvocationId: "invocation-expired", argumentsDigest: "sha256:d", arguments: { q: "a" } };

		expect(await context.authority.__AdmitCandidate(_identity, candidate)).toMatchObject({ retryable: true });
		nowEpochMs += 30_000;
		expect(await context.authority.__AdmitCandidate(_identity, candidate)).toEqual({ accepted: false, reason: "external_action_dispatch_retry_exhausted" });
	});

	it("returns a terminal denial when the runner has durable evidence the action failed", async function _deniedExternalAction()
	{
		const context = _authority({ runState: "Running", externalActionRunner: { async run() { return { outcome: "denied" as const }; } } });
		const start = await context.authority.__NextCommand(_identity, _open, 0);
		const candidate: RuntimeCandidate = { protocolVersion: AGENT_RUNTIME_PROTOCOL_V1, runtimeInstanceId: "instance-1", commandId: start?.commandId ?? "command-1", candidateId: "candidate-ext-denied", runId: "run-1", attempt: 1, fence: 1, kind: "external_action", toolRevisionId: "mcp-server:server-1", toolInvocationId: "invocation-denied", argumentsDigest: "sha256:d", arguments: { q: "a" } };

		expect(await context.authority.__AdmitCandidate(_identity, candidate)).toEqual({ accepted: false, reason: "external_action_dispatch_denied" });
	});

	it("returns null when no live assignment exists for the reviewed Pod", async function _unknownWorkload()
	{
		const context = _authority({ runState: "Running", podUid: null });

		expect(await context.authority.__NextCommand(_identity, _open, 0)).toBeNull();
	});

	it("admits an event candidate for a dispatched command and deduplicates its id", async function _admitsCandidate()
	{
		const context = _authority({ runState: "Running" });
		const command = await context.authority.__NextCommand(_identity, _open, 0) as RuntimeCommandEnvelope;

		const accepted = await context.authority.__AdmitCandidate(_identity, _candidate(command.commandId));
		const replay = await context.authority.__AdmitCandidate(_identity, _candidate(command.commandId));

		expect(accepted).toEqual({ accepted: true });
		expect(replay).toEqual({ accepted: true });
		expect(context.streams[0]?.acceptedCandidateIds).toEqual(["candidate-1"]);
	});

	it("denies a candidate that references no accepted command", async function _deniesUnknownCommand()
	{
		const context = _authority({ runState: "Running" });
		await context.authority.__NextCommand(_identity, _open, 0);

		const denied = await context.authority.__AdmitCandidate(_identity, _candidate("command-unknown"));

		expect(denied).toEqual({ accepted: false, reason: "command_not_accepted" });
	});

	it("denies a candidate whose fence is stale", async function _deniesStaleFence()
	{
		const context = _authority({ runState: "Running" });
		const command = await context.authority.__NextCommand(_identity, _open, 0) as RuntimeCommandEnvelope;

		const denied = await context.authority.__AdmitCandidate(_identity, { ..._candidate(command.commandId), fence: 99 });

		expect(denied).toEqual({ accepted: false, reason: "fence_mismatch" });
	});

	it("denies candidates for an unknown workload", async function _deniesUnknownWorkload()
	{
		const context = _authority({ runState: "Running", podUid: null });

		expect(await context.authority.__AdmitCandidate(_identity, _candidate("command-1"))).toEqual({ accepted: false, reason: "unknown_workload" });
	});

	it("releases the instance binding on stream loss so a clean reconnect can rebind", async function _releasesStream()
	{
		const context = _authority({ runState: "Running" });
		await context.authority.__NextCommand(_identity, _open, 0);
		expect(context.streams[0]?.runtimeInstanceId).toBe("instance-1");

		await context.authority.__ReleaseStream(_identity, _open);
		expect(context.streams[0]?.runtimeInstanceId).toBeNull();

		const rebound = await context.authority.__NextCommand(_identity, { ..._open, runtimeInstanceId: "instance-2" }, 0);
		expect(rebound?.runtimeInstanceId).toBe("instance-2");
	});

	it("rejects a second concurrent instance while one is still bound", async function _rejectsSecondInstance()
	{
		const context = _authority({ runState: "Running" });
		await context.authority.__NextCommand(_identity, _open, 0);

		const stale = await context.authority.__NextCommand(_identity, { ..._open, runtimeInstanceId: "instance-2" }, 0);

		expect(stale).toBeNull();
	});
});
