import type { AgentRevisionId, AgentRun, AgentRunId, AgentServiceState, SiloId } from "@opencrane/models/agents";
import { describe, expect, it } from "vitest";

import { __StartNextRunAttempt, __ValidateRunWorkloadAssignment } from "../run-authority.js";
import type { AgentRunAuthorityRepository, AgentRunAuthoritySnapshot, AtomicRunAttemptResult, AtomicStartNextRunAttemptCommand, RunWorkloadAssignment, RunWorkloadAssignmentExpectation } from "../run-authority.types.js";

/** Creates a failed first attempt for one logical run. */
function _run(): AgentRun
{
	return {
		id: "run-1",
		siloId: "silo-1",
		agentServiceId: "service-1",
		agentRevisionId: "revision-1",
		threadId: "thread-1",
		trigger: "interactive",
		delegatedUserId: "user-1",
		requestIdempotencyKey: "request-1",
		lineage: { rootRunId: "run-1", parentRunId: null },
		attempt: 1,
		state: "failed",
		effectiveContractDigest: "sha256:contract",
		inputSnapshotDigest: "sha256:input",
		acceptedAt: "2026-07-18T00:00:00.000Z",
		startedAt: "2026-07-18T00:00:01.000Z",
		finishedAt: "2026-07-18T00:00:02.000Z",
		terminalReason: "runtime_failure",
	};
}

/** In-memory compare-and-swap adapter for attempt-concurrency tests. */
class _RunRepository implements AgentRunAuthorityRepository
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

		if (command.runId !== this.run.id) return { status: "not_found" };
		if (command.expectedAttempt !== this.run.attempt) return { status: "attempt_conflict", currentAttempt: this.run.attempt };
		if (command.expectedAgentServiceId !== this.run.agentServiceId || command.expectedAgentServiceSiloId !== this.agentServiceSiloId || command.expectedAgentServiceState !== this.agentServiceState || command.expectedActiveAgentRevisionId !== this.activeAgentRevisionId)
		{
			return { status: "agent_service_authority_conflict", currentAgentServiceState: this.agentServiceState, currentAgentServiceSiloId: this.agentServiceSiloId, currentActiveAgentRevisionId: this.activeAgentRevisionId };
		}
		this.run = {
			...this.run,
			attempt: this.run.attempt + 1,
			state: "accepted",
			acceptedAt: command.acceptedAt,
			startedAt: null,
			finishedAt: null,
			terminalReason: null,
		};
		return { status: "started", run: this.run };
	}
}

/** Creates a complete proof-bound assignment fixture. */
function _assignment(): RunWorkloadAssignment
{
	return {
		runId: "run-1",
		agentServiceId: "service-1",
		attempt: 2,
		agentRevisionId: "revision-1",
		siloId: "silo-1",
		audience: "opencrane-agent-runtime",
		subjectId: "user-1",
		serviceAccountName: "agent-runtime",
		namespace: "silo-1",
		workloadKind: "job",
		workloadUid: "job-uid-1",
		podUid: "pod-uid-1",
		expiresAtEpochMs: 2000,
	};
}

/** Creates the exact authority expectation for the assignment fixture. */
function _expectation(): RunWorkloadAssignmentExpectation
{
	return { ..._assignment(), nowEpochMs: 1000 };
}

