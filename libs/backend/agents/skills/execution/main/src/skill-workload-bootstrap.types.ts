import type { Router } from "express";

/** TokenReview-confirmed identity of one governed skill worker Pod. */
export interface SkillWorkloadBootstrapIdentity
{
	/** Namespace of the reviewed ServiceAccount token. */
	readonly namespace: string;
	/** Reviewed ServiceAccount name. */
	readonly serviceAccountName: string;
	/** Immutable Kubernetes Pod UID carried by the projected token. */
	readonly podUid: string;
}

/** Reviews a projected token for the precise audience selected by durable bootstrap authority. */
export interface SkillWorkloadBootstrapTokenReviewer
{
	/** Returns a reviewed identity or null without exposing TokenReview internals. */
	__Review(token: string, audience: string): Promise<SkillWorkloadBootstrapIdentity | null>;
}

/** Durable bootstrap facts that select the sole accepted projected-token identity. */
export interface SkillWorkloadBootstrapRecord
{
	/** Stable workload identifier used only in the response receipt. */
	readonly workloadId: string;
	/** Hash-only lookup coordinate for the submitted opaque reference. */
	readonly referenceHash: string;
	/** Expected projected-token audience. */
	readonly audience: string;
	/** Expected isolated worker ServiceAccount. */
	readonly serviceAccountName: string;
	/** Expected isolated worker namespace. */
	readonly namespace: string;
	/** Immutable assigned Kubernetes Job UID. */
	readonly workloadUid: string;
	/** Immutable first registered worker Pod UID. */
	readonly podUid: string;
}

/** Persistence boundary for exact bootstrap lookup and one-time consumption. */
export interface SkillWorkloadBootstrapRepository
{
	/** Loads a still-unconsumed bootstrap authority by hash without accepting a worker identity. */
	loadUnconsumedByReferenceHash(referenceHash: string): Promise<SkillWorkloadBootstrapRecord | null>;
	/** Atomically consumes the same reference only under its exact reviewed identity. */
	consumeAtomically(referenceHash: string, identity: SkillWorkloadBootstrapIdentity): Promise<"consumed" | "conflict">;
}

/** Minimal structured logger surface for the internal worker bootstrap boundary. */
export interface SkillWorkloadBootstrapLogger
{
	/** Records unavailable authority without serialising the bearer token or opaque reference. */
	error(bindings: { readonly err: unknown; readonly operation: string }, message: string): void;
}

/** Dependencies of the worker-authenticated skill bootstrap acknowledgement router. */
export interface SkillWorkloadBootstrapRouterDependencies
{
	/** TokenReview adapter supplied by the OpenCrane process boundary. */
	readonly tokenReviewer: SkillWorkloadBootstrapTokenReviewer;
	/** Durable one-use bootstrap authority. */
	readonly repository: SkillWorkloadBootstrapRepository;
	/** Shared structured logger. */
	readonly logger: SkillWorkloadBootstrapLogger;
}

/** Factory producing the internal worker bootstrap acknowledgement API. */
export type CreateSkillWorkloadBootstrapRouter = (dependencies: SkillWorkloadBootstrapRouterDependencies) => Router;
