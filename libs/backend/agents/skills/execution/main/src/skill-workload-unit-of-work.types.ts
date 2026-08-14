import type { SkillAuthoringCompletionCommand } from "./skill-authoring-completion.types";
import type { SkillAuthoringInputRecord } from "./skill-authoring-input.types";
import type { SkillWorkloadBootstrapIdentity, SkillWorkloadBootstrapRecord } from "./skill-workload-bootstrap.types";
import type { SkillWorkloadAssignmentCommand, SkillWorkloadClaim, SkillWorkloadPodRegistrationCommand, SkillWorkloadReleaseClaim, SkillWorkloadReleaseCommand } from "./skill-workload-claims.types";

/** Thrown after a database conflict has already rolled the transaction back. */
export class _SkillWorkloadPersistenceConflictError extends Error
{
}

/** Reads and writes claims and Job assignments, inside one transaction. */
export interface SkillWorkloadAssignmentRepository
{
	/** Claims one workload, locking the revision before the workload so lock order is the same everywhere. */
	claimNext(): Promise<SkillWorkloadClaim | null>;
	/** Records the Kubernetes Job UID against the claim the controller holds. */
	commitAssignment(workloadId: string, command: SkillWorkloadAssignmentCommand): Promise<"assigned" | "idempotent" | "conflict">;
}

/** Reads and writes Job releases and first-Pod records, inside one transaction. */
export interface SkillWorkloadReleaseRepository
{
	/** Claims one assigned workload for a single fenced Kubernetes unsuspend operation. */
	claimNextRelease(): Promise<SkillWorkloadReleaseClaim | null>;
	/** Records the unsuspend, or reports `idempotent` when the same one was already recorded. */
	commitRelease(workloadId: string, command: SkillWorkloadReleaseCommand): Promise<"released" | "idempotent" | "conflict">;
	/** Records the Job's single Pod. Until that happens, the bootstrap cannot be used. */
	registerFirstPod(workloadId: string, command: SkillWorkloadPodRegistrationCommand): Promise<"registered" | "idempotent" | "conflict">;
}

/** Reads and consumes one worker bootstrap, looked up by its reference hash, inside one transaction. */
export interface SkillWorkloadBootstrapRepository
{
	/** Finds an unused bootstrap. The caller cannot influence which identity it names. */
	loadUnconsumed(referenceHash: string): Promise<SkillWorkloadBootstrapRecord | null>;
	/** Consumes that bootstrap under the exact TokenReview-confirmed worker identity. */
	consume(referenceHash: string, identity: SkillWorkloadBootstrapIdentity): Promise<"consumed" | "conflict">;
}

/** Stores an authoring worker's final report, inside one transaction. */
export interface SkillAuthoringCompletionRepository
{
	/** Stores the worker's reports and moves that one workload to its final state. */
	complete(command: SkillAuthoringCompletionCommand, identity: SkillWorkloadBootstrapIdentity): Promise<"completed" | "conflict">;
}

/** Finds the source artifact for one authoring Pod, inside one transaction. */
export interface SkillAuthoringInputRepository
{
	/** Returns the pinned artifact, or null when any of the checked ids does not match. */
	load(workloadId: string, identity: SkillWorkloadBootstrapIdentity): Promise<SkillAuthoringInputRecord | null>;
}

/** All five repositories, bound to the same Postgres transaction. */
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

/** A function that does its work using all the repositories on one transaction. */
export type SkillWorkloadExecutionWork<Result> = (transaction: SkillWorkloadExecutionTransaction) => Promise<Result>;

/** Opens the transaction that every skill-execution operation runs inside. */
export interface SkillWorkloadExecutionUnitOfWork
{
	/** Runs the work with every repository bound to one transaction's Prisma client. */
	run<Result>(work: SkillWorkloadExecutionWork<Result>): Promise<Result>;
}
