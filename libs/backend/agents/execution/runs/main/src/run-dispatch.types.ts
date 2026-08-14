import type { AgentControllerRunAttemptAssignmentCommand, AgentControllerRunAttemptAssignmentResult, AgentControllerRunAttemptClaim, AgentControllerRunOutboxPruneResult, AgentControllerRunWorkloadRegistrationCommand, AgentControllerRunWorkloadRegistrationResult, AgentControllerRunWorkloadReleaseClaim } from "@opencrane/contracts";

import type { AttemptModelKeyIssuer } from "./attempt-model-key.types";

/**
 * What the database layer tells the agent controller to do next.
 *
 * The controller does not decide anything. It polls the internal dispatch API, and every call
 * comes back with one of these statuses; the status is the instruction. `Claimed` means work is
 * yours for the length of the lease — act on it, then report back. `None` means idle: sleep and
 * poll again, do not treat it as an error. `Committed` and `Registered` confirm your report was
 * accepted. `Conflict` means the database no longer agrees with what you sent — drop the work
 * and poll again; never retry the same body, because another controller replica has almost
 * certainly taken over. `Terminalized` is the one status that is not about your work at all: a
 * row that can never succeed was failed on your behalf so the queue can move on, so poll again
 * immediately rather than backing off.
 *
 * @see RunDispatchRepository for the method that returns each status.
 */
export enum RunDispatchResultStatuses
{
	/** A fresh database-fenced command is ready for the controller. */
	Claimed = "claimed",
	/** No eligible work is currently available. */
	None = "none",
	/** The exact assignment command was committed. */
	Committed = "committed",
	/** The submitted command did not match current durable authority. */
	Conflict = "conflict",
	/** A release row that can never succeed was marked failed instead of being handed out again. */
	Terminalized = "terminalized",
	/** The exact first worker Pod was registered. */
	Registered = "registered",
}

/** Fixed database-owned lease and assignment policy for run dispatch. */
export interface RunDispatchRepositoryConfig
{
	/** Dedicated namespace containing personal runtime Jobs and no server workload. */
	readonly personalRuntimeNamespace: string;
	/** Dedicated namespace containing managed runtime Jobs and no personal workload identity. */
	readonly managedRuntimeNamespace: string;
	/** Time after which an uncommitted outbox claim may be reclaimed. */
	readonly claimLeaseMilliseconds: number;
	/** Hard lifetime persisted on a newly assigned runtime workload. */
	readonly assignmentTtlMilliseconds: number;
	/** Age after which a successfully delivered outbox command is no longer operational state. */
	readonly publishedOutboxRetentionMilliseconds?: number;
	/** Maximum delivered records deleted by one controller maintenance transaction. */
	readonly outboxPruneBatchSize?: number;
}

/** Outcome of claiming the next eligible runtime attempt. */
export type ClaimNextRunAttemptResult =
	| { readonly status: RunDispatchResultStatuses.Claimed; readonly claim: AgentControllerRunAttemptClaim }
	| { readonly status: RunDispatchResultStatuses.None };

/** Outcome of committing a suspended Job as the current attempt assignment. */
export type CommitRunAttemptAssignmentResult =
	| { readonly status: RunDispatchResultStatuses.Committed; readonly result: AgentControllerRunAttemptAssignmentResult }
	| { readonly status: RunDispatchResultStatuses.Conflict; readonly reason: "claim_not_found" | "stale_claim" | "claim_terminal" | "attempt_conflict" | "authority_conflict" | "assignment_conflict" | "invalid_assignment" };

/** Outcome of claiming the next eligible suspended workload release. */
export type ClaimNextRunWorkloadReleaseResult =
	| { readonly status: RunDispatchResultStatuses.Claimed; readonly claim: AgentControllerRunWorkloadReleaseClaim }
	| { readonly status: RunDispatchResultStatuses.Terminalized; readonly eventId: string; readonly runId: string; readonly attempt: number; readonly failureCode: string }
	| { readonly status: RunDispatchResultStatuses.None };

/** Outcome of atomically registering the first Pod and publishing its release command. */
export type RegisterRunWorkloadPodResult =
	| { readonly status: RunDispatchResultStatuses.Registered; readonly result: AgentControllerRunWorkloadRegistrationResult }
	| { readonly status: RunDispatchResultStatuses.Conflict; readonly reason: "claim_not_found" | "stale_claim" | "claim_terminal" | "attempt_conflict" | "authority_conflict" | "assignment_conflict" | "pod_conflict" | "invalid_registration" };

/**
 * Every database operation the agent controller is allowed to perform.
 *
 * This is the complete surface between the Kubernetes controller and OpenCrane's run state: the
 * controller creates and releases Jobs, but it never decides whether it may. Each method takes
 * or renews a database-held claim, and the claim is what fences a controller replica whose lease
 * has expired out of publishing stale work.
 *
 * Every method ends in `Atomically` because each one commits its whole effect — claim, rows, run
 * state and outbox publication — in a single transaction. A caller must never split one of these
 * into several calls and must never treat a partial success as possible: either the returned
 * status happened completely, or nothing did.
 *
 * Called by: `run-dispatch.router.ts` (the controller-only HTTP adapter). Implemented by
 * `PrismaRunDispatchRepository`, which `apps/opencrane/src/app/runtime-composition.ts` constructs.
 *
 * @see RunDispatchResultStatuses for what each returned status obliges the controller to do.
 */
