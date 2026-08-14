import type { Router } from "express";

import type { SkillWorkloadBootstrapAuthority } from "./skill-workload-authority.types";

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

/** TokenReviews a worker token against the audience stored on its bootstrap row. */
export interface SkillWorkloadBootstrapTokenReviewer
{
	/** Returns a reviewed identity or null without exposing TokenReview internals. */
	__Review(token: string, audience: string): Promise<SkillWorkloadBootstrapIdentity | null>;
}

/** The stored bootstrap row. Its fields say which worker identity will be accepted. */
export interface SkillWorkloadBootstrapRecord
{
	/** Stable workload identifier used only in the response receipt. */
	readonly workloadId: string;
	/** Hash of the reference the worker submits. The plain reference is never stored. */
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

/** Minimal structured logger surface for the internal worker bootstrap boundary. */
export interface SkillWorkloadBootstrapLogger
{
	/** Logs that the database was unreachable, without logging the bearer token or the reference. */
	error(bindings: { readonly err: unknown; readonly operation: string }, message: string): void;
}

/** Dependencies of the worker-authenticated skill bootstrap acknowledgement router. */
export interface SkillWorkloadBootstrapRouterDependencies
{
	/** TokenReview adapter supplied by the OpenCrane process boundary. */
	readonly tokenReviewer: SkillWorkloadBootstrapTokenReviewer;
	/** Durable one-use bootstrap application authority. */
	readonly authority: SkillWorkloadBootstrapAuthority;
	/** Shared structured logger. */
	readonly logger: SkillWorkloadBootstrapLogger;
}

/** Factory producing the internal worker bootstrap acknowledgement API. */
export type CreateSkillWorkloadBootstrapRouter = (dependencies: SkillWorkloadBootstrapRouterDependencies) => Router;
