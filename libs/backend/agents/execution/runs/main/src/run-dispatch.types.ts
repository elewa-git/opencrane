import type { AgentControllerRunAttemptAssignmentCommand, AgentControllerRunAttemptAssignmentResult, AgentControllerRunAttemptClaim, AgentControllerRunWorkloadRegistrationCommand, AgentControllerRunWorkloadRegistrationResult, AgentControllerRunWorkloadReleaseClaim } from "@opencrane/contracts";

/**
 * Request to mint one attempt-scoped model key at claim time.
 *
 * Built from the immutable snapshot's model route and budget policy plus the silo. The concrete
 * issuer lives in the app layer (the model-routing gateway holds the LiteLLM master key); this
 * library never imports it, so the runtime and its dispatch authority stay outbound-only.
 */
export interface AttemptModelKeyMintRequest
{
	/** Attempt- and delivery-unique key alias satisfying the issuer's `attempt-<...>` grammar. */
	readonly keyAlias: string;
	/** Single model alias the minted key may call, taken from the snapshot's model route. */
	readonly modelAlias: string;
	/** Silo whose per-silo model proxy issues the key. */
	readonly siloId: string;
	/** Hard aggregate spend ceiling in US dollars, derived from the snapshot's budget policy. */
	readonly maxBudgetUsd: number;
	/** Key lifetime in seconds, bounded to the attempt assignment lifetime. */
	readonly expirySeconds: number;
}

/** A minted attempt-scoped model key. Carries only the transient key value — never persisted. */
export interface MintedAttemptModelKey
{
	/** The short-lived virtual key the runtime presents to the model proxy; transient, never stored. */
	readonly key: string;
}

/**
 * Injected minting port bound by the app to the model-routing gateway.
 *
 * Keeping this a port means `scope:execution-runs` never depends on `scope:model-routing`: the master
 * key stays in the server process that already holds it, and the minted virtual key only rides the
 * claim response.
 */
export type AttemptModelKeyIssuer = (request: AttemptModelKeyMintRequest) => Promise<MintedAttemptModelKey>;

/** Fixed database-owned lease and assignment policy for run dispatch. */
export interface RunDispatchRepositoryConfig
{
	/** Dedicated namespace containing this silo's untrusted runtime Jobs and no server workload. */
	readonly namespace: string;
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
	| { readonly status: "claimed"; readonly claim: AgentControllerRunAttemptClaim }
	| { readonly status: "none" };

/** Outcome of committing a suspended Job as the current attempt assignment. */
export type CommitRunAttemptAssignmentResult =
	| { readonly status: "committed"; readonly result: AgentControllerRunAttemptAssignmentResult }
	| { readonly status: "conflict"; readonly reason: "claim_not_found" | "stale_claim" | "claim_terminal" | "attempt_conflict" | "authority_conflict" | "assignment_conflict" | "invalid_assignment" };

/** Outcome of claiming the next eligible suspended workload release. */
export type ClaimNextRunWorkloadReleaseResult =
	| { readonly status: "claimed"; readonly claim: AgentControllerRunWorkloadReleaseClaim }
	| { readonly status: "terminalized"; readonly eventId: string; readonly runId: string; readonly attempt: number; readonly failureCode: string }
	| { readonly status: "none" };

/** Outcome of atomically registering the first Pod and publishing its release command. */
export type RegisterRunWorkloadPodResult =
	| { readonly status: "registered"; readonly result: AgentControllerRunWorkloadRegistrationResult }
	| { readonly status: "conflict"; readonly reason: "claim_not_found" | "stale_claim" | "claim_terminal" | "attempt_conflict" | "authority_conflict" | "assignment_conflict" | "pod_conflict" | "invalid_registration" };

/** Bounded result of removing delivered, non-failed operational outbox records. */
export interface PrunePublishedRunOutboxResult
{
	/** Number of records removed in this maintenance transaction. */
	readonly deletedCount: number;
}

/** Run-owned persistence port used by the controller-only internal API. */
export interface RunDispatchRepository
{
	/** Claims one eligible RunAttemptRequested event or reports no current work. */
	claimNextAttemptAtomically(): Promise<ClaimNextRunAttemptResult>;
	/** Commits only the exact current claim and suspended Job UID as a PendingPod assignment. */
	commitSuspendedJobAssignmentAtomically(eventId: string, command: AgentControllerRunAttemptAssignmentCommand): Promise<CommitRunAttemptAssignmentResult>;
	/** Claims one exact PendingPod assignment that is ready to be unsuspended. */
	claimNextWorkloadReleaseAtomically(): Promise<ClaimNextRunWorkloadReleaseResult>;
	/** Registers only the first Pod for the exact current release claim and publishes that command. */
	registerFirstPodAndPublishReleaseAtomically(eventId: string, command: AgentControllerRunWorkloadRegistrationCommand): Promise<RegisterRunWorkloadPodResult>;
	/** Removes a bounded batch of retention-expired successfully delivered operational records. */
	prunePublishedOutboxEventsAtomically(): Promise<PrunePublishedRunOutboxResult>;
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

/** Non-locking candidate coordinates used only to establish canonical lock order. */
export interface RunOutboxCandidateRow
{
	/** Outbox event identifier. */
	readonly eventId: string;
	/** Logical run identifier. */
	readonly runId: string;
	/** Service authority that must be locked before the run and outbox row. */
	readonly agentServiceId: string;
}

/** Non-locking release candidate coordinates used only to establish canonical lock order. */
export interface RunWorkloadReleaseCandidateRow extends RunOutboxCandidateRow
{
	/** Positive attempt number used to lock the exact assignment. */
	readonly attempt: number;
	/** Opaque bootstrap reference identifying the exact assignment integrity row. */
	readonly bootstrapReference: string;
}
