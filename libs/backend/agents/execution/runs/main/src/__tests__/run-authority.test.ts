import type { AgentRevisionId, AgentRun, AgentRunId, AgentServiceState, SiloId } from "@opencrane/models/agents";
import { describe, expect, it } from "vitest";

import type { RunInputSnapshot } from "@opencrane/contracts";
import { __StartNextRunAttempt } from "../run-authority";
import { RetryRunInputCompileOutcomes, type RetryRunInputCompiler } from "../retry-run-input.types";
import type { RunAdmissionTransaction } from "../run-admission.types";
import { RetryReplayCheckStatuses, type AgentRunAuthoritySnapshot, type AgentRunRetryTransactionRepository, type AtomicRunAttemptResult, type AtomicStartNextRunAttemptCommand, type RetryReplayCheck, type StartNextRunAttemptCommand } from "../run-authority.types";

/** Creates one participant-authorized retry command. */
function _command(): StartNextRunAttemptCommand
{
	return { runId: "run-1", expectedAttempt: 1, siloId: "silo-1", conversationId: "conversation-1", requestedBy: "user-1", requestedByPrincipalId: "principal-1", acceptedAt: "2026-07-18T01:00:00.000Z" };
}

/** Creates a failed first attempt for one logical run. */
function _run(): AgentRun
{
	return {
		id: "run-1",
		siloId: "silo-1",
		agentServiceId: "service-1",
		agentRevisionId: "revision-1",
		conversationId: "conversation-1",
		trigger: "interactive",
		executionSubject: { schemaVersion: 1, siloId: "silo-1", agentIdentityId: "identity-1", principalId: "principal-1", identity: { agentIdentityId: "identity-1", principalId: "principal-1", siloId: "silo-1", headRevision: "1", headDigest: `sha256:${"a".repeat(64)}`, decisionEvidenceId: "identity-decision", verifiedAt: "2026-07-18T00:00:00.000Z" }, membership: { principalId: "principal-1", siloId: "silo-1", revision: 1, assertionId: "membership", payloadDigest: `sha256:${"b".repeat(64)}`, decisionEvidenceId: "membership-decision", trustedUntil: "2099-07-18T00:00:00.000Z" }, capability: { agentIdentityId: "identity-1", computerId: "computer-1", capabilitySetDigest: `sha256:${"c".repeat(64)}`, effectiveContractDigest: `sha256:${"d".repeat(64)}`, decisionEvidenceId: "capability-decision", decidedAt: "2026-07-18T00:00:00.000Z" }, runScope: { siloId: "silo-1", runId: "run-1", attempt: 1, agentServiceId: "service-1", agentRevisionId: "revision-1" }, computerScope: { siloId: "silo-1", computerId: "computer-1", leaseId: "lease-1", leaseGeneration: 1 }, requester: { siloId: "silo-1", requesterPrincipalId: "requester-1", requestIdempotencyKey: "request-1", authenticatedAt: "2026-07-18T00:00:00.000Z" }, admission: { authorizingPrincipalId: "authorizer-1", decisionEvidenceId: "admission-decision", admittedAt: "2026-07-18T00:00:00.000Z" } },
		requestIdempotencyKey: "request-1",
		lineage: { rootRunId: "run-1", parentRunId: null },
		attempt: 1,
		state: "failed",
		inputSnapshotDigest: "sha256:input",
		acceptedAt: "2026-07-18T00:00:00.000Z",
		startedAt: "2026-07-18T00:00:01.000Z",
		finishedAt: "2026-07-18T00:00:02.000Z",
		terminalReason: "runtime_failure",
	};
}

