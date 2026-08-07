import type { SkillAuthoringCompletionCommand } from "./skill-authoring-completion.types.js";
import type { SkillAuthoringInputRecord } from "./skill-authoring-input.types.js";
import type { SkillWorkloadBootstrapIdentity, SkillWorkloadBootstrapRecord } from "./skill-workload-bootstrap.types.js";
import type { SkillWorkloadAssignmentCommand, SkillWorkloadClaim, SkillWorkloadPodRegistrationCommand, SkillWorkloadReleaseClaim, SkillWorkloadReleaseCommand } from "./skill-workload-claims.types.js";

/** Application-facing authority for controller-only workload durability transitions. */
export interface SkillWorkloadDispatchAuthority
{
	/** Claims one eligible workload for the reviewed controller. */
	claimNextAtomically(): Promise<SkillWorkloadClaim | null>;
	/** Assigns the exact claimed generation to one immutable Kubernetes Job UID. */
	commitAssignmentAtomically(workloadId: string, command: SkillWorkloadAssignmentCommand): Promise<"assigned" | "idempotent" | "conflict">;
	/** Claims one assigned Job for a single fenced release operation. */
	claimNextReleaseAtomically(): Promise<SkillWorkloadReleaseClaim | null>;
	/** Commits one exact successful release operation. */
	commitReleaseAtomically(workloadId: string, command: SkillWorkloadReleaseCommand): Promise<"released" | "idempotent" | "conflict">;
	/** Binds the first Kubernetes Pod owned by the already released Job. */
	registerFirstPodAtomically(workloadId: string, command: SkillWorkloadPodRegistrationCommand): Promise<"registered" | "idempotent" | "conflict">;
}

/** Application-facing authority for one-use worker bootstrap acknowledgement. */
export interface SkillWorkloadBootstrapAuthority
{
	/** Loads the durable identity fences selected by an opaque reference hash. */
	loadUnconsumedByReferenceHash(referenceHash: string): Promise<SkillWorkloadBootstrapRecord | null>;
	/** Consumes the referenced bootstrap only under its reviewed worker identity. */
	consumeAtomically(referenceHash: string, identity: SkillWorkloadBootstrapIdentity): Promise<"consumed" | "conflict">;
}

/** Application-facing authority for authoring terminal evidence. */
export interface SkillAuthoringCompletionAuthority
{
	/** Completes exactly one workload using bounded evidence from its reviewed authoring Pod. */
	completeAtomically(command: SkillAuthoringCompletionCommand, identity: SkillWorkloadBootstrapIdentity): Promise<"completed" | "conflict">;
}

/** Application-facing authority selecting immutable source bytes for a reviewed authoring worker. */
export interface SkillAuthoringInputAuthority
{
	/** Loads the sole source artifact authorised for the reviewed worker Pod. */
	loadForWorker(workloadId: string, identity: SkillWorkloadBootstrapIdentity): Promise<SkillAuthoringInputRecord | null>;
}

/** Complete application authority surface composed from one opaque unit of work. */
export interface SkillWorkloadExecutionAuthority extends SkillWorkloadDispatchAuthority, SkillWorkloadBootstrapAuthority, SkillAuthoringCompletionAuthority, SkillAuthoringInputAuthority
{
}
