import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { RuntimeElicitationUnitOfWork } from "@opencrane/backend/agents/execution/elicitation";
import { AGENT_RUNTIME_PROTOCOL_V1, ElicitationBodyKinds, ElicitationPurposes, RuntimeCandidateKinds, type CompiledRunInput, type RuntimeCandidate, type RuntimeCommandEnvelope } from "@opencrane/contracts";
import { PERSONAL_MEMORY_RECALL_TOOL_NAME, PERSONAL_MEMORY_RECALL_TOOL_REVISION } from "@opencrane/models/agents";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { PrismaRuntimeDispatchAuthority } from "../prisma-runtime-dispatch-authority";
import type { RunInputCompiler, RuntimeApprovalExpiry, RuntimeElicitationUnitOfWorkFactory, RuntimeEventReporter, RuntimeStreamWorkloadIdentity } from "../prisma-runtime-dispatch-authority.types";
import type { RuntimeProtocolClock } from "../runtime-protocol-authority.types";

/** Workload identity of the registered runtime Pod under test. */
const _identity: RuntimeStreamWorkloadIdentity = { subject: "system:serviceaccount:runtime-ns:agent-runtime-personal", namespace: "runtime-ns", serviceAccountName: "agent-runtime-personal", podUid: "pod-1" };

/** Workload identity of a registered managed-runtime Pod. */
const _managedIdentity: RuntimeStreamWorkloadIdentity = { subject: "system:serviceaccount:managed-runtime-ns:managed-agent-runtime-default", namespace: "managed-runtime-ns", serviceAccountName: "managed-agent-runtime-default", podUid: "pod-1" };

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

/** Invocation row written in the same transaction that accepts an external-action candidate. */
interface FakeToolInvocationRow
{
	id: string; siloId: string; runId: string; attempt: number; agentServiceId: string; agentRevisionId: string; subjectId: string;
	runtimeInstanceId: string; commandId: string; candidateId: string; toolRevisionId: string; toolInvocationId: string;
	arguments: unknown; argumentsDigest: string; requestFingerprint: string; requestIdentity: unknown; approvalRequired: boolean;
	recoveryMode: string; recoveryKey: string | null; state: string; preparationAttempt: number; retryDeadlineAt: Date;
	nextPreparationAttemptAt: Date; claimAttempt: number; claimKind: null; claimFence: number; claimExpiresAt: null;
	result: unknown; failureCode: null; revision: number; recoveryRequiredAt: null; completedAt: null;
}

/** Options for the database state the fake presents to the adapter. */
interface FakeOptions
{
	/** Prisma run-state enum member for the owning run. */
	readonly runState: string;
	/** Registered Pod UID, or null to simulate an unregistered assignment. */
	readonly podUid?: string | null;
	/** Assignment state, defaulting to the registered state. */
	readonly assignmentState?: string;
	/** Optional canonical event persistence bridge supplied by the composition root. */
	readonly eventReporter?: RuntimeEventReporter;
	/** Optional transaction-scoped approval expiry bridge supplied by the composition root. */
	readonly approvalExpiry?: RuntimeApprovalExpiry;
	/** Optional factory for generic elicitation work bound to each fake transaction. */
	readonly elicitationUnitOfWorkFactory?: RuntimeElicitationUnitOfWorkFactory;
	/** Agent-session conversation fixed in the immutable input snapshot. */
	readonly conversationId?: string | null;
	/** Optional trusted clock for retry-window expiry assertions. */
	readonly clock?: RuntimeProtocolClock;
	/** Finished tool results a resume command can carry. */
	readonly savedToolResults?: readonly JsonValue[];
	/** Saved terminal elicitation results available for a resume frame. */
	readonly savedElicitationResults?: readonly { readonly requestId: string; readonly requestKey: string; readonly purpose: string; readonly state: string; readonly payload: JsonValue | null }[];
	/** Owner steering requests waiting for the next fenced resume command. */
	readonly pendingSteeringRequests?: readonly unknown[];
	/** Use a managed-service identity, with its own workload identity, instead of a user one. */
	readonly managed?: boolean;
	/** Optional compiler used to prove exact built-in tool admission policy. */
	readonly compileRunInput?: RunInputCompiler;
}

