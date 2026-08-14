import type { SkillAuthoringCompletionCommand } from "./skill-authoring-completion.types";
import type { SkillAuthoringInputRecord } from "./skill-authoring-input.types";
import type { SkillWorkloadBootstrapIdentity, SkillWorkloadBootstrapRecord } from "./skill-workload-bootstrap.types";
import type { SkillWorkloadAssignmentCommand, SkillWorkloadClaim, SkillWorkloadPodRegistrationCommand, SkillWorkloadReleaseClaim, SkillWorkloadReleaseCommand } from "./skill-workload-claims.types";
import type { SkillWorkloadExecutionAuthority } from "./skill-workload-authority.types";
import { _SkillWorkloadPersistenceConflictError, type SkillWorkloadExecutionUnitOfWork, type SkillWorkloadExecutionWork } from "./skill-workload-unit-of-work.types";

/** Runs every skill-execution state change inside one transaction. */
export class _SkillWorkloadExecutionAuthority implements SkillWorkloadExecutionAuthority
{
	/** The only way this class opens a transaction. Prisma itself is not reachable from here. */
	private readonly unitOfWork: SkillWorkloadExecutionUnitOfWork;

	/** Stores the unit of work that every transaction below runs through. */
	constructor(unitOfWork: SkillWorkloadExecutionUnitOfWork)
	{
		this.unitOfWork = unitOfWork;
	}

	/** Claims one workload for the controller, inside one transaction. */
	async claimNextAtomically(): Promise<SkillWorkloadClaim | null>
	{
		return this._runConflictAs(function _Claim(transaction): Promise<SkillWorkloadClaim | null> { return transaction.assignments.claimNext(); }, null);
	}

	/** Records the Kubernetes Job UID against the claim the controller was given, in one transaction. */
	async commitAssignmentAtomically(workloadId: string, command: SkillWorkloadAssignmentCommand): Promise<"assigned" | "idempotent" | "conflict">
	{
		return this._runConflictAs(function _Assign(transaction): Promise<"assigned" | "idempotent" | "conflict"> { return transaction.assignments.commitAssignment(workloadId, command); }, "conflict");
	}

	/** Claims one previously assigned Job for the controller's unsuspend operation. */
	async claimNextReleaseAtomically(): Promise<SkillWorkloadReleaseClaim | null>
	{
		return this._runConflictAs(function _ClaimRelease(transaction): Promise<SkillWorkloadReleaseClaim | null> { return transaction.releases.claimNextRelease(); }, null);
	}

	/** Commits one exact successful Job release. */
	async commitReleaseAtomically(workloadId: string, command: SkillWorkloadReleaseCommand): Promise<"released" | "idempotent" | "conflict">
	{
		return this._runConflictAs(function _CommitRelease(transaction): Promise<"released" | "idempotent" | "conflict"> { return transaction.releases.commitRelease(workloadId, command); }, "conflict");
	}

	/** Records the first Pod, but only when Kubernetes has shown it belongs to the released Job. */
	async registerFirstPodAtomically(workloadId: string, command: SkillWorkloadPodRegistrationCommand): Promise<"registered" | "idempotent" | "conflict">
	{
		return this._runConflictAs(function _RegisterFirstPod(transaction): Promise<"registered" | "idempotent" | "conflict"> { return transaction.releases.registerFirstPod(workloadId, command); }, "conflict");
	}

	/** Reads the worker identity the bootstrap expects, in a short read transaction, before the router calls TokenReview. */
	loadUnconsumedByReferenceHash(referenceHash: string): Promise<SkillWorkloadBootstrapRecord | null>
	{
		return this.unitOfWork.run(function _LoadBootstrap(transaction): Promise<SkillWorkloadBootstrapRecord | null> { return transaction.bootstraps.loadUnconsumed(referenceHash); });
	}

	/** Marks the bootstrap used, after the router has TokenReviewed the worker separately. */
	async consumeAtomically(referenceHash: string, identity: SkillWorkloadBootstrapIdentity): Promise<"consumed" | "conflict">
	{
		return this._runConflictAs(function _ConsumeBootstrap(transaction): Promise<"consumed" | "conflict"> { return transaction.bootstraps.consume(referenceHash, identity); }, "conflict");
	}

	/** Stores the authoring reports and the workload's final state in one transaction. */
	async completeAtomically(command: SkillAuthoringCompletionCommand, identity: SkillWorkloadBootstrapIdentity): Promise<"completed" | "conflict">
	{
		return this._runConflictAs(function _CompleteAuthoring(transaction): Promise<"completed" | "conflict"> { return transaction.authoringCompletions.complete(command, identity); }, "conflict");
	}

	/** Reads the artifact ids in a transaction, then closes it before any ArtifactStore call. */
	loadForWorker(workloadId: string, identity: SkillWorkloadBootstrapIdentity): Promise<SkillAuthoringInputRecord | null>
	{
		return this.unitOfWork.run(function _LoadAuthoringInput(transaction): Promise<SkillAuthoringInputRecord | null> { return transaction.authoringInputs.load(workloadId, identity); });
	}

	/** Runs one transaction. Turns a rolled-back conflict into the supplied fallback value, and rethrows anything else. */
	private async _runConflictAs<Result>(work: SkillWorkloadExecutionWork<Result>, conflict: Result): Promise<Result>
	{
		try
		{
			return await this.unitOfWork.run(work);
		}
		catch (error)
		{
			if (error instanceof _SkillWorkloadPersistenceConflictError) return conflict;
			throw error;
		}
	}
}

/** Creates the authority used by the four internal HTTP routes. */
export function _CreateSkillWorkloadExecutionAuthority(unitOfWork: SkillWorkloadExecutionUnitOfWork): SkillWorkloadExecutionAuthority
{
	return new _SkillWorkloadExecutionAuthority(unitOfWork);
}
