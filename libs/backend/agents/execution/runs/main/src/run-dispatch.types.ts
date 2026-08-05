import type { AgentControllerRunAttemptAssignmentCommand, AgentControllerRunAttemptAssignmentResult, AgentControllerRunAttemptClaim, AgentControllerRunOutboxPruneResult, AgentControllerRunWorkloadRegistrationCommand, AgentControllerRunWorkloadRegistrationResult, AgentControllerRunWorkloadReleaseClaim } from "@opencrane/contracts";

import type { AttemptModelKeyIssuer } from "./attempt-model-key.types.js";

/** Stable database-authority outcomes returned to the private agent-controller adapter. */
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
	/** A poisoned release was durably failed instead of being returned. */
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