/** Minimal in-memory Prisma double covering only the reads and writes the adapter performs. */
function _fakePrisma(options: FakeOptions)
{
	const streams: FakeStreamRow[] = [];
	const commands: FakeCommandRow[] = [];
	const toolInvocations: FakeToolInvocationRow[] = [];
	const resultDeliveries = [...(options.savedToolResults ?? [])].map(function _row(result, index)
	{
		const payload = { toolInvocationId: `invocation-${index}`, outcome: "succeeded", result };
		return { id: `delivery-${index}`, toolInvocationId: `row-${index}`, state: "Pending", payload, payloadDigest: ___DigestCanonicalJson(payload), invocation: { toolInvocationId: `invocation-${index}` }, createdAt: new Date(`2026-07-20T00:00:0${index}.000Z`), consumedAt: null as Date | null };
	});
	const elicitationResultDeliveries = [...(options.savedElicitationResults ?? [])].map(function _row(result, index)
	{
		return { id: `elicitation-delivery-${index}`, state: "Pending", payload: result.payload, payloadDigest: result.payload === null ? null : ___DigestCanonicalJson(result.payload), request: { id: result.requestId, requestKey: result.requestKey, purpose: result.purpose, state: result.state }, createdAt: new Date(`2026-07-20T00:00:1${index}.000Z`), consumedAt: null as Date | null };
	});
	for (const [index] of resultDeliveries.entries())
	{
		toolInvocations.push({ id: `row-${index}`, siloId: "silo-1", runId: "run-1", attempt: 1, agentServiceId: "svc-1", agentRevisionId: "rev-1", subjectId: "user-1", runtimeInstanceId: "instance-1", commandId: "command-1", candidateId: `candidate-${index}`, toolRevisionId: "integration:search:query", toolInvocationId: `invocation-${index}`, arguments: {}, argumentsDigest: `sha256:${index}`, requestFingerprint: `sha256:${index}`, requestIdentity: {}, approvalRequired: true, recoveryMode: "Manual", recoveryKey: null, state: "Succeeded", preparationAttempt: 1, retryDeadlineAt: new Date("2026-07-20T00:05:00.000Z"), nextPreparationAttemptAt: new Date("2026-07-20T00:00:00.000Z"), claimAttempt: 1, claimKind: null, claimFence: 1, claimExpiresAt: null, result: resultDeliveries[index]?.payload.result, failureCode: null, revision: 3, recoveryRequiredAt: null, completedAt: null });
	}
	const steeringRequests: { id: string; content: unknown; state: string }[] = [...(options.pendingSteeringRequests ?? [])].map(function _row(content, index) { return { id: `steering-${index}`, content, state: "Pending" }; });
	const workloadIdentity = options.managed ? _managedIdentity : _identity;
	const subjectId = options.managed ? "agent-service:svc-1" : "user-1";
	const audience = options.managed ? "opencrane-managed-agent-runtime" : "opencrane-agent-runtime";
	const assignment = { runId: "run-1", attempt: 1, agentServiceId: "svc-1", agentRevisionId: "rev-1", siloId: "silo-1", subjectId, audience, serviceAccountName: workloadIdentity.serviceAccountName, namespace: workloadIdentity.namespace, workloadKind: "Job", workloadUid: "wl-1", workloadProfile: "profile", podUid: options.podUid === undefined ? "pod-1" : options.podUid, state: options.assignmentState ?? "Registered", expiresAt: new Date("2026-07-20T00:05:00.000Z"), createdAt: new Date("2026-07-20T00:00:00.000Z") };
	const run = { id: "run-1", attempt: 1, agentServiceId: "svc-1", agentRevisionId: "rev-1", siloId: "silo-1", state: options.runState, inputSnapshotDigest: "sha256:snap" };
	const snapshot = { runId: "run-1", siloId: "silo-1", agentServiceId: "svc-1", agentRevisionId: "rev-1", snapshotVersion: 1, conversationId: options.conversationId ?? null, messageIds: [], personaRevisionId: null, preferenceFactIds: [], artifactRevisionIds: [], skillRevisionIds: [], memoryQueryPolicy: {}, integrationAssignments: [], modelRoute: {}, budgetPolicy: {}, identitySnapshot: options.managed ? { kind: "service", executionSubjectId: "agent-service:svc-1", agentServiceId: "svc-1", effectiveScopeAttachmentDigest: `sha256:${"a".repeat(64)}`, organizationId: "org-1", fleetMembershipRevision: 3 } : { kind: "user", executionSubjectId: "user-1", organizationId: "org-1", fleetMembershipRevision: 3 }, capabilitySetDigest: "sha256:cap", effectiveContractDigest: "sha256:contract", promptCompilerVersion: "v1", digest: "sha256:snap", compiledAt: new Date("2026-07-20T00:00:00.000Z") };
	const queryRaw = vi.fn().mockResolvedValue([]);

	/** Return whether a stream row matches the fields given in a where clause. */
	function _streamMatches(row: FakeStreamRow, where: Record<string, unknown>): boolean
	{
		if (row.runId !== where["runId"] || row.attempt !== where["attempt"]) return false;
		if ("nextCommandSequence" in where && row.nextCommandSequence !== where["nextCommandSequence"]) return false;
		if ("runtimeInstanceId" in where && row.runtimeInstanceId !== where["runtimeInstanceId"]) return false;
		return true;
	}

	const client = {
		async $transaction(run_: (tx: unknown) => Promise<unknown>) { return run_(client); },
		$queryRaw: queryRaw,
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
		runtimeSteeringRequest: {
			async findMany() { return steeringRequests.filter(row => row.state === "Pending"); },
			async updateMany(args: { where: { id: { in: string[] }; state: string }; data: { state: string; consumedAt: Date } })
			{
				let count = 0;
				for (const row of steeringRequests.filter(candidate => args.where.id.in.includes(candidate.id) && candidate.state === args.where.state)) { row.state = args.data.state; count += 1; }
				return { count };
			},
		},
		toolInvocation: {
			async count() { return toolInvocations.filter(row => !["Succeeded", "Failed"].includes(row.state)).length; },
			async create(args: { data: Omit<FakeToolInvocationRow, "id" | "state" | "preparationAttempt" | "nextPreparationAttemptAt" | "claimAttempt" | "claimKind" | "claimFence" | "claimExpiresAt" | "result" | "failureCode" | "revision" | "recoveryRequiredAt" | "completedAt"> })
			{
				const row: FakeToolInvocationRow = { ...args.data, id: `row-${toolInvocations.length + 1}`, state: "Preparing", preparationAttempt: 0, nextPreparationAttemptAt: args.data.retryDeadlineAt, claimAttempt: 0, claimKind: null, claimFence: 0, claimExpiresAt: null, result: null, failureCode: null, revision: 0, recoveryRequiredAt: null, completedAt: null };
				toolInvocations.push(row);
				return row;
			},
			async updateMany(args: { where: { runId: string; attempt: number; toolInvocationId: string; state: string }; data: { state: string; result: unknown; completedAt: Date } })
			{
				const row = toolInvocations.find(candidate => candidate.runId === args.where.runId && candidate.attempt === args.where.attempt && candidate.toolInvocationId === args.where.toolInvocationId && candidate.state === args.where.state);
				if (row === undefined) return { count: 0 };
				row.state = args.data.state;
				row.result = args.data.result;
				return { count: 1 };
			},
			async findUnique(args: { where: { runId_attempt_toolInvocationId?: { runId: string; attempt: number; toolInvocationId: string }; runId_attempt_candidateId?: { runId: string; attempt: number; candidateId: string }; requestFingerprint?: string } })
			{
				const toolKey = args.where.runId_attempt_toolInvocationId;
				if (toolKey) return toolInvocations.find(candidate => candidate.runId === toolKey.runId && candidate.attempt === toolKey.attempt && candidate.toolInvocationId === toolKey.toolInvocationId) ?? null;
				const candidateKey = args.where.runId_attempt_candidateId;
				if (candidateKey) return toolInvocations.find(candidate => candidate.runId === candidateKey.runId && candidate.attempt === candidateKey.attempt && candidate.candidateId === candidateKey.candidateId) ?? null;
				return toolInvocations.find(candidate => candidate.requestFingerprint === args.where.requestFingerprint) ?? null;
			},
		},
		toolResultDelivery: {
			async findMany() { return resultDeliveries.filter(row => row.state === "Pending"); },
			async updateMany(args: { where: { id: { in: string[] }; state: string }; data: { state: string; consumedAt: Date } })
			{
				let count = 0;
				for (const row of resultDeliveries.filter(candidate => args.where.id.in.includes(candidate.id) && candidate.state === args.where.state)) { row.state = args.data.state; row.consumedAt = args.data.consumedAt; count += 1; }
				return { count };
			},
		},
		elicitationResultDelivery: {
			async findMany() { return elicitationResultDeliveries.filter(row => row.state === "Pending"); },
			async updateMany(args: { where: { id: { in: string[] }; state: string }; data: { state: string; consumedAt: Date } })
			{
				let count = 0;
				for (const row of elicitationResultDeliveries.filter(candidate => args.where.id.in.includes(candidate.id) && candidate.state === args.where.state)) { row.state = args.data.state; row.consumedAt = args.data.consumedAt; count += 1; }
				return { count };
			},
		},
	};
	return { prisma: client as unknown as PrismaClient, queryRaw, run, streams, commands, resultDeliveries, elicitationResultDeliveries, steeringRequests, toolInvocations };
}

