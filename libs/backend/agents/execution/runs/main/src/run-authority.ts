import type { AgentRun } from "@opencrane/models/agents";

import type { AgentRunAuthorityRepository, StartNextRunAttemptCommand, StartNextRunAttemptResult } from "./run-authority.types";

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
 * the caller observed, this may be that caller's own earlier request arriving twice, so the terminal
 * and service checks are skipped and the repository decides by comparing the stored retry key. Doing
 * it in this order is what lets a repeat still succeed after the AgentService has since retired,
 * which "returns the durable same-key attempt even when the service later retires" pins.
 *
 * Called by: `PrismaConversationUnitOfWork.retryRun`
 * (libs/backend/server/conversations/main/src/db/prisma-conversation-unit-of-work.ts), reached from
 * `POST /api/v1/me/conversations/{conversationId}/runs/{runId}/retry`.
 *
 * @param repository - Where the run is read and the attempt raised; the same instance is used for
 * both, so they see one database.
 * @param command - The run, the attempt the participant observed, who is asking, and their retry key.
 * @returns `started` when this call created the attempt, `idempotent` when the same retry key already
 * had — both are successes carrying the run at its new attempt. `denied` means nothing changed; the
 * reason decides the status code the router sends and whether the client should re-read first.
 * @throws Whatever the repository throws, typically when the database is unreachable. The router
 * catches it and answers 503, so a caller must not read a throw as a refusal.
 * @see StartNextRunAttemptResult for what each outcome and denial reason means.
 */
export async function __StartNextRunAttempt(repository: AgentRunAuthorityRepository, command: StartNextRunAttemptCommand): Promise<StartNextRunAttemptResult>
{
	// 1. Refuse a malformed command before touching the database. Every field here is required by the
	// write's conditions, so a blank one would silently widen or narrow what the update matches.
	if (!command.runId.trim() || !command.siloId.trim() || !command.conversationId.trim() || !command.requestedBy.trim() || !command.idempotencyKey.trim() || !Number.isSafeInteger(command.expectedAttempt) || command.expectedAttempt < 1 || !Number.isFinite(Date.parse(command.acceptedAt)))
	{
		return { outcome: "denied", reason: "invalid_command" };
	}

	// 2. Read the run and its service in one go, and work out the answer to give the user. Reading
	// them separately would let the service change in between and produce a reason that was never
	// true at any single moment. A run in another silo or conversation is reported as `unauthorized`,
	// which the router answers 404 for, so this cannot be used to find out that a run exists.
	// The `couldBeIdempotentRetry` check comes first because a run one attempt ahead may be this same
	// request arriving twice: in that case the state and service checks are skipped and the repository
	// settles it by the stored retry key, so a repeat still succeeds after the service has retired.
	const authority = await repository.getRunAuthority(command.runId);
	if (authority === null)
	{
		return { outcome: "denied", reason: "run_not_found" };
	}
	const { run } = authority;
	if (run.siloId !== command.siloId || run.conversationId !== command.conversationId) return { outcome: "denied", reason: "unauthorized" };
	const couldBeIdempotentRetry = run.attempt === command.expectedAttempt + 1;
	if (!_isRetryable(run) && !couldBeIdempotentRetry)
	{
		return { outcome: "denied", reason: "run_not_terminal" };
	}
	if (!couldBeIdempotentRetry && authority.agentServiceState !== "active")
	{
		return { outcome: "denied", reason: "agent_service_inactive" };
	}
	if (!couldBeIdempotentRetry && authority.agentServiceSiloId !== run.siloId)
	{
		return { outcome: "denied", reason: "agent_service_silo_mismatch" };
	}
	if (!couldBeIdempotentRetry && authority.activeAgentRevisionId !== run.agentRevisionId)
	{
		return { outcome: "denied", reason: "agent_revision_superseded" };
	}

	// 3. Send every value just read back down, so the write only applies while they are all still
	// true. Without that, two retries arriving together would both pass the checks above and both
	// increment, and a service that retired in between would get a new attempt anyway.
	const result = await repository.startNextAttemptAtomically({
		...command,
		expectedAgentServiceId: run.agentServiceId,
		expectedAgentServiceSiloId: run.siloId,
		expectedAgentServiceState: "active",
		expectedActiveAgentRevisionId: run.agentRevisionId,
	});
	if (result.status === "not_found")
	{
		return { outcome: "denied", reason: "run_not_found" };
	}
	if (result.status === "unauthorized") return { outcome: "denied", reason: "unauthorized" };
	if (result.status === "idempotent") return { outcome: "idempotent", run: result.run };
	if (result.status === "attempt_conflict")
	{
		return { outcome: "denied", reason: "attempt_conflict", currentAttempt: result.currentAttempt };
	}
	// 4. Turn the one service conflict the repository reports into the specific reason the user needs,
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
