import type { AgentRevisionId, AgentRun, AgentRunId, AgentServiceId, AgentServiceState, SiloId } from "@opencrane/models/agents";
import type { AgentRuntimeProjectedTokenAudience, ManagedAgentRuntimeProjectedTokenAudience } from "@opencrane/contracts";

/**
 * The audience a runtime's projected ServiceAccount token may carry: personal or managed.
 *
 * The two values never overlap, and the validator additionally requires the ServiceAccount name to
 * come from the matching class, so a personal runtime's token cannot be presented at the managed
 * boundary or the other way round.
 *
 * @see AgentRuntimeProjectedTokenAudience and ManagedAgentRuntimeProjectedTokenAudience in
 * `@opencrane/contracts`, which explain why the two audiences are kept apart.
 */
export type RunWorkloadProjectedTokenAudience = AgentRuntimeProjectedTokenAudience | ManagedAgentRuntimeProjectedTokenAudience;

/**
 * What a runtime Pod claims about itself when it asks the control plane for execution material.
 *
 * Every field is a claim, not a fact: the Pod presents this and the server compares it against
 * {@link RunWorkloadAssignmentExpectation}. The projected ServiceAccount only proves the Pod is
 * some runtime of that class — it does not prove which run or attempt the Pod is entitled to, which
 * is why the run, attempt, revision, silo, subject, Job UID, and Pod UID all have to be matched as
 * well.
 *
 * @see __ValidateRunWorkloadAssignment — the comparison this shape exists for.
 * @see docs/adr/0008-target-agent-contracts-and-workload-identity.md, "Workload identity", which
 * requires assignment admission to bind exactly this set of coordinates.
 */
export interface RunWorkloadAssignment
{
	/** The run this Pod says it is executing. */
	readonly runId: AgentRunId;
	/** The AgentService the run belongs to. It never changes for the life of the run. */
	readonly agentServiceId: AgentServiceId;
	/** Which attempt of that run. Must be a whole number of 1 or more; a retry raises it. */
	readonly attempt: number;
	/** The agent revision this attempt executes. Frozen when the attempt started, so a later rollover cannot change what is running. */
	readonly agentRevisionId: AgentRevisionId;
	/** Silo containing the run and workload. */
	readonly siloId: SiloId;
	/** Audience on the projected token, which also decides which ServiceAccount names are acceptable. */
	readonly audience: RunWorkloadProjectedTokenAudience;
	/** The person or service on whose behalf the run executes; carried so the runtime cannot act for anyone else. */
	readonly subjectId: string;
	/** Kubernetes ServiceAccount the projected token was issued to. */
	readonly serviceAccountName: string;
	/** Namespace the runtime Job lives in. */
	readonly namespace: string;
	/** Always `job`: `agent-controller` creates one Job per attempt, and no other kind is accepted. */
	readonly workloadKind: "job";
	/** UID of that Job. Kubernetes never reuses a UID, so it ties the claim to one attempt's Job and not merely to a name that could be recreated. */
	readonly workloadUid: string;
	/** UID of the Pod making the request, for the same reason as the Job UID. */
	readonly podUid: string;
	/**
	 * When this assignment stops being usable, in epoch milliseconds. Trust is refused at or after
	 * this instant even when every other field matches, so a claim replayed later fails.
	 */
	readonly expiresAtEpochMs: number;
}

/**
 * What the control plane already knows to be true, which a presented {@link RunWorkloadAssignment}
 * must match field for field.
 *
 * Read from the server's own records and the trusted clock, never from the request, so it is the
 * side of the comparison that decides. Every field here has a counterpart on the assignment except
 * `nowEpochMs`, which is checked against the assignment's expiry instead.
 */
export interface RunWorkloadAssignmentExpectation
{
	/** The run the server believes this Pod was created for. */
	readonly runId: AgentRunId;
	/** The AgentService recorded on that run. */
	readonly agentServiceId: AgentServiceId;
	/** The attempt the run is currently on. A Pod left over from an earlier attempt fails here. */
	readonly attempt: number;
	/** The agent revision recorded for this attempt. */
	readonly agentRevisionId: AgentRevisionId;
	/** Silo the run belongs to. */
	readonly siloId: SiloId;
	/** Audience the server issued the projected token for. */
	readonly audience: RunWorkloadProjectedTokenAudience;
	/** Subject the run executes for. */
	readonly subjectId: string;
	/** ServiceAccount the controller gave this attempt's Job. */
	readonly serviceAccountName: string;
	/** Namespace the controller created that Job in. */
	readonly namespace: string;
	/** Always `job`, matching the assignment. */
	readonly workloadKind: "job";
	/** UID of the Job the controller created for this attempt. */
	readonly workloadUid: string;
	/** UID of the Pod the server expects the request from. */
	readonly podUid: string;
	/** Current time from the server's clock, compared against the assignment's expiry. Passed in rather than read inside the validator so the expiry case is testable. */
	readonly nowEpochMs: number;
}