describe("single AgentRun authority", function _suite()
{
	it("increments only one attempt when retry requests race", async function _concurrentRetry()
	{
		const repository = new _RunRepository();
		const command = { runId: "run-1", expectedAttempt: 1, acceptedAt: "2026-07-18T01:00:00.000Z" } as const;
		const results = await Promise.all([__StartNextRunAttempt(repository, command), __StartNextRunAttempt(repository, command)]);

		expect(results.filter(result => result.outcome === "started")).toHaveLength(1);
		expect(results.filter(result => result.outcome === "denied")).toHaveLength(1);
		expect((await repository.getRunAuthority("run-1"))?.run.attempt).toBe(2);
	});

	it("denies retry when the AgentService is retired before the authority read", async function _retiredService()
	{
		const repository = new _RunRepository("retired");

		await expect(__StartNextRunAttempt(repository, { runId: "run-1", expectedAttempt: 1, acceptedAt: "2026-07-18T01:00:00.000Z" })).resolves.toEqual({ outcome: "denied", reason: "agent_service_inactive" });
	});

	it("denies retry when the AgentService is paused before the authority read", async function _pausedService()
	{
		const repository = new _RunRepository("paused");

		await expect(__StartNextRunAttempt(repository, { runId: "run-1", expectedAttempt: 1, acceptedAt: "2026-07-18T01:00:00.000Z" })).resolves.toEqual({ outcome: "denied", reason: "agent_service_inactive" });
	});

	it("denies retry when the run revision has already been superseded", async function _supersededRevision()
	{
		const repository = new _RunRepository("active", "revision-2");

		await expect(__StartNextRunAttempt(repository, { runId: "run-1", expectedAttempt: 1, acceptedAt: "2026-07-18T01:00:00.000Z" })).resolves.toEqual({ outcome: "denied", reason: "agent_revision_superseded" });
	});

	it("denies retry when the AgentService retires during the atomic command", async function _concurrentRetirement()
	{
		const repository = new _RunRepository();
		repository.retireBeforeNextAtomic();

		await expect(__StartNextRunAttempt(repository, { runId: "run-1", expectedAttempt: 1, acceptedAt: "2026-07-18T01:00:00.000Z" })).resolves.toEqual({ outcome: "denied", reason: "agent_service_inactive" });
		expect((await repository.getRunAuthority("run-1"))?.run.attempt).toBe(1);
	});

	it("denies retry when the active revision rolls over during the atomic command", async function _concurrentRollover()
	{
		const repository = new _RunRepository();
		repository.rollOverBeforeNextAtomic();

		await expect(__StartNextRunAttempt(repository, { runId: "run-1", expectedAttempt: 1, acceptedAt: "2026-07-18T01:00:00.000Z" })).resolves.toEqual({ outcome: "denied", reason: "agent_revision_superseded" });
		expect((await repository.getRunAuthority("run-1"))?.run.attempt).toBe(1);
	});

	it("denies retry when the service silo differs at the atomic boundary", async function _concurrentSiloMismatch()
	{
		const repository = new _RunRepository();
		repository.changeSiloBeforeNextAtomic();

		await expect(__StartNextRunAttempt(repository, { runId: "run-1", expectedAttempt: 1, acceptedAt: "2026-07-18T01:00:00.000Z" })).resolves.toEqual({ outcome: "denied", reason: "agent_service_silo_mismatch" });
		expect((await repository.getRunAuthority("run-1"))?.run.attempt).toBe(1);
	});

	it("binds workload identity to the exact run and attempt", function _assignmentBinding()
	{
		expect(__ValidateRunWorkloadAssignment(_assignment(), _expectation())).toEqual({ outcome: "trusted" });
		expect(__ValidateRunWorkloadAssignment({ ..._assignment(), runId: "run-other" }, _expectation())).toEqual({ outcome: "denied", reason: "run_mismatch" });
		expect(__ValidateRunWorkloadAssignment({ ..._assignment(), agentServiceId: "service-other" }, _expectation())).toEqual({ outcome: "denied", reason: "agent_service_mismatch" });
		expect(__ValidateRunWorkloadAssignment({ ..._assignment(), audience: "artifact-service" as RunWorkloadAssignment["audience"] }, _expectation())).toEqual({ outcome: "denied", reason: "projected_token_audience_mismatch" });
		expect(__ValidateRunWorkloadAssignment({ ..._assignment(), audience: "artifact-service" as RunWorkloadAssignment["audience"] }, { ..._expectation(), audience: "artifact-service" as RunWorkloadAssignmentExpectation["audience"] })).toEqual({ outcome: "denied", reason: "projected_token_audience_mismatch" });
		expect(__ValidateRunWorkloadAssignment({ ..._assignment(), workloadKind: "deployment" as RunWorkloadAssignment["workloadKind"] }, _expectation())).toEqual({ outcome: "denied", reason: "invalid_workload_kind" });
		expect(__ValidateRunWorkloadAssignment({ ..._assignment(), attempt: 3 }, _expectation())).toEqual({ outcome: "denied", reason: "attempt_mismatch" });
	});
});
