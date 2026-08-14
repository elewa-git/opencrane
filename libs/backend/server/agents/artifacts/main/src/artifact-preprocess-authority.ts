import type { ArtifactPreprocessorClaimCommand, ArtifactPreprocessorFailureCommand } from "@opencrane/contracts";

import type { ArtifactPreprocessCompletionRequest, ArtifactPreprocessOutputLeaseRequest, ArtifactPreprocessRepository, ClaimNextArtifactPreprocessJobResult, CompleteArtifactPreprocessJobResult, FailArtifactPreprocessJobResult, IssueArtifactPreprocessOutputLeaseResult } from "./artifact-preprocessing.types";
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
export class _ArtifactPreprocessAuthority implements ArtifactPreprocessRepository
{
	/** The only thing here allowed to open a transaction, so router and broker code never holds one. */
	private readonly unitOfWork: ArtifactPreprocessUnitOfWork;

	/** Creates the durable preprocessing authority. */
	constructor(unitOfWork: ArtifactPreprocessUnitOfWork)
	{
		this.unitOfWork = unitOfWork;
	}

	/** Claims the next eligible job and allocates its fresh fence atomically. */
	claimNextAtomically(): Promise<ClaimNextArtifactPreprocessJobResult>
	{
		return this.unitOfWork.run(async function _Claim(repository)
		{
			return repository.claimNextAtomically();
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

	/** Publishes one verified derived revision and closes the live claim atomically. */
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
