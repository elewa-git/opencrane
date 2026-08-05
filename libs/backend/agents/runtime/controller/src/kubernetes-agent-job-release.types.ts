import type { AgentControllerJobPatchRequest } from "./kubernetes-agent-controller-store.types.js";

/**
 * A compare-and-swap Job release request derived from one still-suspended assignment.
 *
 * The plan carries the canonical expiry alongside its patch so the adapter can prove that the
 * Kubernetes response still fits inside the durable assignment after the mutation completes.
 */
export interface AgentControllerJobReleasePlan
{
	/** Conditional patch that tests identity and suspension before reducing the deadline and releasing. */
	readonly patch: AgentControllerJobPatchRequest;
	/** Conservative whole-second execution allowance written into the released Job. */
	readonly activeDeadlineSeconds: number;
	/** Canonical durable expiry that the released Job must not outlive. */
	readonly canonicalAssignmentExpiresAt: string;
}
