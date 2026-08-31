import type { Prisma } from "@prisma/client";

import { ArtifactPreprocessPipelineVersions } from "@opencrane/backend/artifacts/preprocessor/workflows/contract";
import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";

import { __ArtifactPreprocessWorkflowTaskKey } from "./artifact-preprocess-workflow-admission";
import type { ArtifactPreprocessWorkflowRecord, ArtifactPreprocessWorkflowRepository } from "./artifact-preprocess-workflow-admission.types";

/**
 * Stores a PDF preprocessing record and its workflow receipt in a caller-owned transaction.
 *
 * This adapter never opens or commits a transaction. Publication and clean-scan repositories give
 * it their Prisma transaction client, so a failure while saving or binding the workflow task rolls
 * back the PDF state with it.
 *
 * Called by: the constructors of `PrismaArtifactAuthorityRepository` and
 * `PrismaArtifactScanRepository`, which pass their current transaction client.
 * @implements ArtifactPreprocessWorkflowRepository
 */
export class PrismaArtifactPreprocessWorkflowRepository implements ArtifactPreprocessWorkflowRepository
{
	/** Holds the product transaction shared with workflow task admission. */
	private readonly transaction: Prisma.TransactionClient;

	/**
	 * Uses the caller's transaction without opening or committing another one.
	 * @param transaction - Prisma client for the surrounding publication or clean-scan transaction.
	 */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/**
	 * Creates the pending product record before the workflow task is saved.
	 * @param source - Published PDF revision and the silo that owns it.
	 * @returns The job id and deterministic task key used to admit the remote work.
	 */
	async create(source: Pick<ArtifactPreprocessWorkflowRecord, "siloId" | "sourceRevisionId">): Promise<ArtifactPreprocessWorkflowRecord>
	{
		const taskKey = __ArtifactPreprocessWorkflowTaskKey(source);
		const preprocess = await this.transaction.artifactPreprocessJob.create({ data: { sourceRevisionId: source.sourceRevisionId, pipelineVersion: ArtifactPreprocessPipelineVersions.PdfToText, taskKey } });
		return { preprocessJobId: preprocess.id, siloId: source.siloId, sourceRevisionId: source.sourceRevisionId, taskKey };
	}

	/**
	 * Binds the saved task receipt before the surrounding product transaction commits.
	 * @param record - Pending preprocessing record created earlier in this transaction.
	 * @param receipt - Task receipt already checked against the record's name and retry key.
	 * @returns Nothing after saving the task id and name.
	 */
	async bindTask(record: ArtifactPreprocessWorkflowRecord, receipt: IWorkflowTaskReceipt): Promise<void>
	{
		await this.transaction.artifactPreprocessJob.update({ where: { id: record.preprocessJobId }, data: { taskId: receipt.taskId, taskName: receipt.taskName } });
	}
}
