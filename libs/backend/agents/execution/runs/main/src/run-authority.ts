import { ___ExecutionSubjectSchema, type RunInputSnapshot } from "@opencrane/contracts";
import type { AgentRun } from "@opencrane/models/agents";

import { RetryRunInputCompileOutcomes, type RetryRunInputCompiler } from "./retry-run-input.types";
import type { RunAdmissionTransaction } from "./run-admission.types";
import { RetryReplayCheckStatuses, type AgentRunRetryTransactionRepository, type StartNextRunAttemptCommand, type StartNextRunAttemptResult } from "./run-authority.types";

/**
 * Returns whether a run has finished in a way a person can ask to run again.
 *
 * Only `failed` and `cancelled` qualify. A run still working would end up with two live attempts,
 * and a `completed` run has an answer already, so neither is retried.
 */
function _isRetryable(run: AgentRun): boolean
{
	return run.state === "failed" || run.state === "cancelled";
}

/**
 * Runs a failed or cancelled run again, by raising its attempt counter instead of creating a second
 * run.
 *
 * You hit this when a participant presses retry on a run that ended badly. Keeping one run row means
 * the conversation still has a single run to point at, and the transcript does not gain a duplicate
 * every time someone retries.
 *
 * The read here only decides what to tell the user; it cannot be relied on for the write. The
 * AgentService can retire or roll its revision in between, so every value read is passed down to the
 * repository and the write is made conditional on all of them — that is what makes two people
 * pressing retry at once produce one new attempt and one conflict, as
 * "increments only one attempt when retry requests race" asserts.
 *
 * A replayed retry is handled ahead of the state checks. If the run is already one attempt past what
 * the caller observed and owns the deterministic workflow task for that attempt, the terminal and
 * service checks are skipped. This lets a repeat still succeed after the AgentService has retired.
 *
 * Called by: `PrismaAgentRunRetryUnitOfWork` in the runs package, reached from
 * `POST /api/v1/me/conversations/{conversationId}/runs/{runId}/retry`.
 *
 * @param repository - Transaction-bound retry repository. The replay, authority checks, compiler,
 * and compare-and-swap all use the same serializable unit of work.
 * @param command - The run, the attempt the participant observed, and who is asking.
 * @param compiler - Builds a fresh subject only after the durable replay and current authority
 * checks allow a new attempt.
 * @param transaction - The transaction capability through which the compiler must read every
 * current authority fact.
 * @returns `started` when this call created the attempt, `idempotent` when an earlier request already
 * started it — both are successes carrying the run at its new attempt. `denied` means nothing changed; the
 * reason decides the status code the router sends and whether the client should re-read first.
 * @throws Whatever the repository throws, typically when the database is unreachable. The router
 * catches it and answers 503, so a caller must not read a throw as a refusal.
 * @see StartNextRunAttemptResult for what each outcome and denial reason means.
 */
