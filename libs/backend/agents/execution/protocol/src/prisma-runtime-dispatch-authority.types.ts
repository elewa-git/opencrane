import type { Prisma, RuntimeCommandKind } from "@prisma/client";

import type { CompiledRunInput, RunInputSnapshot } from "@opencrane/contracts";
import type { JsonValue } from "@opencrane/util";

import type { RuntimeAdmissionRunState } from "./runtime-protocol-authority.types.js";

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
	/** Dedicated namespace containing personal runtime Pods and no server workload. */
	readonly personalRuntimeNamespace: string;
	/** Dedicated namespace containing managed runtime Pods and no personal workload identity. */
	readonly managedRuntimeNamespace: string;
	/** Hard lifetime stamped on each minted command frame, bounded by the durable assignment lease. */
	readonly commandTtlMilliseconds: number;
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

/** Terminal lifecycle persistence supplied by the composition root without reversing library dependencies. */
export interface RuntimeEventReporter
{
	/** Validate and persist an already-fenced canonical runtime event in the current transaction. */
	reportInTransaction(transaction: Prisma.TransactionClient, command: { readonly runId: string; readonly attempt: number; readonly eventType: string; readonly payload: JsonValue }): Promise<{ readonly outcome: "reported" | "denied"; readonly reason?: string }>;
}

/** Transaction-scoped expiry sweep supplied by the production approval authority. */
export interface RuntimeApprovalExpiry
{
	/** Close every due approval for one waiting attempt and report whether its batch resumed. */
	expireInTransaction(transaction: Prisma.TransactionClient, command: { readonly runId: string; readonly attempt: number; readonly now: Date }): Promise<{ readonly expiredCount: number; readonly resumed: boolean }>;
}

/** Transaction-bound state and marker interpreter for one runtime command poll. */
export interface RuntimeCommandDecisionUnitOfWork
{
	/** Apply due approval expiry while the caller owns the waiting run fence. */
	expireWaiting(context: { readonly runId: string; readonly attempt: number; readonly runState: RuntimeAdmissionRunState }, approvalExpiry: RuntimeApprovalExpiry | null, now: Date): Promise<"not_required" | "applied" | "unavailable">;
	/** Select the next persistence command kind from durable run state and marker evidence. */
	decide(context: { readonly runId: string; readonly attempt: number; readonly runState: RuntimeAdmissionRunState }, commands: readonly { readonly kind: RuntimeCommandKind }[]): Promise<RuntimeCommandKind | null>;
}

/** Stable result returned after a candidate reaches the authoritative run boundary. */
export interface RuntimeCandidateDispatchResult
{
	/** Whether the authority accepted this candidate or its idempotent replay. */
	readonly accepted: boolean;
	/** Machine-readable reason when the candidate was rejected. */
	readonly reason?: string;
}
