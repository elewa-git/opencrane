import type { McpCompanionClaimResponse, McpCompanionCompletionRequest, McpCompanionFailureRequest } from "@opencrane/backend/agents/runtime/mcp-executor/companion";
import type { RuntimeWorkloadBinding, RuntimeWorkloadClaim } from "@opencrane/backend/agents/runtime/workloads/contract";
import type { FixedServiceAccountTokenReviewer, RuntimeWorkloadIdentity } from "@opencrane/backend/server/infra/workload-identity";
import type { McpToolInvocationTransactionParticipantFactory } from "@opencrane/backend/server/iam/authorization";
import type { Logger } from "@opencrane/backend/observability";

/**
 * Names the operation admitted into a saved MCP runtime execution.
 *
 * The catalogue writes the matching Prisma enum and logs this value after admission. Keep these
 * strings aligned with `McpRuntimeExecutionKind`; unknown kinds are not admitted.
 */
export enum McpRuntimeExecutionKinds
{
	/** Discover the pinned server and freeze its live tool schemas. */
	Discovery = "discovery",
	/** Invoke one already-prepared and approved ToolInvocation. */
	Invocation = "invocation",
}

/**
 * Tells the Pod-facing route that authorization ended the saved invocation before dispatch.
 *
 * The router maps this closed in-memory outcome to HTTP 410, which makes the companion stop polling
 * without treating cancellation or another terminal ToolInvocation state as a transport failure.
 */
export enum McpRuntimeCompanionClaimOutcomes
{
	/** The companion must stop polling because no command can become available. */
	Terminal = "terminal",
}

/**
 * Reports what a controller write changed after the server checks its saved delivery fence.
 *
 * `assigned`, `released`, `registered`, and `cleaned` name the new write. `idempotent` means the
 * same transition already committed. `conflict` means the UID, delivery, state, or lease changed,
 * so the controller must not report the requested transition as complete.
 */
export type McpRuntimeControllerWriteOutcome = "assigned" | "released" | "registered" | "cleaned" | "idempotent" | "conflict";

/** Bounded administrator input that promotes one imported image into a draft server revision. */
export interface McpOciServerPromotionCommand
{
	/** Silo-derived display name, unique inside the catalogue. */
	readonly name: string;
	/** Human-readable catalogue description. */
	readonly description: string;
}

/** Authenticated administrator coordinates used by the promotion authority. */
export interface McpOciServerPromotionCaller
{
	/** Silo derived from the authenticated browser request. */
	readonly siloId: string;
	/** Local Principal that performed the promotion. */
	readonly principalId: string;
}

/** Result of promoting an imported OCI validation into discovery work. */
export type McpOciServerPromotionResult =
	| { readonly outcome: "created" | "idempotent"; readonly serverId: string; readonly serverRevisionId: string; readonly executionId: string }
	| { readonly outcome: "not_found" | "not_imported" | "conflict" };

/** Controller projection for one database-issued MCP workload claim. */
export interface McpRuntimeControllerClaim
{
	/** Class-neutral claim fields consumed by the controller. */
	readonly claim: RuntimeWorkloadClaim;
	/** Immutable image selected by completed OCI admission. */
	readonly registryReference: string;
}

/** Controller projection that also carries the current release fence. */
export interface McpRuntimeControllerReleaseClaim extends McpRuntimeControllerClaim
{
	readonly workloadUid: string;
	readonly releaseClaimedAt: string;
	readonly releaseDeliveryCount: number;
	readonly releaseExpiresAt: string;
}

/**
 * Projects a terminal execution whose Kubernetes Job may still exist.
 *
 * The controller deletes `workloadUid`, then returns the cleanup time and delivery count so the
 * server can reject an expired or replaced cleanup claim.
 * The server does not send an expiry because deleting the saved UID is safe to repeat. A late
 * commit conflicts, and a later claim confirms the already-absent Job before committing cleanup.
 *
 * Called by: {@link McpRuntimeAuthority.claimNextCleanup} and the agent controller's HTTP adapter.
 */
export interface McpRuntimeControllerCleanupClaim extends McpRuntimeControllerClaim
{
	/** Immutable UID Kubernetes assigned to the Job being deleted. */
	readonly workloadUid: string;
	/** Database time that identifies this cleanup delivery. */
	readonly cleanupClaimedAt: string;
	/** Delivery generation that fences this cleanup. */
	readonly cleanupDeliveryCount: number;
}

