import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { AGENT_RUNTIME_PROTOCOL_V1, type RuntimeCandidate, type RuntimeCommandEnvelope } from "@opencrane/contracts";

import { PrismaRuntimeDispatchAuthority } from "../prisma-runtime-dispatch-authority.js";
import type { RuntimeStreamWorkloadIdentity } from "../prisma-runtime-dispatch-authority.types.js";

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
	/** Issuance instant. */
	issuedAt: Date;
	/** Hard expiry. */
	expiresAt: Date;
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
	/** Whether the one-use runtime bootstrap has been consumed by the registered Pod. */
	readonly bootstrapConsumed?: boolean;
	/** Proof-key condition, defaulting to a live key bound to the registered Pod. */
	readonly proofKeyState?: "valid" | "missing" | "revoked" | "wrong_pod";
}

/** Minimal in-memory Prisma double covering only the reads and writes the adapter performs. */
function _fakePrisma(options: FakeOptions): { prisma: PrismaClient; streams: FakeStreamRow[]; commands: FakeCommandRow[]; revokeProofKey: () => void }
{
	const streams: FakeStreamRow[] = [];
	const commands: FakeCommandRow[] = [];
	const assignment = { runId: "run-1", attempt: 1, agentServiceId: "svc-1", agentRevisionId: "rev-1", siloId: "silo-1", subjectId: "user-1", audience: "opencrane-agent-runtime", serviceAccountName: _identity.serviceAccountName, namespace: _identity.namespace, workloadKind: "Job", workloadUid: "wl-1", workloadProfile: "profile", podUid: options.podUid === undefined ? "pod-1" : options.podUid, state: options.assignmentState ?? "Registered", expiresAt: new Date("2026-07-20T00:05:00.000Z"), createdAt: new Date("2026-07-20T00:00:00.000Z") };
	const run = { id: "run-1", attempt: 1, agentServiceId: "svc-1", agentRevisionId: "rev-1", siloId: "silo-1", state: options.runState, inputSnapshotDigest: "sha256:snap" };
	const snapshot = { runId: "run-1", siloId: "silo-1", agentServiceId: "svc-1", agentRevisionId: "rev-1", snapshotVersion: 1, threadId: null, messageIds: [], personaRevisionId: null, preferenceFactIds: [], artifactRevisionIds: [], skillRevisionIds: [], memoryFacts: [], memoryQueryPolicy: {}, toolGrantIds: [], modelRoute: {}, budgetPolicy: {}, identitySnapshot: { executionSubjectId: "user-1", fleetMembershipRevision: 3 }, capabilitySetDigest: "sha256:cap", effectiveContractDigest: "sha256:contract", promptCompilerVersion: "v1", digest: "sha256:snap", compiledAt: new Date("2026-07-20T00:00:00.000Z") };
	const bootstrap = { id: "bootstrap-1", runId: assignment.runId, attempt: assignment.attempt, agentServiceId: assignment.agentServiceId, agentRevisionId: assignment.agentRevisionId, siloId: assignment.siloId, subjectId: assignment.subjectId, audience: assignment.audience, serviceAccountName: assignment.serviceAccountName, namespace: assignment.namespace, workloadKind: assignment.workloadKind, workloadUid: assignment.workloadUid, expiresAt: assignment.expiresAt, consumedAt: options.bootstrapConsumed === false ? null : new Date("2026-07-20T00:00:30.000Z"), consumedByPodUid: options.bootstrapConsumed === false ? null : assignment.podUid, receiptId: options.bootstrapConsumed === false ? null : "receipt-1" };
	const proofKeyState = options.proofKeyState ?? "valid";
	const proofKey = proofKeyState === "missing" ? null : { bootstrapId: bootstrap.id, runId: assignment.runId, attempt: assignment.attempt, workloadKind: assignment.workloadKind, workloadUid: assignment.workloadUid, podUid: proofKeyState === "wrong_pod" ? "pod-other" : assignment.podUid, expiresAt: assignment.expiresAt, revokedAt: proofKeyState === "revoked" ? new Date("2026-07-20T00:00:45.000Z") : null };

	/** Revoke the fake proof key after dispatch to exercise candidate-time authority revalidation. */
	function _revokeProofKey(): void
	{
		if (proofKey !== null) proofKey.revokedAt = new Date("2026-07-20T00:00:45.000Z");
	}

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
		workloadBootstrap: { async findUnique(args: { where: { runId_attempt?: { runId: string; attempt: number } } }) { return args.where.runId_attempt?.runId === bootstrap.runId && args.where.runId_attempt.attempt === bootstrap.attempt ? bootstrap : null; } },
		runProofKey: {
			async findUnique(args: { where: { runId_attempt?: { runId: string; attempt: number } } })
			{
				const key = args.where.runId_attempt;
				return key && proofKey && key.runId === proofKey.runId && key.attempt === proofKey.attempt ? proofKey : null;
			},
		},
		runtimeCommandStream: {
			async findUnique(args: { where: { runId_attempt: { runId: string; attempt: number } } }) { return streams.find(row => row.runId === args.where.runId_attempt.runId && row.attempt === args.where.runId_attempt.attempt) ?? null; },
			async create(args: { data: { runId: string; attempt: number; runtimeInstanceId: string } }) { const row = { runId: args.data.runId, attempt: args.data.attempt, fence: 1, runtimeInstanceId: args.data.runtimeInstanceId, nextCommandSequence: 1, acceptedCandidateIds: [] }; streams.push(row); return row; },
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
	};
	return { prisma: client as unknown as PrismaClient, streams, commands, revokeProofKey: _revokeProofKey };
}

/** Build the adapter under test over a fake with the requested durable state. */
function _authority(options: FakeOptions)
{
	const fake = _fakePrisma(options);
	return { authority: new PrismaRuntimeDispatchAuthority(fake.prisma, { namespace: "runtime-ns", commandTtlMilliseconds: 60_000 }, _clock), ...fake };
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

	it("returns null when no live assignment exists for the reviewed Pod", async function _unknownWorkload()
	{
		const context = _authority({ runState: "Running", podUid: null });

		expect(await context.authority.__NextCommand(_identity, _open, 0)).toBeNull();
	});

	it("mints no command before the registered Pod consumes its one-use bootstrap", async function _requiresConsumedBootstrap()
	{
		const context = _authority({ runState: "Running", bootstrapConsumed: false });

		expect(await context.authority.__NextCommand(_identity, _open, 0)).toBeNull();
		expect(context.streams).toHaveLength(0);
		expect(context.commands).toHaveLength(0);
	});

	it.each(["missing", "revoked", "wrong_pod"] as const)("mints no command for a %s bootstrap proof key", async function _requiresLiveProofKey(proofKeyState)
	{
		const context = _authority({ runState: "Running", proofKeyState });

		expect(await context.authority.__NextCommand(_identity, _open, 0)).toBeNull();
		expect(context.streams).toHaveLength(0);
		expect(context.commands).toHaveLength(0);
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

	it("denies candidate admission when the bootstrap proof is revoked after dispatch", async function _deniesCandidateAfterProofRevocation()
	{
		const context = _authority({ runState: "Running" });
		const command = await context.authority.__NextCommand(_identity, _open, 0) as RuntimeCommandEnvelope;
		context.revokeProofKey();

		const denied = await context.authority.__AdmitCandidate(_identity, _candidate(command.commandId));

		expect(denied).toEqual({ accepted: false, reason: "unknown_workload" });
		expect(context.streams[0]?.acceptedCandidateIds).toEqual([]);
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
