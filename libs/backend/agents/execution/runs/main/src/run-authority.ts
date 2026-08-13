import type { AgentRun } from "@opencrane/models/agents";
import { AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE, MANAGED_AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE, ___IsAgentRuntimeServiceAccountName, ___IsManagedAgentRuntimeServiceAccountName } from "@opencrane/contracts";

import type { AgentRunAuthorityRepository, RunWorkloadAssignment, RunWorkloadAssignmentDecision, RunWorkloadAssignmentExpectation, StartNextRunAttemptCommand, StartNextRunAttemptResult } from "./run-authority.types.js";

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
 * Returns whether a claimed workload kind is one this server knows how to reason about.
 *
 * `job` is the only value, because `agent-controller` creates a Kubernetes Job per attempt and
 * nothing else. Anything else is a claim about a workload the server never created.
 */
function _isWorkloadKind(value: string): value is "job"
{
	return value === "job";
}

/**
 * Returns whether an audience and a ServiceAccount name come from the same runtime class.
 *
 * A personal audience needs an `agent-runtime-` ServiceAccount and a managed audience needs a
 * `managed-agent-runtime-` one. Checking the pair rather than each field on its own is what stops a
 * managed audience being presented with a personal runtime's ServiceAccount, which is a case the
 * "binds workload identity to the exact run and attempt" test asserts is denied.
 *
 * @see ___IsManagedAgentRuntimeServiceAccountName in `@opencrane/contracts` for why the two name
 * prefixes are kept from overlapping.
 */
function _isRuntimeWorkloadIdentity(audience: string, serviceAccountName: string): boolean
{
	return (audience === AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE && ___IsAgentRuntimeServiceAccountName(serviceAccountName))
		|| (audience === MANAGED_AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE && ___IsManagedAgentRuntimeServiceAccountName(serviceAccountName));
}

/**
 * Decides whether a runtime Pod's claim really is the run attempt the server created it for.
 *
 * You hit this when a runtime Pod presents its assignment and asks for execution material. Its
 * projected ServiceAccount token proves only that it is *some* runtime of that class; it says
 * nothing about which run, attempt, or user it may act for. So every coordinate is compared against
 * what the server already knows, and a Pod left over from an earlier attempt, or from another user's
 * run in the same namespace, is refused.
 *
 * Called by: nothing in production yet — today only `__tests__/run-authority.test.ts` exercises it,
 * and the package barrel does not re-export it, so the admission caller is still to be wired up.
 *
 * @param assignment - What the runtime Pod claims. Untrusted.
 * @param expectation - What the server knows, plus its current time. Trusted.
 * @returns `trusted` only when every field matches and the assignment has not expired — then, and
 * only then, may the caller hand over execution material. Any `denied` reason means hand over
 * nothing; the reason is for logs and tests and should not be told to the Pod, which would otherwise
 * learn which field to change.
 * @see RunWorkloadAssignmentDecision for what each denial reason means.
 * @see docs/adr/0008-target-agent-contracts-and-workload-identity.md, "Workload identity", which
 * requires the Pod UID, namespace, ServiceAccount, audience, run, attempt, revision, silo, and
 * subject to all be bound before execution material is released.
 */
export function __ValidateRunWorkloadAssignment(assignment: RunWorkloadAssignment, expectation: RunWorkloadAssignmentExpectation): RunWorkloadAssignmentDecision
{
	// 1. Reject blank ids, non-positive attempts, and unknown workload kinds first. Two sides can
	// agree on a blank string or a nonsense attempt, so equality alone would let that through.
	const requiredIdentifiers = [assignment.runId, assignment.agentServiceId, assignment.agentRevisionId, assignment.siloId, assignment.audience, assignment.subjectId, assignment.serviceAccountName, assignment.namespace, assignment.workloadUid, assignment.podUid, expectation.runId, expectation.agentServiceId, expectation.agentRevisionId, expectation.siloId, expectation.audience, expectation.subjectId, expectation.serviceAccountName, expectation.namespace, expectation.workloadUid, expectation.podUid];
	if (requiredIdentifiers.some(value => !value.trim())) return { outcome: "denied", reason: "invalid_assignment" };
	if (!Number.isSafeInteger(assignment.attempt) || assignment.attempt < 1 || !Number.isSafeInteger(expectation.attempt) || expectation.attempt < 1)
	{
		return { outcome: "denied", reason: "invalid_attempt" };
	}
	if (!_isWorkloadKind(assignment.workloadKind) || !_isWorkloadKind(expectation.workloadKind)) return { outcome: "denied", reason: "invalid_workload_kind" };

	// 2. Compare each field the server knows independently, one at a time, so the denial names the
	// field that disagreed. All of them must match: any single mismatch means this Pod is not the one
	// this attempt was created for.
	if (assignment.runId !== expectation.runId) return { outcome: "denied", reason: "run_mismatch" };
	if (assignment.agentServiceId !== expectation.agentServiceId) return { outcome: "denied", reason: "agent_service_mismatch" };
	if (assignment.attempt !== expectation.attempt) return { outcome: "denied", reason: "attempt_mismatch" };
	if (assignment.agentRevisionId !== expectation.agentRevisionId) return { outcome: "denied", reason: "revision_mismatch" };
	if (assignment.siloId !== expectation.siloId) return { outcome: "denied", reason: "silo_mismatch" };
	if (!_isRuntimeWorkloadIdentity(assignment.audience, assignment.serviceAccountName) || !_isRuntimeWorkloadIdentity(expectation.audience, expectation.serviceAccountName) || assignment.audience !== expectation.audience) return { outcome: "denied", reason: "projected_token_audience_mismatch" };
	if (assignment.subjectId !== expectation.subjectId) return { outcome: "denied", reason: "subject_mismatch" };
	if (assignment.serviceAccountName !== expectation.serviceAccountName) return { outcome: "denied", reason: "service_account_mismatch" };
	if (assignment.namespace !== expectation.namespace) return { outcome: "denied", reason: "namespace_mismatch" };
	if (assignment.workloadKind !== expectation.workloadKind) return { outcome: "denied", reason: "workload_kind_mismatch" };
	if (assignment.workloadUid !== expectation.workloadUid) return { outcome: "denied", reason: "workload_uid_mismatch" };
	if (assignment.podUid !== expectation.podUid) return { outcome: "denied", reason: "pod_mismatch" };

	// 3. Refuse an assignment whose moment has passed, even though everything matched, so a claim
	// captured earlier cannot be replayed later. An unusable clock value is treated as expired too,
	// which fails closed rather than trusting an assignment whose age cannot be worked out.
	if (!Number.isSafeInteger(expectation.nowEpochMs) || !Number.isSafeInteger(assignment.expiresAtEpochMs) || expectation.nowEpochMs >= assignment.expiresAtEpochMs)
	{
		return { outcome: "denied", reason: "expired" };
	}
	return { outcome: "trusted" };
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
 * (libs/backend/server/conversations/main/src/prisma-conversation-unit-of-work.ts), reached from
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