/**
 * Whether a runtime Pod's claim was accepted, and if not, which check stopped it.
 *
 * `trusted` is the only value that lets the caller hand over execution material; every `denied`
 * reason means hand over nothing. The reasons exist for logs and tests, not for the runtime — the
 * Pod should learn only that it was refused, since telling it which field mismatched would let it
 * probe for the right values one field at a time.
 *
 * The reasons fall into three groups, in the order the validator checks them. `invalid_assignment`,
 * `invalid_attempt`, and `invalid_workload_kind` mean the claim was malformed — a blank identifier,
 * an attempt that is not a whole number of 1 or more, or a workload kind other than `job` — and no
 * amount of agreement between the two sides can rescue that. The `*_mismatch` reasons name the one
 * field that disagreed, and `projected_token_audience_mismatch` also covers an audience and
 * ServiceAccount name that belong to different runtime classes even when both sides agree, so a
 * consistent-looking pair from the wrong class is still refused. `expired` means everything matched
 * but the assignment's moment has passed, which is the fail-closed case for a replayed claim.
 *
 * Nothing here is persisted or returned over HTTP, so a reason can be renamed without a migration.
 */
export type RunWorkloadAssignmentDecision =
	| { readonly outcome: "trusted" }
	| { readonly outcome: "denied"; readonly reason: "invalid_assignment" | "invalid_attempt" | "invalid_workload_kind" | "projected_token_audience_mismatch" | "run_mismatch" | "agent_service_mismatch" | "attempt_mismatch" | "revision_mismatch" | "silo_mismatch" | "subject_mismatch" | "service_account_mismatch" | "namespace_mismatch" | "workload_kind_mismatch" | "workload_uid_mismatch" | "pod_mismatch" | "expired" };

/**
 * A participant's request to run one failed or cancelled run again.
 *
 * A retry does not create a second run. It raises the attempt counter on the run that is already
 * there, so the conversation keeps one run to point at however many times it is retried. The
 * caller states which attempt it saw; if the run has moved on since, the retry is refused rather
 * than applied to a state the user never looked at.
 *
 * Built by: `PrismaConversationUnitOfWork.retryRun`, from the session caller and the
 * `POST /me/conversations/{id}/runs/{runId}/retry` body.
 */
export interface StartNextRunAttemptCommand
{
	/** The run to retry. */
	readonly runId: AgentRunId;
	/**
	 * The attempt number the participant was looking at when they pressed retry. The write only
	 * applies while the run is still on this attempt, so two people retrying at once cannot both
	 * increment it.
	 */
	readonly expectedAttempt: number;
	/** Silo resolved from the authenticated request host, not from the body. */
	readonly siloId: SiloId;
	/** The conversation the run must belong to. Checked against the run row, so a participant of one conversation cannot retry a run from another. */
	readonly conversationId: string;
	/** The authenticated subject asking. Must still be an active org member and a current participant when the write happens. */
	readonly requestedBy: string;
	/**
	 * The client's retry key. Sending the same key again returns the attempt it already started
	 * rather than starting a third; a different key against an already-advanced run is a conflict.
	 */
	readonly idempotencyKey: string;
	/** ISO-8601 instant from the server's clock, stored as the new attempt's `acceptedAt` and as when its outbox event becomes available. */
	readonly acceptedAt: string;
}

/**
 * The run and its AgentService, read together so both describe the same moment.
 *
 * Reading them separately would let the service change in between, and the retry decision depends
 * on facts from both. The three service fields are null when the AgentService referenced by the run
 * no longer exists, which the domain treats the same as it being unusable.
 */
