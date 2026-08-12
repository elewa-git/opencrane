import type { SkillAuthoringCompletionCommand } from "./skill-authoring-completion.types.js";
import type { SkillAuthoringInputRecord } from "./skill-authoring-input.types.js";
import type { SkillWorkloadBootstrapIdentity, SkillWorkloadBootstrapRecord } from "./skill-workload-bootstrap.types.js";
import type { SkillWorkloadAssignmentCommand, SkillWorkloadClaim, SkillWorkloadPodRegistrationCommand, SkillWorkloadReleaseClaim, SkillWorkloadReleaseCommand } from "./skill-workload-claims.types.js";

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

/** Records an authoring worker's final report. */
export interface SkillAuthoringCompletionAuthority
{
	/** Completes one workload, using the fixed-shape reports its authoring Pod sent. */
	completeAtomically(command: SkillAuthoringCompletionCommand, identity: SkillWorkloadBootstrapIdentity): Promise<"completed" | "conflict">;
}

/** Finds the source artifact an authoring worker is allowed to read. */
export interface SkillAuthoringInputAuthority
{
	/** Loads the sole source artifact authorised for the reviewed worker Pod. */
	loadForWorker(workloadId: string, identity: SkillWorkloadBootstrapIdentity): Promise<SkillAuthoringInputRecord | null>;
}

/** All four skill-execution authorities, backed by one unit of work. */
export interface SkillWorkloadExecutionAuthority extends SkillWorkloadDispatchAuthority, SkillWorkloadBootstrapAuthority, SkillAuthoringCompletionAuthority, SkillAuthoringInputAuthority
{
}