/** Deterministic fake compiler: the same snapshot and live attempt yield byte-identical input. */
const _compileRunInput: RunInputCompiler = async function _compile(snapshot, attempt): Promise<CompiledRunInput>
{
	const parametersSchema = { type: "object", properties: { q: { type: "string" } }, required: ["q"], additionalProperties: false } as const;
	return { promptCompilerVersion: "v1", runId: snapshot.runId, attempt, instructions: "compiled", messages: [], tools: [{ name: "integration:search:query", toolRevisionId: "integration:search:query", description: "search", requiresApproval: true, parametersSchema, parametersSchemaDigest: ___DigestCanonicalJson(parametersSchema) }], model: { modelAlias: "silo-default", maxOutputTokens: null, generatedOutputCapabilities: [] }, budget: { maxTotalTokens: null, maxCostUsdMicros: null, maxToolInvocations: null, wallClockDeadlineEpochMs: null }, digest: `sha256:${snapshot.digest}` };
};

/** Build the adapter under test over a fake with the requested durable state. */
function _authority(options: FakeOptions)
{
	const fake = _fakePrisma(options);
	const eventReporter = options.eventReporter ?? { reportInTransaction: vi.fn().mockResolvedValue({ outcome: "reported" as const }) };
	const elicitationUnitOfWork: RuntimeElicitationUnitOfWork = { open: vi.fn().mockResolvedValue(null), expireDue: vi.fn().mockResolvedValue({ expiredCount: 0, resumed: false }) };
	const elicitationUnitOfWorkFactory = options.elicitationUnitOfWorkFactory ?? { bind: vi.fn().mockReturnValue(elicitationUnitOfWork) };
	return { authority: new PrismaRuntimeDispatchAuthority(fake.prisma, { personalRuntimeNamespace: "runtime-ns", managedRuntimeNamespace: "managed-runtime-ns", commandTtlMilliseconds: 60_000 }, options.compileRunInput ?? _compileRunInput, eventReporter, options.clock ?? _clock, options.approvalExpiry, elicitationUnitOfWorkFactory), elicitationUnitOfWork, elicitationUnitOfWorkFactory, ...fake };
}

