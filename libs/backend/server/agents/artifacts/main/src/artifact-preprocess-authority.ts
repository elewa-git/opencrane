import type { ArtifactPreprocessorClaimCommand, ArtifactPreprocessorFailureCommand } from "@opencrane/contracts";
import type { ArtifactPreprocessCompletion, ArtifactPreprocessControllerAuthority, ArtifactPreprocessControllerRecord, ArtifactPreprocessPodBindCommand, ArtifactPreprocessWorkloadBindCommand } from "@opencrane/backend/artifacts/preprocessor/workflows/contract";
import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";

import type { ArtifactPreprocessCompletionRequest, ArtifactPreprocessOutputLeaseRequest, ArtifactPreprocessRepository, CompleteArtifactPreprocessJobResult, FailArtifactPreprocessJobResult, IssueArtifactPreprocessOutputLeaseResult } from "./artifact-preprocessing.types";
import type { ArtifactPreprocessUnitOfWork } from "./artifact-unit-of-work.types";

/**
 * Wraps every preprocessing operation in its own database transaction.
 *
 * Each method does one thing: hand the call to the unit of work, which opens a transaction,
 * builds a repository bound to it, runs the call, and commits. Nothing else is added, which is
 * the point - the router and the brokers get an object that looks like a repository and can
 * never open, hold, or leak a transaction across their HTTP calls.
 *
 * Errors are not translated here. A collision that exhausts its retries reaches the caller as
 * the original database error, and the router answers HTTP 503.
 *
 * Called by: `_CreateArtifactPreprocessAuthority` in prisma-artifact-authority.composition.ts.
 */
export class _ArtifactPreprocessAuthority implements ArtifactPreprocessRepository, ArtifactPreprocessControllerAuthority
{
	/** The only thing here allowed to open a transaction, so router and broker code never holds one. */
	private readonly unitOfWork: ArtifactPreprocessUnitOfWork;

	/** Creates the durable preprocessing authority. */
	constructor(unitOfWork: ArtifactPreprocessUnitOfWork)
	{
		this.unitOfWork = unitOfWork;
	}

	/** Issues or reloads the controller delivery for the exact admitted task. */
	claimForTask(preprocessJobId: string, task: IWorkflowTaskReceipt): Promise<ArtifactPreprocessControllerRecord | null>
	{
		return this.unitOfWork.run(async function _Claim(repository)
		{
			return repository.claimForTask(preprocessJobId, task);
		});
	}

	/** Saves the immutable Job UID and hashed bootstrap under the current delivery. */
	bindWorkload(preprocessJobId: string, task: IWorkflowTaskReceipt, command: ArtifactPreprocessWorkloadBindCommand): Promise<"bound" | "idempotent" | "conflict">
	{
		return this.unitOfWork.run(async function _Bind(repository)
		{
			return repository.bindWorkload(preprocessJobId, task, command);
		});
	}

	/** Saves the immutable first Pod UID beneath the accepted Job. */
	bindFirstPod(preprocessJobId: string, task: IWorkflowTaskReceipt, command: ArtifactPreprocessPodBindCommand): Promise<"bound" | "idempotent" | "conflict">
	{
		return this.unitOfWork.run(async function _Bind(repository)
		{
			return repository.bindFirstPod(preprocessJobId, task, command);
		});
	}

	/** Loads one server-owned completion inbox entry through its admitted task. */
	loadCompletion(preprocessJobId: string, completionDigest: string, task: IWorkflowTaskReceipt): Promise<ArtifactPreprocessCompletion | null>
	{
		return this.unitOfWork.run(async function _Load(repository)
		{
			return repository.loadCompletion(preprocessJobId, completionDigest, task);
		});
	}

	/** Consumes matching completion evidence and makes the job terminal once. */
	complete(preprocessJobId: string, completion: ArtifactPreprocessCompletion, task: IWorkflowTaskReceipt): Promise<"completed" | "idempotent" | "conflict">
	{
		return this.unitOfWork.run(async function _Complete(repository)
		{
			return repository.complete(preprocessJobId, completion, task);
		});
	}

	/** Issues source-read authority only for the currently locked claim. */
	issueSourceLeaseAtomically(command: ArtifactPreprocessorClaimCommand): ReturnType<ArtifactPreprocessRepository["issueSourceLeaseAtomically"]>
	{
		return this.unitOfWork.run(async function _IssueSource(repository)
		{
			return repository.issueSourceLeaseAtomically(command);
		});
	}

	/** Reserves one output lease for a live claim without exposing it to the worker. */
	issueOutputLeaseAtomically(command: ArtifactPreprocessOutputLeaseRequest): Promise<IssueArtifactPreprocessOutputLeaseResult>
	{
		return this.unitOfWork.run(async function _IssueOutput(repository)
		{
			return repository.issueOutputLeaseAtomically(command);
		});
	}

	/** Publishes one verified derived revision and records its completion inbox atomically. */
	completeAtomically(command: ArtifactPreprocessCompletionRequest): Promise<CompleteArtifactPreprocessJobResult>
	{
		return this.unitOfWork.run(async function _Complete(repository)
		{
			return repository.completeAtomically(command);
		});
	}

	/** Applies bounded retry policy while the exact attempt fence still holds. */
	failAtomically(command: ArtifactPreprocessorFailureCommand): Promise<FailArtifactPreprocessJobResult>
	{
		return this.unitOfWork.run(async function _Fail(repository)
		{
			return repository.failAtomically(command);
		});
	}
}
