import type { Router } from "express";

import type { SkillWorkloadDispatchAuthority } from "./skill-workload-authority.types.js";

/** TokenReview-confirmed identity of the one controller workload allowed to project skill Jobs. */
export interface ReviewedSkillWorkloadControllerIdentity
{
	/** Exact Kubernetes username returned by TokenReview. */
	readonly username: string;
	/** Kubernetes namespace returned by TokenReview. */
	readonly namespace: string;
	/** Kubernetes ServiceAccount name returned by TokenReview. */
	readonly serviceAccountName: string;
	/** Audiences accepted by the Kubernetes API server for this projected token. */
	readonly audiences: readonly string[];
}

/** Projected-token reviewer supplied only by the OpenCrane process boundary. */
export interface SkillWorkloadControllerTokenReviewer
{
	/** Review one raw bearer token and expose only its verified Kubernetes identity. */
	__Review(token: string): Promise<ReviewedSkillWorkloadControllerIdentity | null>;
}

/** Minimal structured logger surface used by the skill-workload HTTP boundary. */
export interface SkillWorkloadDispatchLogger
{
	/** Record an unavailable authority without serialising a bearer token or request body. */
	error(bindings: { readonly err: unknown; readonly operation: string }, message: string): void;
}

/** Dependencies of the controller-only governed-skill workload API. */
export interface SkillWorkloadDispatchRouterDependencies
{
	/** Dedicated projected-token identity reviewer. */
	readonly tokenReviewer: SkillWorkloadControllerTokenReviewer;
	/** Namespace in which the controller ServiceAccount must exist. */
	readonly namespace: string;
	/** Application authority for claim generation and suspended-Job assignment. */
	readonly authority: SkillWorkloadDispatchAuthority;
	/** Shared process logger carrying request and trace context. */
	readonly logger: SkillWorkloadDispatchLogger;
}

/** Factory producing the controller-only skill-workload HTTP router. */
export type CreateSkillWorkloadDispatchRouter = (dependencies: SkillWorkloadDispatchRouterDependencies) => Router;
