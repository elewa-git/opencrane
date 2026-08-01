import type { ArtifactPreprocessorClaimCommand, ArtifactPreprocessorFailureCommand } from "@opencrane/contracts";

import type { ArtifactPreprocessCompletionRequest, ArtifactPreprocessOutputLeaseRequest, ArtifactPreprocessRepository, ClaimNextArtifactPreprocessJobResult, CompleteArtifactPreprocessJobResult, FailArtifactPreprocessJobResult, IssueArtifactPreprocessOutputLeaseResult } from "./artifact-preprocessing.types.js";
import type { ArtifactPreprocessUnitOfWork } from "./artifact-unit-of-work.types.js";

/** Facade that runs each fenced preprocessing state transition inside its own opaque unit of work. */
export class _ArtifactPreprocessAuthority implements ArtifactPreprocessRepository
{
	/** Boundary that prevents router and broker code from owning a Prisma transaction. */
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
