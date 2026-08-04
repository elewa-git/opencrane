import type { SkillAuthoringCompletionCommand } from "./skill-authoring-completion.types.js";
import type { SkillAuthoringInputRecord } from "./skill-authoring-input.types.js";
import type { SkillWorkloadBootstrapIdentity, SkillWorkloadBootstrapRecord } from "./skill-workload-bootstrap.types.js";
import type { SkillWorkloadAssignmentCommand, SkillWorkloadClaim, SkillWorkloadPodRegistrationCommand, SkillWorkloadReleaseClaim, SkillWorkloadReleaseCommand } from "./skill-workload-claims.types.js";

/** Transaction-scoped persistence capability for controller claim and Job-assignment transitions. */
export interface SkillWorkloadAssignmentRepository
{
	/** Claims one eligible workload while preserving the revision-before-workload lock order. */
	claimNext(): Promise<SkillWorkloadClaim | null>;
	/** Commits one exact claim generation to its immutable Kubernetes Job UID. */
	commitAssignment(workloadId: string, command: SkillWorkloadAssignmentCommand): Promise<"assigned" | "idempotent" | "conflict">;
}

/** Transaction-scoped persistence capability for the later Job release and first-Pod fence. */
export interface SkillWorkloadReleaseRepository
{
	/** Claims one assigned workload for a single fenced Kubernetes unsuspend operation. */
	claimNextRelease(): Promise<SkillWorkloadReleaseClaim | null>;
	/** Commits the exact successful unsuspend operation or its immutable replay. */
	commitRelease(workloadId: string, command: SkillWorkloadReleaseCommand): Promise<"released" | "idempotent" | "conflict">;
	/** Records the sole Job-owned Pod before a bootstrap can be consumed. */
	registerFirstPod(workloadId: string, command: SkillWorkloadPodRegistrationCommand): Promise<"registered" | "idempotent" | "conflict">;
}

/** Transaction-scoped persistence capability for one hash-addressed worker bootstrap. */
export interface SkillWorkloadBootstrapRepository
{
	/** Selects one unconsumed bootstrap without admitting a caller-selected identity. */
	loadUnconsumed(referenceHash: string): Promise<SkillWorkloadBootstrapRecord | null>;
	/** Consumes that bootstrap under the exact TokenReview-confirmed worker identity. */
	consume(referenceHash: string, identity: SkillWorkloadBootstrapIdentity): Promise<"consumed" | "conflict">;
}

/** Transaction-scoped persistence capability for a terminal authoring evidence report. */
export interface SkillAuthoringCompletionRepository
{
	/** Stores bounded successful evidence and terminalises exactly one reviewed workload. */
	complete(command: SkillAuthoringCompletionCommand, identity: SkillWorkloadBootstrapIdentity): Promise<"completed" | "conflict">;
}

/** Transaction-scoped read capability selecting a source artifact for one reviewed authoring Pod. */
export interface SkillAuthoringInputRepository
{
	/** Returns the fully pinned active artifact or no record when any authority fence differs. */
	load(workloadId: string, identity: SkillWorkloadBootstrapIdentity): Promise<SkillAuthoringInputRecord | null>;
}

/** Capability repositories bound to one opaque Postgres transaction. */
export interface SkillWorkloadExecutionTransaction
{
	/** Controller claim and suspended-Job assignment authority. */
	readonly assignments: SkillWorkloadAssignmentRepository;
	/** Controller unsuspend and first-Pod registration authority. */
	readonly releases: SkillWorkloadReleaseRepository;
	/** One-use bootstrap lookup and consumption authority. */
	readonly bootstraps: SkillWorkloadBootstrapRepository;
	/** Authoring terminal-evidence authority. */
	readonly authoringCompletions: SkillAuthoringCompletionRepository;
	/** Authoring source-artifact selection authority. */
	readonly authoringInputs: SkillAuthoringInputRepository;
}

/** Work that must run with all skill-execution repositories on one transaction snapshot. */
export type SkillWorkloadExecutionWork<Result> = (transaction: SkillWorkloadExecutionTransaction) => Promise<Result>;

/** Opaque durability boundary for every skill-execution authority operation. */
export interface SkillWorkloadExecutionUnitOfWork
{
	/** Runs work after binding all capability repositories to one transaction-scoped Prisma client. */
	run<Result>(work: SkillWorkloadExecutionWork<Result>): Promise<Result>;
}
