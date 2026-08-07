import type { SkillAuthoringCompletionCommand } from "./skill-authoring-completion.types.js";
import type { SkillAuthoringInputRecord } from "./skill-authoring-input.types.js";
import type { SkillWorkloadBootstrapIdentity, SkillWorkloadBootstrapRecord } from "./skill-workload-bootstrap.types.js";
import type { SkillWorkloadAssignmentCommand, SkillWorkloadClaim, SkillWorkloadPodRegistrationCommand, SkillWorkloadReleaseClaim, SkillWorkloadReleaseCommand } from "./skill-workload-claims.types.js";
import type { SkillWorkloadExecutionAuthority } from "./skill-workload-authority.types.js";
import { _SkillWorkloadPersistenceConflictError, type SkillWorkloadExecutionUnitOfWork, type SkillWorkloadExecutionWork } from "./skill-workload-unit-of-work.types.js";

/** Application authority coordinating each governed skill-execution transition through one unit of work. */
export class _SkillWorkloadExecutionAuthority implements SkillWorkloadExecutionAuthority
{
	/** Opaque transaction boundary; Prisma is deliberately unavailable beyond this field. */
	private readonly unitOfWork: SkillWorkloadExecutionUnitOfWork;

	/** Creates the application authority from the sole persistence unit of work. */
	constructor(unitOfWork: SkillWorkloadExecutionUnitOfWork)
	{
		this.unitOfWork = unitOfWork;
	}

	/** Claims one controller-visible workload within one fenced durable transaction. */
	async claimNextAtomically(): Promise<SkillWorkloadClaim | null>
	{
		return this._runConflictAs(function _Claim(transaction): Promise<SkillWorkloadClaim | null> { return transaction.assignments.claimNext(); }, null);
	}

	/** Commits the exact controller claim and immutable Job UID in one durable transaction. */
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

	/** Registers only the first Pod Kubernetes proves belongs to the released Job. */
	async registerFirstPodAtomically(workloadId: string, command: SkillWorkloadPodRegistrationCommand): Promise<"registered" | "idempotent" | "conflict">
	{
		return this._runConflictAs(function _RegisterFirstPod(transaction): Promise<"registered" | "idempotent" | "conflict"> { return transaction.releases.registerFirstPod(workloadId, command); }, "conflict");
	}

	/** Selects bootstrap identity fences in a short read transaction before external TokenReview. */
	loadUnconsumedByReferenceHash(referenceHash: string): Promise<SkillWorkloadBootstrapRecord | null>
	{
		return this.unitOfWork.run(function _LoadBootstrap(transaction): Promise<SkillWorkloadBootstrapRecord | null> { return transaction.bootstraps.loadUnconsumed(referenceHash); });
	}

	/** Atomically consumes the bootstrap after the router independently TokenReviews the selected identity. */
	async consumeAtomically(referenceHash: string, identity: SkillWorkloadBootstrapIdentity): Promise<"consumed" | "conflict">
	{
		return this._runConflictAs(function _ConsumeBootstrap(transaction): Promise<"consumed" | "conflict"> { return transaction.bootstraps.consume(referenceHash, identity); }, "conflict");
	}

	/** Commits bounded authoring evidence and the terminal workload state as one transaction. */
	async completeAtomically(command: SkillAuthoringCompletionCommand, identity: SkillWorkloadBootstrapIdentity): Promise<"completed" | "conflict">
	{
		return this._runConflictAs(function _CompleteAuthoring(transaction): Promise<"completed" | "conflict"> { return transaction.authoringCompletions.complete(command, identity); }, "conflict");
	}

	/** Selects source coordinates transactionally, releasing the transaction before ArtifactStore I/O begins. */
	loadForWorker(workloadId: string, identity: SkillWorkloadBootstrapIdentity): Promise<SkillAuthoringInputRecord | null>
	{
		return this.unitOfWork.run(function _LoadAuthoringInput(transaction): Promise<SkillAuthoringInputRecord | null> { return transaction.authoringInputs.load(workloadId, identity); });
	}

	/** Runs one durable operation while translating only an exhausted rolled-back conflict. */
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

/** Creates the narrow application authority consumed by the four internal HTTP boundaries. */
export function _CreateSkillWorkloadExecutionAuthority(unitOfWork: SkillWorkloadExecutionUnitOfWork): SkillWorkloadExecutionAuthority
{
	return new _SkillWorkloadExecutionAuthority(unitOfWork);
}