export interface RunDispatchRepository
{
	/**
	 * Takes the next run attempt that is waiting to be dispatched, and mints its model key.
	 *
	 * The claim is held by a database lease, so exactly one controller replica gets each attempt.
	 * The model key is minted after the transaction commits, so no external call ever holds a
	 * database lock.
	 *
	 * @returns `claimed` with the lease and the attempt, including a short-lived model key that
	 * exists only in this response and is never stored — pass it to the Job and do not log it.
	 * `none` means nothing is waiting; sleep and poll again.
	 * @throws When the model-key issuer returns no key, after the claim has already committed; the
	 * claim's lease will expire and the attempt becomes claimable again.
	 */
	claimNextAttemptAtomically(): Promise<ClaimNextRunAttemptResult>;
	/**
	 * Records the suspended Job the controller just created as this attempt's assignment.
	 *
	 * Call this only after the Job exists in Kubernetes. The write is accepted only while the claim
	 * is still the current one and its lease has not expired, which is what stops a slow replica
	 * from binding a Job that a newer replica has already superseded.
	 *
	 * @param eventId - The outbox event id from the claim you are reporting against.
	 * @param command - The created Job's UID and identity fields, exactly as Kubernetes returned them.
	 * @returns `committed` means the assignment is durable and the run has advanced to Assigned, so
	 * you may go on to release the Job. `conflict` means your claim is no longer current — delete
	 * nothing, report nothing further, and poll again; another replica owns this attempt.
	 */
	commitSuspendedJobAssignmentAtomically(eventId: string, command: AgentControllerRunAttemptAssignmentCommand): Promise<CommitRunAttemptAssignmentResult>;
	/**
	 * Takes the next committed assignment whose Job is ready to be unsuspended.
	 *
	 * @returns `claimed` with the assignment to unsuspend, under a fresh lease. `none` means nothing
	 * is ready; sleep and poll again. `terminalized` means the row at the head of the queue could
	 * never succeed and was failed for you — nothing is yours to do, so poll again straight away
	 * instead of backing off.
	 */
	claimNextWorkloadReleaseAtomically(): Promise<ClaimNextRunWorkloadReleaseResult>;
	/**
	 * Records the first Pod that appeared for this attempt, and publishes the release command.
	 *
	 * Only the first Pod is ever accepted. A second, different Pod for the same attempt is a
	 * permanent conflict, never a retry: it means two workloads exist for one run attempt.
	 *
	 * @param eventId - The outbox event id from the release claim you are reporting against.
	 * @param command - The observed Pod's UID and the identity fields that must match the assignment.
	 * @returns `registered` means this Pod is now the attempt's runtime and the release has been
	 * published. `conflict` means either your claim is stale — poll again — or a different Pod is
	 * already registered, which no amount of retrying will fix and needs an operator.
	 */
	registerFirstPodAndPublishReleaseAtomically(eventId: string, command: AgentControllerRunWorkloadRegistrationCommand): Promise<RegisterRunWorkloadPodResult>;
	/**
	 * Deletes one batch of old outbox rows that were delivered successfully.
	 *
	 * Housekeeping only: failed rows are never deleted, because they are the evidence of what went
	 * wrong. Call it on a schedule; one call deletes at most one batch, so a large backlog needs
	 * several passes.
	 *
	 * @returns How many rows were deleted, so a scheduler can decide whether to run again.
	 */
	prunePublishedOutboxEventsAtomically(): Promise<AgentControllerRunOutboxPruneResult>;
}

/** TokenReview-confirmed identity of an in-cluster workload. */
export interface ReviewedAgentControllerIdentity
{
	/** Exact Kubernetes username returned by TokenReview. */
	readonly username: string;
	/** Kubernetes namespace returned by the reviewed ServiceAccount subject. */
	readonly namespace: string;
	/** Kubernetes ServiceAccount name returned by TokenReview. */
	readonly serviceAccountName: string;
	/** Audiences accepted by the Kubernetes API server. */
	readonly audiences: readonly string[];
}

/** Projected-token reviewer supplied by the OpenCrane process boundary. */
export interface AgentControllerTokenReviewer
{
	/** Reviews one token against the dedicated agent-controller audience. */
	__Review(token: string): Promise<ReviewedAgentControllerIdentity | null>;
}

/** Minimal structured logger surface required by the dispatch HTTP boundary. */
export interface AgentControllerRunDispatchLogger
{
	/** Records a failed internal operation without serialising credentials or request bodies. */
	error(bindings: { readonly err: unknown; readonly operation: string }, message: string): void;
	/** Records a committed fail-closed repair without serialising bootstrap or credential material. */
	warn(bindings: { readonly eventId: string; readonly runId: string; readonly attempt: number; readonly failureCode: string }, message: string): void;
}

/** Dependencies of the controller-only run-dispatch HTTP adapter. */
export interface AgentControllerRunDispatchRouterDependencies
{
	/** Dedicated projected-token identity reviewer. */
	readonly tokenReviewer: AgentControllerTokenReviewer;
	/** Exact namespace in which the controller ServiceAccount must exist. */
	readonly namespace: string;
	/** Run and outbox authority. */
	readonly repository: RunDispatchRepository;
	/** Shared process logger carrying request and trace context. */
	readonly logger: AgentControllerRunDispatchLogger;
}

/** Ids read without locking, used only to work out which rows to lock and in what order. */
export interface RunOutboxCandidateRow
{
	/** Outbox event identifier. */
	readonly eventId: string;
	/** Logical run identifier. */
	readonly runId: string;
	/** Service authority that must be locked before the run and outbox row. */
	readonly agentServiceId: string;
}

/** Ids for a release row, read without locking, used only to work out which rows to lock and in what order. */
export interface RunWorkloadReleaseCandidateRow extends RunOutboxCandidateRow
{
	/** Positive attempt number used to lock the exact assignment. */
	readonly attempt: number;
	/** Opaque bootstrap reference identifying the exact assignment integrity row. */
	readonly bootstrapReference: string;
}
