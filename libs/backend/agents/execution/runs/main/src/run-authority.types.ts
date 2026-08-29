import type { AgentRevisionId, AgentRun, AgentRunId, AgentServiceId, AgentServiceState, SiloId } from "@opencrane/models/agents";

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
	/** ISO-8601 instant from the server's clock, stored as the new attempt's `acceptedAt`. */
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
 * Only `started` means an attempt was created and its workflow task was admitted. `idempotent` also means
 * an attempt exists, but this call did not create it. The remaining three wrote nothing at all, so a
 * caller must never report progress on them.
 */
export type AtomicRunAttemptResult =
	/** The conditional update matched, the attempt is now one higher, the run is back in `Accepted`, and its durable workflow task was admitted in the same transaction. */
	| { readonly status: "started"; readonly run: AgentRun }
	/** The next attempt already owns its deterministic workflow task, so nothing was written. `run` is the already-advanced run and is safe to show as success. */
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
	 * @param command - Run, observed attempt, signed-in owner, route, and server time.
	 * @returns The user-facing retry outcome.
	 */
	retry(command: StartNextRunAttemptCommand): Promise<StartNextRunAttemptResult>;
}

/**
 * What to tell the participant who asked to retry a run.
 *
 * Two of these are successes and differ only in who started the attempt: `started` means this
 * request did, `idempotent` means an earlier request already started the next attempt. Both carry the
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