/** Release evidence accepted only for the current delivery and Job UID. */
export interface McpRuntimeReleaseCommand
{
	readonly releaseClaimedAt: string;
	readonly releaseDeliveryCount: number;
	readonly workloadUid: string;
}

/**
 * Reports which Kubernetes Job UID a cleanup delivery deleted.
 *
 * All fields must match the current saved cleanup claim before the server records completion.
 * Release carries an expiry because it makes a Job runnable; cleanup cannot do that and omits it.
 */
export interface McpRuntimeCleanupCommand
{
	/** Database time of the claimed cleanup delivery. */
	readonly cleanupClaimedAt: string;
	/** Generation of the claimed cleanup delivery. */
	readonly cleanupDeliveryCount: number;
	/** Immutable Job UID deleted by the controller. */
	readonly workloadUid: string;
}

/** First-Pod evidence accepted only while the matching release fence remains current. */
export interface McpRuntimePodRegistrationCommand extends McpRuntimeReleaseCommand
{
	readonly podUid: string;
}

/**
 * Moves OCI-backed MCP catalogue, Kubernetes, companion, and ToolInvocation state in database transactions.
 *
 * The promotion router, controller router, companion router, external-action worker, and recovery
 * loop share this port. Implementations must keep MCP rows and authorization-owned ToolInvocation
 * changes in one transaction, return `conflict` for stale fences, and never perform network I/O in
 * that transaction.
 */
export interface McpRuntimeAuthority
{
	/** Promote an imported validation into a draft server revision and its discovery execution. */
	promoteImportedValidation(caller: McpOciServerPromotionCaller, validationId: string, command: McpOciServerPromotionCommand): Promise<McpOciServerPromotionResult>;
	/** Admit an authorization-owned invocation only when its saved MCP tool revision is ready. */
	admitInvocation(toolInvocationRowId: string): Promise<"admitted" | "idempotent" | "not_ready" | "not_mcp">;
	/** Claim pending work for the class-specific controller without letting it choose an image. */
	claimNextController(): Promise<McpRuntimeControllerClaim | null>;
	/** Save the suspended Job UID under the assignment claim fence. */
	commitAssignment(binding: RuntimeWorkloadBinding): Promise<McpRuntimeControllerWriteOutcome>;
	/** Claim an assigned or released Job for release and first-Pod registration. */
	claimNextRelease(): Promise<McpRuntimeControllerReleaseClaim | null>;
	/** Return one terminal execution with cleanup owed, or `null` when no cleanup delivery is ready. */
	claimNextCleanup(): Promise<McpRuntimeControllerCleanupClaim | null>;
	/** Save the Kubernetes release under the matching delivery and Job UID. */
	commitRelease(claimId: string, command: McpRuntimeReleaseCommand): Promise<McpRuntimeControllerWriteOutcome>;
	/** Return `cleaned`, `idempotent`, or `conflict` after checking the cleanup delivery and Job UID. */
	commitCleanup(claimId: string, command: McpRuntimeCleanupCommand): Promise<McpRuntimeControllerWriteOutcome>;
	/** Bind the first owned Pod UID while the release fence remains current. */
	registerFirstPod(claimId: string, command: McpRuntimePodRegistrationCommand): Promise<McpRuntimeControllerWriteOutcome>;
	/** Move one invocation whose companion lease expired after dispatch into manual recovery. */
	recoverExpiredInvocation(): Promise<boolean>;
	/** Claim at most one command for the TokenReview-confirmed Pod and projected reference. */
	claimCompanion(identity: RuntimeWorkloadIdentity, executionReference: string): Promise<McpCompanionClaimResponse | McpRuntimeCompanionClaimOutcomes.Terminal | null>;
	/** Save a checked completion and all paired MCP or ToolInvocation state. */
	completeCompanion(identity: RuntimeWorkloadIdentity, request: McpCompanionCompletionRequest): Promise<"completed" | "idempotent" | "conflict">;
	/** Save definite discovery failure or move an uncertain invocation into manual recovery. */
	failCompanion(identity: RuntimeWorkloadIdentity, request: McpCompanionFailureRequest): Promise<"failed" | "idempotent" | "conflict">;
}

/** Fixed deployment policy used by the durable MCP runtime authority. */
export interface McpRuntimeAuthorityOptions
{
	readonly siloId: string;
	readonly executorNamespace: string;
	readonly executorServiceAccountName: string;
	readonly profileName: string;
	readonly controllerClaimLeaseMilliseconds: number;
	readonly companionClaimLeaseMilliseconds: number;
	readonly log: Logger;
}