/** Build a runtime event candidate bound to a dispatched command. */
function _candidate(commandId: string): RuntimeCandidate
{
	return { protocolVersion: AGENT_RUNTIME_PROTOCOL_V1, runtimeInstanceId: "instance-1", commandId, candidateId: "candidate-1", runId: "run-1", attempt: 1, fence: 1, kind: RuntimeCandidateKinds.Event, eventType: "run.attempt_acknowledged", payload: {} };
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

	it("rejects a compiled input that disagrees with the live dispatch attempt", async function _RejectsCompiledAttemptDrift()
	{
		const driftingCompiler: RunInputCompiler = async function _Compile(snapshot, attempt, transaction): Promise<CompiledRunInput>
		{
			const compiled = await _compileRunInput(snapshot, attempt, transaction);
			return { ...compiled, attempt: attempt + 1 };
		};
		const context = _authority({ runState: "Running", compileRunInput: driftingCompiler });

		await expect(context.authority.__NextCommand(_identity, _open, 0)).rejects.toThrow(/does not match its live dispatch context/);
		expect(context.commands).toHaveLength(0);
	});

	it("mints a managed-runtime frame only from tagged service identity evidence", async function _mintsManagedStart()
	{
		const context = _authority({ runState: "Running", managed: true });

		const command = await context.authority.__NextCommand(_managedIdentity, _open, 0);

		expect(command?.assignment.identity).toEqual({ kind: "service", executionSubjectId: "agent-service:svc-1", agentServiceId: "svc-1", fleetMembershipRevision: 3, effectiveScopeAttachmentDigest: `sha256:${"a".repeat(64)}` });
	});

	it("takes the per-run advisory lock before its row lock, matching cancellation", async function _ordersRunLocks()
	{
		const context = _authority({ runState: "Running" });

		await context.authority.__NextCommand(_identity, _open, 0);
		const queries = context.queryRaw.mock.calls.map(function _sql(call) { return ((call[0] as { strings?: readonly string[] }).strings ?? []).join(" "); });
		expect(queries[0]).toContain("pg_advisory_xact_lock");
		expect(queries[1]).toContain('FROM "agent_runs"');
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

	it("supersedes stale start delivery with one monotonic cancel on reconnect", async function _SupersedesStaleStart()
	{
		const context = _authority({ runState: "Running" });
		await context.authority.__NextCommand(_identity, _open, 0);
		context.run.state = "Cancelling";

		const cancel = await context.authority.__NextCommand(_identity, _open, 0);
		const redelivered = await context.authority.__NextCommand(_identity, _open, 0);

		expect(cancel?.kind).toBe("cancel_attempt");
		expect(cancel?.sequence).toBe(2);
		expect(redelivered).toEqual(cancel);
		expect(context.commands.map(function _Sequence(row) { return row.sequence; })).toEqual([1, 2]);
		expect(await context.authority.__NextCommand(_identity, _open, 2)).toBeNull();
	});

	it("skips stored start and resume frames when cancellation wins", async function _SupersedesStaleResume()
	{
		const context = _authority({ runState: "Running", savedToolResults: [{ ok: true }] });
		await context.authority.__NextCommand(_identity, _open, 0);
		await context.authority.__NextCommand(_identity, _open, 1);
		context.run.state = "Cancelling";

		const cancel = await context.authority.__NextCommand(_identity, _open, 0);

		expect(cancel?.kind).toBe("cancel_attempt");
		expect(cancel?.sequence).toBe(3);
		expect(context.commands.map(function _Kind(row) { return row.kind; })).toEqual(["StartAttempt", "ResumeAttempt", "CancelAttempt"]);
	});

	it("mints a resume_attempt carrying the saved terminal tool results after start", async function _mintsResume()
	{
		const context = _authority({ runState: "Running", savedToolResults: [{ ok: true }] });

		const start = await context.authority.__NextCommand(_identity, _open, 0);
		const resume = await context.authority.__NextCommand(_identity, _open, 1);

		expect(start?.kind).toBe("start_attempt");
		expect(resume?.kind).toBe("resume_attempt");
		expect(resume?.kind === "resume_attempt" ? resume.payload.toolResults : null).toEqual([{ toolInvocationId: "invocation-0", outcome: "succeeded", result: { ok: true } }]);
	});

	it("delivers ordinary elicitation input once and consumes its exact marker", async function _MintsElicitationResume()
	{
		const response = { kind: "free_text", text: "Use option B" };
		const context = _authority({ runState: "Running", savedElicitationResults: [{ requestId: "request-1", requestKey: "question-1", purpose: "RuntimeInput", state: "Answered", payload: response }] });
		await context.authority.__NextCommand(_identity, _open, 0);
		const resume = await context.authority.__NextCommand(_identity, _open, 1);

		expect(resume?.kind === "resume_attempt" ? resume.payload.elicitationResults : null).toEqual([{ requestId: "request-1", requestKey: "question-1", outcome: "answered", response }]);
		expect(context.elicitationResultDeliveries[0]?.state).toBe("Consumed");
		expect(await context.authority.__NextCommand(_identity, _open, 2)).toBeNull();
	});

	it("redelivers a protected A2UI result without exposing its response", async function _ProtectsA2uiResult()
	{
		const context = _authority({ runState: "Running", savedElicitationResults: [{ requestId: "request-1", requestKey: "action-1", purpose: "A2uiAction", state: "Answered", payload: { actionDigest: "sha256:protected", response: { kind: "approval", approved: true } } }] });
		await context.authority.__NextCommand(_identity, _open, 0);
		const resume = await context.authority.__NextCommand(_identity, _open, 1);
		const redelivered = await context.authority.__NextCommand(_identity, _open, 1);

		expect(resume?.kind === "resume_attempt" ? resume.payload.elicitationResults : null).toEqual([{ requestId: "request-1", requestKey: "action-1", outcome: "answered" }]);
		expect(redelivered).toEqual(resume);
	});

	it("mints one fenced resume carrying pending steering and consumes it only after persistence", async function _mintsSteeringResume()
	{
		const context = _authority({ runState: "Running", pendingSteeringRequests: [{ text: "Focus on risks." }] });
		const authority = context.authority;
		await authority.__NextCommand(_identity, _open, 0);
		const resume = await authority.__NextCommand(_identity, _open, 1);
		expect(resume?.kind).toBe("resume_attempt");
		if (resume?.kind !== "resume_attempt") throw new Error("expected resume command");
		expect(resume.payload.steeringRequests).toEqual([{ text: "Focus on risks." }]);
		expect(context.steeringRequests[0]?.state).toBe("Consumed");
		expect(await authority.__NextCommand(_identity, _open, 2)).toBeNull();
	});

	it("consumes each saved-result marker so no duplicate resume is minted", async function _singleUseResume()
	{
		const context = _authority({ runState: "Running", savedToolResults: [{ ok: true }] });

		await context.authority.__NextCommand(_identity, _open, 0);
		await context.authority.__NextCommand(_identity, _open, 1);
		// The saved-result delivery is now consumed; a further poll past the resume frame mints nothing.
		const afterResume = await context.authority.__NextCommand(_identity, _open, 2);

		expect(afterResume).toBeNull();
		expect(context.resultDeliveries.every(row => row.state === "Consumed")).toBe(true);
		expect(context.commands.filter(row => row.kind === "ResumeAttempt")).toHaveLength(1);
	});

	it("redelivers a resume frame byte-identically after its token was consumed", async function _resumeRedeliver()
	{
		const context = _authority({ runState: "Running", savedToolResults: [{ ok: true }] });

		await context.authority.__NextCommand(_identity, _open, 0);
		const resume = await context.authority.__NextCommand(_identity, _open, 1);
		const redelivered = await context.authority.__NextCommand(_identity, _open, 1);

		expect(redelivered).toEqual(resume);
	});

	it("mints a later resume only when a new approval batch produces a fresh marker", async function _resumesLaterApprovalBatch()
	{
		const context = _authority({ runState: "Running", savedToolResults: [{ batch: 1 }] });
		await context.authority.__NextCommand(_identity, _open, 0);
		await context.authority.__NextCommand(_identity, _open, 1);
		context.toolInvocations.push({ ...context.toolInvocations[0]!, id: "row-later", toolInvocationId: "invocation-later", requestFingerprint: "sha256:later", state: "Succeeded", result: { batch: 2 } });
		const laterPayload = { toolInvocationId: "invocation-later", outcome: "succeeded", result: { batch: 2 } };
		context.resultDeliveries.push({ id: "delivery-later", toolInvocationId: "row-later", state: "Pending", payload: laterPayload, payloadDigest: ___DigestCanonicalJson(laterPayload), invocation: { toolInvocationId: "invocation-later" }, createdAt: new Date("2026-07-20T00:00:09.000Z"), consumedAt: null });

		const later = await context.authority.__NextCommand(_identity, _open, 2);

		expect(later?.kind).toBe("resume_attempt");
		expect(later?.kind === "resume_attempt" ? later.payload.toolResults : null).toEqual([{ toolInvocationId: "invocation-later", outcome: "succeeded", result: { batch: 2 } }]);
		expect(context.commands.filter(row => row.kind === "ResumeAttempt")).toHaveLength(2);
	});

	it("does not mint a second resume for steering without a new approval pause", async function _rejectsConcurrentSteeringResume()
	{
		const context = _authority({ runState: "Running", pendingSteeringRequests: [{ text: "First." }] });
		await context.authority.__NextCommand(_identity, _open, 0);
		await context.authority.__NextCommand(_identity, _open, 1);
		context.steeringRequests.push({ id: "steering-later", content: { text: "Do not interrupt the active loop." }, state: "Pending" });

		expect(await context.authority.__NextCommand(_identity, _open, 2)).toBeNull();
		expect(context.steeringRequests[1]?.state).toBe("Pending");
	});

	it("refuses a saved result whose payload digest no longer matches", async function _rejectsChangedResultPayload()
	{
		const context = _authority({ runState: "Running", savedToolResults: [{ ok: true }] });
		context.resultDeliveries[0]!.payloadDigest = "sha256:changed";
		await context.authority.__NextCommand(_identity, _open, 0);

		await expect(context.authority.__NextCommand(_identity, _open, 1)).resolves.toBeNull();
		expect(context.resultDeliveries[0]?.state).toBe("Pending");
	});

	it("refuses a saved result that names a different public invocation id", async function _rejectsChangedInvocationId()
	{
		const context = _authority({ runState: "Running", savedToolResults: [{ ok: true }] });
		context.resultDeliveries[0]!.payload.toolInvocationId = "attacker-invocation";
		context.resultDeliveries[0]!.payloadDigest = ___DigestCanonicalJson(context.resultDeliveries[0]!.payload);
		await context.authority.__NextCommand(_identity, _open, 0);

		await expect(context.authority.__NextCommand(_identity, _open, 1)).resolves.toBeNull();
		expect(context.resultDeliveries[0]?.state).toBe("Pending");
	});

	it("expires a waiting batch inside command polling before minting its resume", async function _expiresWaitingBatch()
	{
		let resumeRun = function _noop(): void {};
		const expiry = { expireInTransaction: vi.fn(async function _expire() { resumeRun(); return { expiredCount: 1, resumed: true }; }) };
		const context = _authority({ runState: "WaitingForInput", savedToolResults: [{ expired: true }], approvalExpiry: expiry });
		resumeRun = function _resume(): void { context.run.state = "Running"; };
		context.streams.push({ runId: "run-1", attempt: 1, fence: 1, inputGeneration: 0, runtimeInstanceId: "instance-1", nextCommandSequence: 2, acceptedCandidateIds: [] });
		context.commands.push({ runId: "run-1", attempt: 1, sequence: 1, commandId: "command-start", kind: "StartAttempt", fence: 1, issuedAt: new Date("2026-07-20T00:00:30.000Z"), expiresAt: new Date("2026-07-20T00:01:30.000Z") });

		const resume = await context.authority.__NextCommand(_identity, _open, 1);

		expect(expiry.expireInTransaction).toHaveBeenCalledWith(expect.anything(), { runId: "run-1", attempt: 1, now: new Date("2026-07-20T00:01:00.000Z") });
		expect(context.elicitationUnitOfWork.expireDue).toHaveBeenCalledWith({ runId: "run-1", attempt: 1, now: new Date("2026-07-20T00:01:00.000Z") });
		expect(context.elicitationUnitOfWorkFactory.bind).toHaveBeenCalledTimes(1);
		expect(resume?.kind).toBe("resume_attempt");
	});

	it("composes approval and generic expiry on the locked command transaction", async function _ComposesExpiryAuthorities()
	{
		const transactions: unknown[] = [];
		let resumeRun = function _Noop(): void {};
		const approvalExpiry: RuntimeApprovalExpiry = { async expireInTransaction(transaction) { transactions.push(transaction); return { expiredCount: 0, resumed: false }; } };
		const elicitationUnitOfWork: RuntimeElicitationUnitOfWork = { async open() { return null; }, async expireDue() { resumeRun(); return { expiredCount: 1, resumed: true }; } };
		const elicitationUnitOfWorkFactory: RuntimeElicitationUnitOfWorkFactory = { bind(transaction) { transactions.push(transaction); return elicitationUnitOfWork; } };
		const context = _authority({ runState: "WaitingForInput", savedElicitationResults: [{ requestId: "request-1", requestKey: "question-1", purpose: "RuntimeInput", state: "Expired", payload: null }], approvalExpiry, elicitationUnitOfWorkFactory });
		resumeRun = function _Resume(): void { context.run.state = "Running"; };
		context.streams.push({ runId: "run-1", attempt: 1, fence: 1, inputGeneration: 0, runtimeInstanceId: "instance-1", nextCommandSequence: 2, acceptedCandidateIds: [] });
		context.commands.push({ runId: "run-1", attempt: 1, sequence: 1, commandId: "command-start", kind: "StartAttempt", fence: 1, issuedAt: new Date("2026-07-20T00:00:30.000Z"), expiresAt: new Date("2026-07-20T00:01:30.000Z") });

		const resume = await context.authority.__NextCommand(_identity, _open, 1);

		expect(transactions).toHaveLength(2);
		expect(transactions[0]).toBe(transactions[1]);
		expect(resume?.kind).toBe("resume_attempt");
	});

	it("keeps a partially expired approval batch waiting and mints no command", async function _keepsWaitingAfterPartialExpiry()
	{
		const expiry = { expireInTransaction: vi.fn().mockResolvedValue({ expiredCount: 1, resumed: false }) };
		const context = _authority({ runState: "WaitingForInput", approvalExpiry: expiry });

		expect(await context.authority.__NextCommand(_identity, _open, 0)).toBeNull();
		expect(context.commands).toHaveLength(0);
	});

	it("rejects redelivery when a persisted resume payload is not an exact result array", async function _rejectsMalformedResumeRedelivery()
	{
		const context = _authority({ runState: "Running" });
		await context.authority.__NextCommand(_identity, _open, 0);
		context.commands.push({ runId: "run-1", attempt: 1, sequence: 2, commandId: "malformed-resume", kind: "ResumeAttempt", fence: 1, payload: { inputGeneration: 0, toolResults: { toolInvocationId: "invocation-1" }, steeringRequests: [] }, issuedAt: new Date("2026-07-20T00:01:00.000Z"), expiresAt: new Date("2026-07-20T00:02:00.000Z") });

		await expect(context.authority.__NextCommand(_identity, _open, 1)).resolves.toBeNull();
	});

	it("atomically saves Preparing work before accepting an external-action candidate", async function _persistsActionAuthority()
	{
		const context = _authority({ runState: "Running" });
		const start = await context.authority.__NextCommand(_identity, _open, 0);
		const argumentsValue = { q: "a" };
		const candidate: RuntimeCandidate = { protocolVersion: AGENT_RUNTIME_PROTOCOL_V1, runtimeInstanceId: "instance-1", commandId: start?.commandId ?? "command-1", candidateId: "candidate-ext", runId: "run-1", attempt: 1, fence: 1, kind: RuntimeCandidateKinds.ExternalAction, toolRevisionId: "integration:search:query", toolInvocationId: "invocation-1", argumentsDigest: ___DigestCanonicalJson(argumentsValue), arguments: argumentsValue };

		await expect(context.authority.__AdmitCandidate(_identity, candidate)).resolves.toEqual({ accepted: true });
		await expect(context.authority.__AdmitCandidate(_identity, candidate)).resolves.toEqual({ accepted: true });
		expect(context.toolInvocations).toHaveLength(1);
		expect(context.toolInvocations[0]).toMatchObject({ state: "Preparing", candidateId: "candidate-ext", toolInvocationId: "invocation-1", approvalRequired: true, recoveryMode: "Manual" });
		expect(context.streams[0]?.acceptedCandidateIds).toEqual(["candidate-ext"]);
	});

	it("opens a runtime request before accepting its candidate id and exactly replays it", async function _OpensRuntimeElicitation()
	{
		let context: ReturnType<typeof _authority>;
		const opened = vi.fn<RuntimeElicitationUnitOfWork["open"]>(async function _Open(command)
		{
			if (opened.mock.calls.length === 1) expect(context.streams[0]?.acceptedCandidateIds).toEqual([]);
			return { version: "opencrane.elicitation.v1", requestId: command.requestId, conversationId: command.conversationId, runId: command.runId, attempt: command.attempt, assignedParticipantId: command.assignedParticipantId, purpose: command.purpose, state: "requested", body: command.body, requiresStepUp: false, requestedAt: command.now.toISOString(), expiresAt: command.expiresAt.toISOString() } as never;
		});
		const elicitationUnitOfWork: RuntimeElicitationUnitOfWork = { open: opened, expireDue: vi.fn().mockResolvedValue({ expiredCount: 0, resumed: false }) };
		const elicitationUnitOfWorkFactory: RuntimeElicitationUnitOfWorkFactory = { bind: vi.fn().mockReturnValue(elicitationUnitOfWork) };
		context = _authority({ runState: "Running", conversationId: "conversation-1", elicitationUnitOfWorkFactory });
		const start = await context.authority.__NextCommand(_identity, _open, 0);
		const candidate: RuntimeCandidate = { protocolVersion: AGENT_RUNTIME_PROTOCOL_V1, runtimeInstanceId: "instance-1", commandId: start?.commandId ?? "command-1", candidateId: "candidate-input", runId: "run-1", attempt: 1, fence: 1, kind: RuntimeCandidateKinds.Elicitation, proposal: { requestKey: "question-1", purpose: ElicitationPurposes.RuntimeInput, body: { kind: ElicitationBodyKinds.FreeText, prompt: "What should I do next?", maximumLength: 500, allowEmpty: false }, purposePayloadDigest: ___DigestCanonicalJson(null), expiresInSeconds: 300 } };

		await expect(context.authority.__AdmitCandidate(_identity, candidate)).resolves.toEqual({ accepted: true });
		await expect(context.authority.__AdmitCandidate(_identity, candidate)).resolves.toEqual({ accepted: true });
		expect(opened).toHaveBeenCalledTimes(2);
		expect(opened.mock.calls[0]?.[0]).toMatchObject({ siloId: "silo-1", conversationId: "conversation-1", runId: "run-1", attempt: 1, assignedParticipantId: "user-1", requestKey: "question-1", purpose: ElicitationPurposes.RuntimeInput, expiresAt: new Date("2026-07-20T00:05:00.000Z") });
		expect(elicitationUnitOfWorkFactory.bind).toHaveBeenCalledTimes(3);
		expect(context.streams[0]?.acceptedCandidateIds).toEqual(["candidate-input"]);
	});

	it("refuses an elicitation replay when the durable request no longer matches", async function _RefusesElicitationReplayConflict()
	{
		const open = vi.fn<RuntimeElicitationUnitOfWork["open"]>().mockResolvedValueOnce({} as never).mockResolvedValueOnce(null);
		const elicitationUnitOfWork: RuntimeElicitationUnitOfWork = { open, expireDue: vi.fn().mockResolvedValue({ expiredCount: 0, resumed: false }) };
		const context = _authority({ runState: "Running", conversationId: "conversation-1", elicitationUnitOfWorkFactory: { bind: vi.fn().mockReturnValue(elicitationUnitOfWork) } });
		const start = await context.authority.__NextCommand(_identity, _open, 0);
		const candidate: RuntimeCandidate = { protocolVersion: AGENT_RUNTIME_PROTOCOL_V1, runtimeInstanceId: "instance-1", commandId: start?.commandId ?? "command-1", candidateId: "candidate-input", runId: "run-1", attempt: 1, fence: 1, kind: RuntimeCandidateKinds.Elicitation, proposal: { requestKey: "question-1", purpose: ElicitationPurposes.RuntimeInput, body: { kind: ElicitationBodyKinds.FreeText, prompt: "Original?", maximumLength: 500, allowEmpty: false }, purposePayloadDigest: ___DigestCanonicalJson(null), expiresInSeconds: 300 } };

		await expect(context.authority.__AdmitCandidate(_identity, candidate)).resolves.toEqual({ accepted: true });
		await expect(context.authority.__AdmitCandidate(_identity, { ...candidate, proposal: { ...candidate.proposal, body: { ...candidate.proposal.body, prompt: "Changed?" } } })).resolves.toEqual({ accepted: false, reason: "elicitation_replay_conflict" });
		expect(context.streams[0]?.acceptedCandidateIds).toEqual(["candidate-input"]);
	});

	it("forces personal-memory recall through approval even when its descriptor says otherwise", async function _forcesMemoryApproval()
	{
		const compileRunInput: RunInputCompiler = async function _compile(snapshot, attempt): Promise<CompiledRunInput>
		{
			const parametersSchema = { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false } as const;
			return { promptCompilerVersion: "v1", runId: snapshot.runId, attempt, instructions: "compiled", messages: [], tools: [{ name: PERSONAL_MEMORY_RECALL_TOOL_NAME, toolRevisionId: PERSONAL_MEMORY_RECALL_TOOL_REVISION, description: "recall", requiresApproval: false, parametersSchema, parametersSchemaDigest: ___DigestCanonicalJson(parametersSchema) }], model: { modelAlias: "silo-default", maxOutputTokens: null, generatedOutputCapabilities: [] }, budget: { maxTotalTokens: null, maxCostUsdMicros: null, maxToolInvocations: null, wallClockDeadlineEpochMs: null }, digest: `sha256:${snapshot.digest}` };
		};
		const context = _authority({ runState: "Running", compileRunInput });
		const start = await context.authority.__NextCommand(_identity, _open, 0);
		const argumentsValue = { query: "remember this" };
		const candidate: RuntimeCandidate = { protocolVersion: AGENT_RUNTIME_PROTOCOL_V1, runtimeInstanceId: "instance-1", commandId: start?.commandId ?? "command-1", candidateId: "candidate-memory", runId: "run-1", attempt: 1, fence: 1, kind: RuntimeCandidateKinds.ExternalAction, toolRevisionId: PERSONAL_MEMORY_RECALL_TOOL_REVISION, toolInvocationId: "memory-1", argumentsDigest: ___DigestCanonicalJson(argumentsValue), arguments: argumentsValue };

		await expect(context.authority.__AdmitCandidate(_identity, candidate)).resolves.toEqual({ accepted: true });
		expect(context.toolInvocations[0]).toMatchObject({ approvalRequired: true, toolRevisionId: PERSONAL_MEMORY_RECALL_TOOL_REVISION });
	});

	it("rejects an external-action replay whose arguments changed behind the accepted digest", async function _rejectsMutatedActionReplay()
	{
		const context = _authority({ runState: "Running" });
		const start = await context.authority.__NextCommand(_identity, _open, 0);
		const argumentsValue = { q: "accepted" };
		const candidate: RuntimeCandidate = { protocolVersion: AGENT_RUNTIME_PROTOCOL_V1, runtimeInstanceId: "instance-1", commandId: start?.commandId ?? "command-1", candidateId: "candidate-ext", runId: "run-1", attempt: 1, fence: 1, kind: RuntimeCandidateKinds.ExternalAction, toolRevisionId: "integration:search:query", toolInvocationId: "invocation-1", argumentsDigest: ___DigestCanonicalJson(argumentsValue), arguments: argumentsValue };

		await expect(context.authority.__AdmitCandidate(_identity, candidate)).resolves.toEqual({ accepted: true });
		await expect(context.authority.__AdmitCandidate(_identity, { ...candidate, arguments: { q: "changed" } })).resolves.toEqual({ accepted: false, reason: "external_action_replay_conflict" });
		expect(context.toolInvocations).toHaveLength(1);
	});

	it("persists only a fenced runtime completion through the injected run authority", async function _reportsTerminalCompletion()
	{
		const reporter = { reportInTransaction: vi.fn().mockResolvedValue({ outcome: "reported" }) };
		const context = _authority({ runState: "Running", eventReporter: reporter });
		const start = await context.authority.__NextCommand(_identity, _open, 0);
		const candidate: RuntimeCandidate = { protocolVersion: AGENT_RUNTIME_PROTOCOL_V1, runtimeInstanceId: "instance-1", commandId: start?.commandId ?? "command-1", candidateId: "candidate-complete", runId: "run-1", attempt: 1, fence: 1, kind: RuntimeCandidateKinds.Event, eventType: "run.completed", payload: { ignored: "runtime payload never becomes durable terminal evidence" } };

		await expect(context.authority.__AdmitCandidate(_identity, candidate)).resolves.toEqual({ accepted: true });
		expect(reporter.reportInTransaction).toHaveBeenCalledWith(expect.anything(), { runId: "run-1", attempt: 1, sourceIsStartAttempt: true, eventType: "run.completed", payload: { ignored: "runtime payload never becomes durable terminal evidence" } });
	});

	it("binds a pre-start coordinate failure to the exact accepted start command", async function _BindsStartMismatchFailure()
	{
		const reporter = { reportInTransaction: vi.fn().mockResolvedValue({ outcome: "reported" }) };
		const context = _authority({ runState: "Assigned", eventReporter: reporter });
		const start = await context.authority.__NextCommand(_identity, _open, 0);
		const candidate: RuntimeCandidate = { protocolVersion: AGENT_RUNTIME_PROTOCOL_V1, runtimeInstanceId: "instance-1", commandId: start?.commandId ?? "command-1", candidateId: "candidate-start-mismatch", runId: "run-1", attempt: 1, fence: 1, kind: RuntimeCandidateKinds.Event, eventType: "run.failed", payload: { reason: "compiled_input_coordinate_mismatch" } };

		await expect(context.authority.__AdmitCandidate(_identity, candidate)).resolves.toEqual({ accepted: true });
		expect(reporter.reportInTransaction).toHaveBeenCalledWith(expect.anything(), { runId: "run-1", attempt: 1, sourceIsStartAttempt: true, eventType: "run.failed", payload: { reason: "compiled_input_coordinate_mismatch" } });
	});

	it("binds a running coordinate failure to the exact accepted resume command", async function _BindsResumeMismatchFailure()
	{
		const reporter = { reportInTransaction: vi.fn().mockResolvedValue({ outcome: "reported" }) };
		const context = _authority({ runState: "Running", savedToolResults: [{ ok: true }], eventReporter: reporter });
		await context.authority.__NextCommand(_identity, _open, 0);
		const resume = await context.authority.__NextCommand(_identity, _open, 1);
		const candidate: RuntimeCandidate = { protocolVersion: AGENT_RUNTIME_PROTOCOL_V1, runtimeInstanceId: "instance-1", commandId: resume?.commandId ?? "command-2", candidateId: "candidate-resume-mismatch", runId: "run-1", attempt: 1, fence: 1, kind: RuntimeCandidateKinds.Event, eventType: "run.failed", payload: { reason: "compiled_input_coordinate_mismatch" } };

		await expect(context.authority.__AdmitCandidate(_identity, candidate)).resolves.toEqual({ accepted: true });
		expect(reporter.reportInTransaction).toHaveBeenCalledWith(expect.anything(), { runId: "run-1", attempt: 1, sourceIsStartAttempt: false, eventType: "run.failed", payload: { reason: "compiled_input_coordinate_mismatch" } });
	});

	it("persists each canonical event before accepting its candidate id", async function _persistsBeforeCandidateAcceptance()
	{
		let context: ReturnType<typeof _authority>;
		const reporter: RuntimeEventReporter = { async reportInTransaction()
		{
			expect(context.streams[0]?.acceptedCandidateIds).toEqual([]);
			return { outcome: "reported" };
		} };
		context = _authority({ runState: "Running", eventReporter: reporter });
		const start = await context.authority.__NextCommand(_identity, _open, 0);
		const candidate: RuntimeCandidate = { protocolVersion: AGENT_RUNTIME_PROTOCOL_V1, runtimeInstanceId: "instance-1", commandId: start?.commandId ?? "command-1", candidateId: "candidate-delta", runId: "run-1", attempt: 1, fence: 1, kind: RuntimeCandidateKinds.Event, eventType: "message.delta", payload: { messageId: "message-1", delta: "Hello" } };

		await expect(context.authority.__AdmitCandidate(_identity, candidate)).resolves.toEqual({ accepted: true });
		expect(context.streams[0]?.acceptedCandidateIds).toEqual(["candidate-delta"]);
	});

	it("does not accept a candidate id when canonical event persistence denies it", async function _deniesUnpersistedEvent()
	{
		const reporter: RuntimeEventReporter = { reportInTransaction: vi.fn().mockResolvedValue({ outcome: "denied", reason: "invalid_event_type" }) };
		const context = _authority({ runState: "Running", eventReporter: reporter });
		const start = await context.authority.__NextCommand(_identity, _open, 0);
		const candidate: RuntimeCandidate = { protocolVersion: AGENT_RUNTIME_PROTOCOL_V1, runtimeInstanceId: "instance-1", commandId: start?.commandId ?? "command-1", candidateId: "candidate-unknown", runId: "run-1", attempt: 1, fence: 1, kind: RuntimeCandidateKinds.Event, eventType: "framework.internal", payload: {} };

		await expect(context.authority.__AdmitCandidate(_identity, candidate)).resolves.toEqual({ accepted: false, reason: "invalid_event_type" });
		expect(context.streams[0]?.acceptedCandidateIds).toEqual([]);
	});

	it("keeps cancellation server-owned even for an authenticated runtime", async function _deniesRuntimeCancellation()
	{
		const context = _authority({ runState: "Running", eventReporter: { reportInTransaction: vi.fn() } });
		const start = await context.authority.__NextCommand(_identity, _open, 0);
		const candidate: RuntimeCandidate = { protocolVersion: AGENT_RUNTIME_PROTOCOL_V1, runtimeInstanceId: "instance-1", commandId: start?.commandId ?? "command-1", candidateId: "candidate-cancel", runId: "run-1", attempt: 1, fence: 1, kind: RuntimeCandidateKinds.Event, eventType: "run.cancelled", payload: {} };

		await expect(context.authority.__AdmitCandidate(_identity, candidate)).resolves.toEqual({ accepted: false, reason: "runtime_cancellation_not_authoritative" });
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