export interface AgentRunAuthoritySnapshot
{
	/** The run row as stored, including the attempt it is on and whether it reached a terminal state. */
	readonly run: AgentRun;
	/** Which silo the referenced AgentService is in, or null when it no longer exists. Compared with the run's own silo, since the two can disagree. */
	readonly agentServiceSiloId: SiloId | null;
	/** Where that AgentService is in its lifecycle, or null when it no longer exists. Only `active` permits a retry. */
	readonly agentServiceState: AgentServiceState | null;
	/** The revision that service would run now, or null when it has none. A value different from the run's own revision means the Agent has changed since. */
	readonly activeAgentRevisionId: AgentRevisionId | null;
}

/**
 * The retry request plus every AgentService fact the domain checked, repeated so the database can
 * check them again while it writes.
 *
 * The domain's read is only advisory — the service could retire or roll its revision between that
 * read and the write. Passing the observed values down means the update can be made conditional on
 * them, so a change in between makes the write apply to nothing instead of starting an attempt
 * against a service that is no longer allowed to run. The two tests
 * "denies retry when the AgentService retires during the atomic command" and "denies retry when the
 * active revision rolls over during the atomic command" cover exactly that window.
 */
export interface AtomicStartNextRunAttemptCommand extends StartNextRunAttemptCommand
{
	/** The AgentService recorded on the run when the domain read it. It cannot change on a run, so a difference here means the wrong run was found. */
	readonly expectedAgentServiceId: AgentServiceId;
	/** Silo that service was in. Kept separate from the run's silo so a service moving between silos cannot carry a retry with it. */
	readonly expectedAgentServiceSiloId: SiloId;
	/** Always `active`: a retry may only start while the service can execute, and the literal keeps any other state from being requested. */
	readonly expectedAgentServiceState: "active";
	/** The revision that was active then. The new attempt must run the same revision the run already names, so a retry never quietly upgrades the agent. */
	readonly expectedActiveAgentRevisionId: AgentRevisionId;
}

/**
 * What the database did with a retry, reported from inside the write transaction.
 *
 * These values stay inside the package and no caller sees them: `__StartNextRunAttempt` translates
 * every value into a {@link StartNextRunAttemptResult}. It is kept separate because the two answer
 * different questions — this one says what the write found, and the domain one says what the
 * participant should be told.
 *
 * Only `started` means an attempt was created and an outbox event written. `idempotent` also means
 * an attempt exists, but this call did not create it. The remaining three wrote nothing at all, so a
 * caller must never report progress on them.
 */
export type AtomicRunAttemptResult =
	/** The conditional update matched, the attempt is now one higher, the run is back in `Accepted`, and a `RunAttemptRequested` outbox event was written in the same transaction. */
	| { readonly status: "started"; readonly run: AgentRun }
	/** This same retry key already started the next attempt, proved by the stored outbox payload, so nothing was written. `run` is the already-advanced run and is safe to show as success. */
	| { readonly status: "idempotent"; readonly run: AgentRun }
	/** The run is no longer on the attempt the caller observed, and the advance was not this caller's. `currentAttempt` is where it actually is, so the caller can re-read and offer retry again. */
	| { readonly status: "attempt_conflict"; readonly currentAttempt: number }
	/** The run's AgentService is not the active, same-silo, same-revision service the retry required. The three `current*` fields say what it is now, which is what lets the domain pick between the inactive, silo, and superseded reasons. Any of them may be null when the service no longer exists. */
	| { readonly status: "agent_service_authority_conflict"; readonly currentAgentServiceState: AgentServiceState | null; readonly currentAgentServiceSiloId: SiloId | null; readonly currentActiveAgentRevisionId: AgentRevisionId | null }
	/** The requester is not a current org member and participant, or the run is not in the named conversation and silo. Returned before anything is read or written, and deliberately says nothing about whether the run exists. */
	| { readonly status: "unauthorized" }
	/** No run row with that id. Also returned if the row disappears between the update and the re-read, which is why it is not simply an initial check. */
	| { readonly status: "not_found" };

/**
 * The database operations a retry needs, kept behind a port so the retry rules can be tested
 * without Postgres.
 *
 * The whole point of this boundary is that one AgentRun row survives being retried: no method here
 * creates a run, and the only write raises the attempt counter on a row that already exists.
 *
 * Called by: `__StartNextRunAttempt` in run-authority.ts — the only production caller.
 * Implemented by: {@link PrismaAgentRunAuthorityRepository} in prisma-run-authority.ts, and by an
 * in-memory fake in `__tests__/run-authority.test.ts`.
 */
