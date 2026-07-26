import type { Prisma } from "@prisma/client";

import type { CompiledRunInput, CompiledToolDefinition, RunInputSnapshot, RuntimeExternalActionCandidate } from "@opencrane/contracts";

/**
 * Injected control-plane compiler that hydrates an immutable snapshot into the literal compiled
 * input carried on `start_attempt`.
 *
 * The dispatch authority calls it inside the same locked transaction that loads the snapshot, so it
 * reads only immutable records and must return byte-identical output for a given snapshot on every
 * mint and idempotent redelivery. The runtime treats the returned payload as opaque.
 */
export type RunInputCompiler = (snapshot: RunInputSnapshot, transaction: Prisma.TransactionClient) => Promise<CompiledRunInput>;

/** Fixed, server-owned policy for minting and expiring runtime command frames. */
export interface RuntimeDispatchAuthorityConfig
{
	/** Dedicated namespace containing this silo's untrusted runtime Pods and no server workload. */
	readonly namespace: string;
	/** Hard lifetime stamped on each minted command frame, bounded by the durable assignment lease. */
	readonly commandTtlMilliseconds: number;
	/** Maximum server-recorded pre-reservation retries for one external-action candidate. */
	readonly externalActionRetryLimit: number;
	/** Hard server-owned window in which one external-action candidate may use its retry budget. */
	readonly externalActionRetryWindowMilliseconds: number;
}

/** Verified workload identity handed to the dispatch authority by the app-owned transport. */
export interface RuntimeStreamWorkloadIdentity
{
	/** Kubernetes ServiceAccount subject returned by TokenReview. */
	readonly subject: string;
	/** Kubernetes namespace parsed from the authenticated subject. */
	readonly namespace: string;
	/** Kubernetes ServiceAccount name parsed from the authenticated subject. */
	readonly serviceAccountName: string;
	/** Kubernetes Pod UID asserted by TokenReview for this projected token. */
	readonly podUid: string;
}

/**
 * Composition-root port that reserves and dispatches an admitted external-action candidate.
 *
 * The dispatch authority admits the candidate against the live fence, then hands it to this injected
 * runner so the concrete MCP/artifact/memory/sandbox transports stay in the app root and never leak
 * into `scope:execution-protocol`. The runner performs reserve-before-dispatch via
 * `__ExecuteExternalAction`. It returns `"completed"` only after a durable invocation result exists,
 * returns `"denied"` for a durable fail-closed refusal, and throws only before reservation when the
 * runtime may safely replay the exact admitted candidate.
 */
export type RuntimeExternalActionRunnerResult =
	| { readonly outcome: "completed" | "denied" }
	| { readonly outcome: "retryable"; readonly error: unknown };

/**
 * Result from the composition root after attempting one admitted external action.
 *
 * `retryable` proves that no ToolInvocation reservation was created. Every outcome after a
 * reservation — including deferred-approval creation or executor persistence failures — is instead
 * `denied`, so an admitted candidate can never re-dispatch an already-reserved side effect.
 */
export interface RuntimeExternalActionRunner
{
	/** Reserve and dispatch one admitted external-action candidate against its validated tools. */
	run(candidate: RuntimeExternalActionCandidate, snapshot: RunInputSnapshot, compiledTools: readonly CompiledToolDefinition[]): Promise<RuntimeExternalActionRunnerResult>;
}

/** Stable result returned after a candidate reaches the authoritative run boundary. */
export interface RuntimeCandidateDispatchResult
{
	/** Whether the authority accepted this candidate or its idempotent replay. */
	readonly accepted: boolean;
	/** Machine-readable reason when the candidate was rejected. */
	readonly reason?: string;
	/** Whether the runtime must retry this exact candidate rather than terminalising its attempt. */
	readonly retryable?: boolean;
	/** Server-bounded delay before retrying the same candidate identifier. */
	readonly retryAfterMilliseconds?: number;
}