/** Creates a fresh immutable retry snapshot with the next lease-scoped subject. */
function _nextSnapshot(): RunInputSnapshot
{
	const previousSubject = _run().executionSubject;
	const executionSubject = { ...previousSubject, runScope: { ...previousSubject.runScope, attempt: 2 }, computerScope: { ...previousSubject.computerScope, leaseId: "lease-2", leaseGeneration: 2 } };
	return { runId: "run-1", attempt: 2, siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", snapshotVersion: 1, conversationId: "conversation-1", messageIds: [], personaRevisionId: null, preferenceFactIds: [], artifactRevisionIds: [], skillRevisionIds: [], memoryQueryPolicy: {}, mcpTools: [], modelRoute: {}, budgetPolicy: {}, executionSubject, promptCompilerVersion: "prompt-v1", digest: `sha256:${"e".repeat(64)}`, compiledAt: "2026-07-18T01:00:00.000Z" };
}

/** In-memory compare-and-swap adapter for attempt-concurrency tests. */
class _RunRepository implements AgentRunRetryTransactionRepository
{
	/** Current logical run authority state. */
	private run: AgentRun = _run();

	/** Current lifecycle state of the run's AgentService. */
	private agentServiceState: AgentServiceState | null;

	/** Immutable silo of the run's AgentService. */
	private agentServiceSiloId: SiloId | null = "silo-1";

	/** Current active revision of the run's AgentService. */
	private activeAgentRevisionId: AgentRevisionId | null;

	/** Lifecycle mutation applied immediately before the next atomic retry. */
	private nextAtomicAgentServiceState: AgentServiceState | null | undefined;

	/** Active-revision mutation applied immediately before the next atomic retry. */
	private nextAtomicAgentRevisionId: AgentRevisionId | null | undefined;

	/**
	 * Creates a repository with configurable pre-read service authority.
	 * @param agentServiceState - Current service lifecycle state.
	 * @param activeAgentRevisionId - Current service active revision.
	 */
	constructor(agentServiceState: AgentServiceState | null = "active", activeAgentRevisionId: AgentRevisionId | null = "revision-1")
	{
		this.agentServiceState = agentServiceState;
		this.activeAgentRevisionId = activeAgentRevisionId;
	}

	/** Loads run and AgentService authority as one read snapshot. */
	async getRunAuthority(runId: AgentRunId): Promise<AgentRunAuthoritySnapshot | null>
	{
		return runId === this.run.id
			? { run: this.run, agentServiceState: this.agentServiceState, agentServiceSiloId: this.agentServiceSiloId, activeAgentRevisionId: this.activeAgentRevisionId }
			: null;
	}

	/** Allows a new retry until a test supplies a durable replay result. */
	async checkRetryReplay(_command: StartNextRunAttemptCommand): Promise<RetryReplayCheck>
	{
		return { status: RetryReplayCheckStatuses.Proceed };
	}

	/** No transaction-retry test asks this in-memory domain adapter to read a committed winner. */
	async readRetryWinner(_command: StartNextRunAttemptCommand): Promise<import("../run-authority.types").StartNextRunAttemptResult | null>
	{
		return null;
	}

	/** Schedules a service retirement immediately before the next atomic retry compare-and-swap. */
	retireBeforeNextAtomic(): void
	{
		this.nextAtomicAgentServiceState = "retired";
	}

	/** Schedules an active-revision rollover immediately before the next atomic retry compare-and-swap. */
	rollOverBeforeNextAtomic(): void
	{
		this.nextAtomicAgentRevisionId = "revision-2";
	}

	/** Schedules an invalid AgentService silo mutation immediately before the next atomic retry. */
	changeSiloBeforeNextAtomic(): void
	{
		this.agentServiceSiloId = "silo-other";
	}

	/** Starts only while run attempt and exact active AgentService revision still match. */
	async startNextAttemptAtomically(command: AtomicStartNextRunAttemptCommand): Promise<AtomicRunAttemptResult>
	{
		if (this.nextAtomicAgentServiceState !== undefined)
		{
			this.agentServiceState = this.nextAtomicAgentServiceState;
			this.nextAtomicAgentServiceState = undefined;
		}
		if (this.nextAtomicAgentRevisionId !== undefined)
		{
			this.activeAgentRevisionId = this.nextAtomicAgentRevisionId;
			this.nextAtomicAgentRevisionId = undefined;
		}

		if (command.runId !== this.run.id)
			return { status: "not_found" };
		if (command.expectedAttempt !== this.run.attempt)
			return { status: "attempt_conflict", currentAttempt: this.run.attempt };
		if (command.expectedAgentServiceId !== this.run.agentServiceId || command.expectedAgentServiceSiloId !== this.agentServiceSiloId || command.expectedAgentServiceState !== this.agentServiceState || command.expectedActiveAgentRevisionId !== this.activeAgentRevisionId)
		{
			return { status: "agent_service_authority_conflict", currentAgentServiceState: this.agentServiceState, currentAgentServiceSiloId: this.agentServiceSiloId, currentActiveAgentRevisionId: this.activeAgentRevisionId };
		}
		this.run = {
			...this.run,
			attempt: this.run.attempt + 1,
			executionSubject: command.nextInputSnapshot.executionSubject,
			inputSnapshotDigest: command.nextInputSnapshot.digest,
			state: "accepted",
			acceptedAt: command.acceptedAt,
			startedAt: null,
			finishedAt: null,
			terminalReason: null,
		};
		return { status: "started", run: this.run };
	}
}

/** Compiles a next-attempt snapshot from the exact retry command passed by the authority. */
function _Compiler(): RetryRunInputCompiler
{
	return { compile: async function _Compile(command) { return { outcome: RetryRunInputCompileOutcomes.Compiled, nextInputSnapshot: _nextSnapshotFor(command) }; } };
}

/** Binds a test snapshot to the retry command so validation sees the compiler's current input. */
function _nextSnapshotFor(command: StartNextRunAttemptCommand): RunInputSnapshot
{
	const snapshot = _nextSnapshot();
	return { ...snapshot, runId: command.runId, attempt: command.expectedAttempt + 1, siloId: command.siloId, executionSubject: { ...snapshot.executionSubject, runScope: { ...snapshot.executionSubject.runScope, runId: command.runId, attempt: command.expectedAttempt + 1, siloId: command.siloId }, computerScope: { ...snapshot.executionSubject.computerScope, siloId: command.siloId } } };
}

/** Supplies the transaction capability required by the retry compiler's narrow contract. */
function _transaction(): RunAdmissionTransaction
{
	return { prisma: {} as never, admittedAt: "2026-07-18T01:00:00.000Z", admittedAtEpochMs: Date.parse("2026-07-18T01:00:00.000Z") };
}

describe("single AgentRun authority", function _suite()
{
	it("increments only one attempt when retry requests race", async function _concurrentRetry()
	{
		const repository = new _RunRepository();
		const command = _command();
		const results = await Promise.all([__StartNextRunAttempt(repository, command, _Compiler(), _transaction()), __StartNextRunAttempt(repository, command, _Compiler(), _transaction())]);

		expect(results.filter(result => result.outcome === "started")).toHaveLength(1);
		expect(results.filter(result => result.outcome === "denied")).toHaveLength(1);
		expect((await repository.getRunAuthority("run-1"))?.run.attempt).toBe(2);
	});

	it("returns the durable next attempt even when the service later retires", async function _IdempotentAfterRetirement()
	{
		const run = { ..._run(), attempt: 2, state: "accepted" as const, acceptedAt: "2026-07-18T01:00:00.000Z", startedAt: null, finishedAt: null, terminalReason: null };
		const repository: AgentRunRetryTransactionRepository = {
			checkRetryReplay: async function _Replay() { return { status: RetryReplayCheckStatuses.Idempotent, run }; },
			getRunAuthority: async function _Get() { return { run, agentServiceState: "retired", agentServiceSiloId: "silo-1", activeAgentRevisionId: "revision-2" }; },
			startNextAttemptAtomically: async function _Start() { return { status: "idempotent", run }; },
			readRetryWinner: async function _Winner() { return null; },
		};

		await expect(__StartNextRunAttempt(repository, _command(), { compile: async function _Compile() { throw new Error("idempotent replays do not compile"); } }, _transaction())).resolves.toEqual({ outcome: "idempotent", run });
	});

	it("denies retry when the AgentService is retired before the authority read", async function _retiredService()
	{
		const repository = new _RunRepository("retired");

		await expect(__StartNextRunAttempt(repository, _command(), _Compiler(), _transaction())).resolves.toEqual({ outcome: "denied", reason: "agent_service_inactive" });
	});

	it("denies retry when the AgentService is paused before the authority read", async function _pausedService()
	{
		const repository = new _RunRepository("paused");

		await expect(__StartNextRunAttempt(repository, _command(), _Compiler(), _transaction())).resolves.toEqual({ outcome: "denied", reason: "agent_service_inactive" });
	});

	it("denies retry when the run revision has already been superseded", async function _supersededRevision()
	{
		const repository = new _RunRepository("active", "revision-2");

		await expect(__StartNextRunAttempt(repository, _command(), _Compiler(), _transaction())).resolves.toEqual({ outcome: "denied", reason: "agent_revision_superseded" });
	});

	it("denies retry when the AgentService retires during the atomic command", async function _concurrentRetirement()
	{
		const repository = new _RunRepository();
		repository.retireBeforeNextAtomic();

		await expect(__StartNextRunAttempt(repository, _command(), _Compiler(), _transaction())).resolves.toEqual({ outcome: "denied", reason: "agent_service_inactive" });
		expect((await repository.getRunAuthority("run-1"))?.run.attempt).toBe(1);
	});

	it("denies retry when the active revision rolls over during the atomic command", async function _concurrentRollover()
	{
		const repository = new _RunRepository();
		repository.rollOverBeforeNextAtomic();

		await expect(__StartNextRunAttempt(repository, _command(), _Compiler(), _transaction())).resolves.toEqual({ outcome: "denied", reason: "agent_revision_superseded" });
		expect((await repository.getRunAuthority("run-1"))?.run.attempt).toBe(1);
	});

	it("denies retry when the service silo differs at the atomic boundary", async function _concurrentSiloMismatch()
	{
		const repository = new _RunRepository();
		repository.changeSiloBeforeNextAtomic();

		await expect(__StartNextRunAttempt(repository, _command(), _Compiler(), _transaction())).resolves.toEqual({ outcome: "denied", reason: "agent_service_silo_mismatch" });
		expect((await repository.getRunAuthority("run-1"))?.run.attempt).toBe(1);
	});
});
