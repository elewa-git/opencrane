import type { SkillWorkloadBootstrapIdentity, SkillWorkloadBootstrapRecord } from "./skill-workload-bootstrap.types";
import type { SkillWorkloadAssignmentCommand, SkillWorkloadClaim, SkillWorkloadPodRegistrationCommand, SkillWorkloadReleaseClaim, SkillWorkloadReleaseCommand } from "./skill-workload-claims.types";

/** What the agent controller may change about a workload in the database. */
export interface SkillWorkloadDispatchAuthority
{
	/** Claims one workload that is ready to run. */
	claimNextAtomically(): Promise<SkillWorkloadClaim | null>;
	/** Records the Kubernetes Job UID against the claim the controller holds. */
	commitAssignmentAtomically(workloadId: string, command: SkillWorkloadAssignmentCommand): Promise<"assigned" | "idempotent" | "conflict">;
	/** Claims one assigned Job for a single fenced release operation. */
	claimNextReleaseAtomically(): Promise<SkillWorkloadReleaseClaim | null>;
	/** Commits one exact successful release operation. */
	commitReleaseAtomically(workloadId: string, command: SkillWorkloadReleaseCommand): Promise<"released" | "idempotent" | "conflict">;
	/** Records the first Pod that the unsuspended Job created. */
	registerFirstPodAtomically(workloadId: string, command: SkillWorkloadPodRegistrationCommand): Promise<"registered" | "idempotent" | "conflict">;
}

/** Lets a worker use its bootstrap reference exactly once. */
export interface SkillWorkloadBootstrapAuthority
{
	/** Looks up, by reference hash, the worker identity this bootstrap will accept. */
	loadUnconsumedByReferenceHash(referenceHash: string): Promise<SkillWorkloadBootstrapRecord | null>;
	/** Marks the bootstrap used, only for the worker identity TokenReview confirmed. */
	consumeAtomically(referenceHash: string, identity: SkillWorkloadBootstrapIdentity): Promise<"consumed" | "conflict">;
}

/** Retained tool-runner authorities backed by one unit of work. */
export interface SkillWorkloadExecutionAuthority extends SkillWorkloadDispatchAuthority, SkillWorkloadBootstrapAuthority
{
}