/** Dependencies for the controller-only MCP runtime router. */
export interface McpRuntimeControllerRouterDependencies
{
	readonly authority: McpRuntimeAuthority;
	readonly tokenReviewer: FixedServiceAccountTokenReviewer;
	readonly serverNamespace: string;
	readonly logger: Logger;
}

/** Reviews one MCP companion token into its exact Pod-bound workload identity. */
export interface McpRuntimeCompanionTokenReviewer
{
	__Review(token: string): Promise<RuntimeWorkloadIdentity | null>;
}

/** Dependencies for the Pod-bound MCP companion router. */
export interface McpRuntimeCompanionRouterDependencies
{
	readonly authority: McpRuntimeAuthority;
	readonly tokenReviewer: McpRuntimeCompanionTokenReviewer;
	readonly logger: Logger;
}

/** Dependencies for the authenticated OCI-to-server promotion router. */
export interface McpOciServerPromotionRouterDependencies
{
	readonly authority: McpRuntimeAuthority;
	readonly resolveCaller: (request: import("express").Request) => Promise<McpOciServerPromotionCaller | null>;
	readonly logger: Logger;
}

/** Dependencies needed to build the database-backed MCP runtime authority. */
export interface PrismaMcpRuntimeAuthorityDependencies
{
	/** Authorization-owned participant factory bound to each MCP transaction. */
	readonly toolInvocations: McpToolInvocationTransactionParticipantFactory;
	/** Fixed deployment and lease policy for this silo. */
	readonly options: McpRuntimeAuthorityOptions;
}

/** Catalogue and invocation writes available inside one MCP runtime transaction. */
export interface McpRuntimeCatalogRepository
{
	/** Promote one imported validation into discovery work. */
	promoteImportedValidation(caller: McpOciServerPromotionCaller, validationId: string, command: McpOciServerPromotionCommand): Promise<McpOciServerPromotionResult>;
	/** Admit one ready authorization-owned invocation into MCP runtime work. */
	admitInvocation(toolInvocationRowId: string): Promise<"admitted" | "idempotent" | "not_ready" | "not_mcp">;
}

/** Controller claim and Kubernetes identity writes inside one MCP runtime transaction. */
export interface McpRuntimeControllerRepository
{
	/** Claim one pending MCP execution. */
	claimNext(): Promise<McpRuntimeControllerClaim | null>;
	/** Bind one Kubernetes Job to the current claim. */
	commitAssignment(binding: RuntimeWorkloadBinding): Promise<McpRuntimeControllerWriteOutcome>;
	/** Claim one assigned Job for release. */
	claimNextRelease(): Promise<McpRuntimeControllerReleaseClaim | null>;
	/** Return one terminal execution with a saved Job UID and an available cleanup delivery. */
	claimNextCleanup(): Promise<McpRuntimeControllerCleanupClaim | null>;
	/** Commit one exact Job release. */
	commitRelease(claimId: string, command: McpRuntimeReleaseCommand): Promise<McpRuntimeControllerWriteOutcome>;
	/** Record deletion only while the cleanup delivery, terminal state, and saved Job UID still match. */
	commitCleanup(claimId: string, command: McpRuntimeCleanupCommand): Promise<McpRuntimeControllerWriteOutcome>;
	/** Register the first Pod under the release fence. */
	registerFirstPod(claimId: string, command: McpRuntimePodRegistrationCommand): Promise<McpRuntimeControllerWriteOutcome>;
}

/** Pod-bound companion writes inside one MCP runtime transaction. */
export interface McpRuntimeCompanionRepository
{
	/** Claim at most one command for the authenticated Pod. */
	claim(identity: RuntimeWorkloadIdentity, executionReference: string): Promise<McpCompanionClaimResponse | McpRuntimeCompanionClaimOutcomes.Terminal | null>;
	/** Save one checked result and its paired authority state. */
	complete(identity: RuntimeWorkloadIdentity, request: McpCompanionCompletionRequest): Promise<"completed" | "idempotent" | "conflict">;
	/** Save one definite discovery failure or ambiguous invocation outcome. */
	fail(identity: RuntimeWorkloadIdentity, request: McpCompanionFailureRequest): Promise<"failed" | "idempotent" | "conflict">;
	/** Move one expired invocation claim into manual recovery. */
	recoverNextExpiredInvocation(): Promise<boolean>;
}