export interface AgentRunAuthorityRepository
{
	/**
	 * Read the run and the AgentService it points at, as they are at one moment.
	 *
	 * @param runId - The run to read.
	 * @returns The snapshot, or null when no such run exists. Advisory only: everything it reports
	 * can change before the write, which is why the write re-checks it.
	 * @throws When the database is unreachable.
	 */
	getRunAuthority(runId: AgentRunId): Promise<AgentRunAuthoritySnapshot | null>;
	/**
	 * Raise the attempt counter, but only while the run and its service still look the way the
	 * caller observed them.
	 *
	 * @param command - The retry plus the observed run and service coordinates to write against.
	 * @returns One {@link AtomicRunAttemptResult}. Only `started` and `idempotent` mean an attempt
	 * exists; the other three mean nothing was written.
	 * @throws When the database is unreachable or the transaction is rolled back.
	 */
	startNextAttemptAtomically(command: AtomicStartNextRunAttemptCommand): Promise<AtomicRunAttemptResult>;
}

/**
 * Adds the committed-winner read needed after the retry unit of work exhausts database conflicts.
 *
 * Called by: `PrismaAgentRunRetryUnitOfWork` after its third P2002 or P2034 rollback.
 * Implemented by: `PrismaAgentRunAuthorityRepository` on a fresh transaction.
 */
export interface AgentRunRetryTransactionRepository extends AgentRunAuthorityRepository
{
	/**
	 * Checks whether the requested next attempt committed in another transaction.
	 * @param command - Original owner-bound retry request.
	 * @returns The idempotent winner, an authority or attempt denial, or null when no matching next
	 * attempt committed.
	 */
	readRetryWinner(command: StartNextRunAttemptCommand): Promise<StartNextRunAttemptResult | null>;
}

/**
 * Runs one participant-authorized retry without exposing persistence to conversation composition.
 *
 * The conversation package supplies browser and route coordinates, then this authority owns domain
 * validation, transaction retries, and the final committed-winner read.
 *
 * Called by: `PrismaConversationUnitOfWork.retryRun` through constructor injection.
 * Implemented by: `PrismaAgentRunRetryUnitOfWork`.
 */
export interface RunRetryAuthority
{
	/**
	 * Starts or replays the next attempt of an existing run.
	 * @param command - Run, observed attempt, signed-in owner, route, retry key, and server time.
	 * @returns The user-facing retry outcome.
	 */
	retry(command: StartNextRunAttemptCommand): Promise<StartNextRunAttemptResult>;
}

/**
 * What to tell the participant who asked to retry a run.
 *
 * Two of these are successes and differ only in who started the attempt: `started` means this
 * request did, `idempotent` means an earlier request with the same key already had. Both carry the
 * run at its new attempt, so a client can render either the same way — and both `outcome` strings
 * appear in the published OpenAPI schema for `POST /me/conversations/{id}/runs/{runId}/retry`
 * (201 and 200), so renaming one breaks API clients.
 *
 * A `denied` result means nothing changed and the run is still where it was. The reason decides the
 * status code in `_runRetryDenialStatus` (self-conversations.router.ts), and it is sent to the
 * client as the `error` field. `run_not_found` and `unauthorized` both answer 404 on purpose, so a
 * participant cannot learn whether a run they may not see exists. `invalid_command` answers 400 —
 * the request was malformed and resending it unchanged will fail again. Every other reason answers
 * 409 and is worth re-reading the conversation for: `run_not_terminal` means the run is still going
 * or already succeeded, `attempt_conflict` means somebody or something else moved it on and
 * `currentAttempt` says where to, `agent_service_inactive` and `agent_service_silo_mismatch` mean
 * the Agent behind the run can no longer execute here, and `agent_revision_superseded` means the
 * Agent has been changed since the run started, so this run cannot be retried again — the active
 * revision will not go back to the one it names.
 *
 * None of these values are stored in the database.
 */
export type StartNextRunAttemptResult =
	| { readonly outcome: "started"; readonly run: AgentRun }
	| { readonly outcome: "idempotent"; readonly run: AgentRun }
	| { readonly outcome: "denied"; readonly reason: "invalid_command" | "unauthorized" | "run_not_found" | "run_not_terminal" | "agent_service_inactive" | "agent_service_silo_mismatch" | "agent_revision_superseded" | "attempt_conflict"; readonly currentAttempt?: number };