export async function __StartNextRunAttempt(repository: AgentRunRetryTransactionRepository, command: StartNextRunAttemptCommand, compiler: RetryRunInputCompiler, transaction: RunAdmissionTransaction): Promise<StartNextRunAttemptResult>
{
	// 1. Refuse a malformed command before touching the database. Every field here is required by the
	// write's conditions, so a blank one would silently widen or narrow what the update matches.
	if (!command.runId.trim() || !command.siloId.trim() || !command.conversationId.trim() || !command.requestedBy.trim() || !command.requestedByPrincipalId.trim() || !Number.isSafeInteger(command.expectedAttempt) || command.expectedAttempt < 1 || !Number.isFinite(Date.parse(command.acceptedAt)))
	{
		return { outcome: "denied", reason: "invalid_command" };
	}

	// 2. Authenticate the current request and settle an already committed deterministic retry before
	// compiling anything. A replay never needs a new computer lease or capability decision: the next
	// attempt and its workflow task already committed together. New work proceeds only after the
	// current requester authority is checked in this same serializable transaction.
	const replay = await repository.checkRetryReplay(command);
	if (replay.status === RetryReplayCheckStatuses.Idempotent)
	{
		return { outcome: "idempotent", run: replay.run };
	}
	if (replay.status === RetryReplayCheckStatuses.Unauthorized)
	{
		return { outcome: "denied", reason: "unauthorized" };
	}
	if (replay.status === RetryReplayCheckStatuses.NotFound)
	{
		return { outcome: "denied", reason: "run_not_found" };
	}

	// 3. Read the run and its service in one go, and work out the answer to give the user. Reading
	// them separately would let the service change in between and produce a reason that was never
	// true at any single moment. A run in another silo or conversation is reported as `unauthorized`,
	// which the router answers 404 for, so this cannot be used to find out that a run exists.
	// The replay gate above is deliberately before this authority read: a run one attempt ahead may be
	// the same request arriving twice, and must remain successful after the service retires.
	const authority = await repository.getRunAuthority(command.runId);
	if (authority === null)
	{
		return { outcome: "denied", reason: "run_not_found" };
	}
	const { run } = authority;
	if (run.siloId !== command.siloId || run.conversationId !== command.conversationId)
	{
		return { outcome: "denied", reason: "unauthorized" };
	}
	if (!_isRetryable(run))
	{
		return { outcome: "denied", reason: "run_not_terminal" };
	}
	if (authority.agentServiceState !== "active")
	{
		return { outcome: "denied", reason: "agent_service_inactive" };
	}
	if (authority.agentServiceSiloId !== run.siloId)
	{
		return { outcome: "denied", reason: "agent_service_silo_mismatch" };
	}
	if (authority.activeAgentRevisionId !== run.agentRevisionId)
	{
		return { outcome: "denied", reason: "agent_revision_superseded" };
	}

	// 4. Compile only after the replay and current run, service, requester checks have passed. The
	// caller is inside the same serializable unit of work as the following CAS, so a rollback repeats
	// this complete decision rather than freezing a snapshot from an earlier transaction attempt.
	const compilation = await compiler.compile(command, transaction);
	if (compilation.outcome === RetryRunInputCompileOutcomes.Denied)
	{
		return { outcome: "denied", reason: compilation.reason };
	}
	if (!_NextSnapshotMatches({ ...command, nextInputSnapshot: compilation.nextInputSnapshot }))
	{
		return { outcome: "denied", reason: "invalid_command" };
	}

	// 5. Send every value just read back down, so the write only applies while they are all still
	// true. Without that, two retries arriving together would both pass the checks above and both
	// increment, and a service that retired in between would get a new attempt anyway.
	const result = await repository.startNextAttemptAtomically({
		...command,
		nextInputSnapshot: compilation.nextInputSnapshot,
		expectedAgentServiceId: run.agentServiceId,
		expectedAgentServiceSiloId: run.siloId,
		expectedAgentServiceState: "active",
		expectedActiveAgentRevisionId: run.agentRevisionId,
	});
	if (result.status === "not_found")
	{
		return { outcome: "denied", reason: "run_not_found" };
	}
	if (result.status === "unauthorized")
	{
		return { outcome: "denied", reason: "unauthorized" };
	}
	if (result.status === "idempotent")
	{
		return { outcome: "idempotent", run: result.run };
	}
	if (result.status === "attempt_conflict")
	{
		return { outcome: "denied", reason: "attempt_conflict", currentAttempt: result.currentAttempt };
	}
	// 6. Turn the one service conflict the repository reports into the specific reason the user needs,
	// using the current service facts it sent back. A retry refused because the Agent has been changed
	// since is a different message from one refused because the Agent can no longer run at all, and
	// the wrong silo is checked first because it makes the other two meaningless.
	if (result.status === "agent_service_authority_conflict")
	{
		if (result.currentAgentServiceSiloId !== run.siloId)
		{
			return { outcome: "denied", reason: "agent_service_silo_mismatch" };
		}
		return result.currentAgentServiceState === "active"
			? { outcome: "denied", reason: "agent_revision_superseded" }
			: { outcome: "denied", reason: "agent_service_inactive" };
	}
	return { outcome: "started", run: result.run };
}

/** Validates that one newly compiled immutable snapshot binds the exact next attempt and computer lease. */
function _NextSnapshotMatches(command: StartNextRunAttemptCommand & { readonly nextInputSnapshot: RunInputSnapshot }): boolean
{
	const snapshot = command.nextInputSnapshot;
	const subject = ___ExecutionSubjectSchema.safeParse(snapshot.executionSubject);
	if (!subject.success)
		return false;
	const nextAttempt = command.expectedAttempt + 1;
	return snapshot.runId === command.runId
		&& snapshot.attempt === nextAttempt
		&& snapshot.siloId === command.siloId
		&& snapshot.agentServiceId === subject.data.runScope.agentServiceId
		&& snapshot.agentRevisionId === subject.data.runScope.agentRevisionId
		&& subject.data.runScope.runId === command.runId
		&& subject.data.runScope.attempt === nextAttempt
		&& subject.data.runScope.siloId === command.siloId
		&& subject.data.computerScope.siloId === command.siloId;
}
