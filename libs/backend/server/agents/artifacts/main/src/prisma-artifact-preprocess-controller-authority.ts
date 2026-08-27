import { createHash, randomUUID } from "node:crypto";

import { ArtifactKind, ArtifactPreprocessJobState, ArtifactRevisionState, ArtifactState, Prisma } from "@prisma/client";

import { RuntimeWorkloadClaimClasses } from "@opencrane/backend/agents/runtime/workloads/contract";
import { ArtifactPreprocessTaskNames } from "@opencrane/backend/artifacts/preprocessor/workflows/contract";
import type { ArtifactPreprocessCompletion, ArtifactPreprocessControllerAuthority, ArtifactPreprocessControllerRecord, ArtifactPreprocessPodBindCommand, ArtifactPreprocessWorkloadBindCommand } from "@opencrane/backend/artifacts/preprocessor/workflows/contract";
import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";
import { __CreateArtifactPreprocessBootstrapReference, __HashArtifactPreprocessBootstrapReference, __IsArtifactPreprocessBootstrapReference, type ArtifactPreprocessorJobClaim } from "@opencrane/contracts";

/** Selects the one isolated Job profile allowed to process published PDFs. */
const _PROFILE_NAME = "pdf-preprocessor";

/** Limits one controller delivery and its worker bootstrap to five minutes. */
const _CLAIM_LIFETIME_MILLISECONDS = 5 * 60_000;

/** Selects the single preprocessing pipeline owned by this controller authority. */
const _PIPELINE_VERSION = "pdf-to-text/v1";

/** Loads only the receipt, claim, binding, inbox, and source facts this authority checks. */
const _PREPROCESS_SELECT = {
	id: true,
	sourceRevisionId: true,
	pipelineVersion: true,
	taskId: true,
	taskName: true,
	taskKey: true,
	state: true,
	claimFence: true,
	profileName: true,
	claimedAt: true,
	deliveryCount: true,
	claimExpiresAt: true,
	workloadUid: true,
	firstPodUid: true,
	bootstrapReferenceHash: true,
	bootstrapNamespace: true,
	nextAttemptAt: true,
	derivedArtifactId: true,
	completionDigest: true,
	completionConsumedAt: true,
	sourceRevision: {
		select: {
			state: true,
			mediaType: true,
			byteLength: true,
			artifact: { select: { siloId: true, ownerPrincipalId: true, state: true } },
		},
	},
} as const satisfies Prisma.ArtifactPreprocessJobSelect;

/** Names the exact job projection loaded in every controller transaction. */
type _PreprocessJob = Prisma.ArtifactPreprocessJobGetPayload<{ readonly select: typeof _PREPROCESS_SELECT }>;

/** Builds the server-owned idempotency key for one claim across controller retries. */
function _ClaimKey(preprocessJobId: string): string
{
	const digest = createHash("sha256").update(preprocessJobId).digest("hex");
	return `workflows:artifact-preprocess-workload:${digest}`;
}

/** Checks that the controller presented the exact task receipt saved with this job. */
function _TaskMatches(job: _PreprocessJob, task: IWorkflowTaskReceipt): boolean
{
	return job.taskId === task.taskId
		&& job.taskName === task.taskName
		&& task.taskName === ArtifactPreprocessTaskNames.Convert
		&& job.taskKey === task.idempotencyKey;
}

/** Checks the immutable source still belongs to the supported PDF pipeline. */
function _IsEligible(job: _PreprocessJob): boolean
{
	return job.pipelineVersion === _PIPELINE_VERSION
		&& job.sourceRevision.state === ArtifactRevisionState.Published
		&& job.sourceRevision.mediaType === "application/pdf"
		&& job.sourceRevision.artifact.state === ArtifactState.Active;
}

/** Maps one database-issued delivery to the shared runtime claim contract. */
function _Record(job: _PreprocessJob): ArtifactPreprocessControllerRecord | null
{
	if (job.claimFence === null || job.claimedAt === null || job.claimExpiresAt === null || job.profileName !== _PROFILE_NAME || job.deliveryCount < 1)
	{
		return null;
	}
	return {
		preprocessJobId: job.id,
		siloId: job.sourceRevision.artifact.siloId,
		claim: {
			claimId: job.claimFence,
			siloId: job.sourceRevision.artifact.siloId,
			workloadClass: RuntimeWorkloadClaimClasses.ArtifactPreprocess,
			profileName: job.profileName,
			idempotencyKey: _ClaimKey(job.id),
			executionReference: job.id,
			claimedAt: job.claimedAt.toISOString(),
			deliveryCount: job.deliveryCount,
			expiresAt: job.claimExpiresAt.toISOString(),
		},
	};
}

/** Checks one Job or Pod binding against the current server-owned delivery. */
function _BindingMatches(job: _PreprocessJob, task: IWorkflowTaskReceipt, command: ArtifactPreprocessWorkloadBindCommand | ArtifactPreprocessPodBindCommand): boolean
{
	const binding = command.binding;
	return _TaskMatches(job, task)
		&& job.claimFence === binding.claimId
		&& job.profileName === binding.profileName
		&& job.claimedAt?.toISOString() === binding.claimedAt
		&& job.deliveryCount === binding.deliveryCount
		&& job.claimExpiresAt !== null;
}

/** Accepts one bounded Kubernetes namespace and no path-like or mixed-case value. */
function _IsNamespace(value: string): boolean
{
	return value.length <= 63 && /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/u.test(value);
}

/** Accepts the digest shape used for server-owned completion inbox identities. */
function _IsCompletionDigest(value: string): boolean
{
	return /^sha256:[a-f0-9]{64}$/u.test(value);
}

/** Owns task-fenced controller claims and bindings inside one existing transaction. */
export class PrismaArtifactPreprocessControllerRepository implements ArtifactPreprocessControllerAuthority
{
	/** Holds the caller-owned transaction for exactly one authority operation. */
	private readonly transaction: Prisma.TransactionClient;

	/** Uses the transaction opened by the artifact preprocessing unit of work. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Issues or reloads the database-clock delivery for the exact admitted workflow task. */
	async claimForTask(preprocessJobId: string, task: IWorkflowTaskReceipt): Promise<ArtifactPreprocessControllerRecord | null>
	{
		let job = await this._Job(preprocessJobId);
		if (job === null || !_TaskMatches(job, task) || !_IsEligible(job) || job.completionDigest !== null)
		{
			return null;
		}
		const now = await this._DatabaseNow();
		if (job.state === ArtifactPreprocessJobState.Claimed && job.claimExpiresAt !== null && job.claimExpiresAt > now)
		{
			return _Record(job);
		}
		const retryReady = job.state === ArtifactPreprocessJobState.RetryableFailed && job.nextAttemptAt !== null && job.nextAttemptAt <= now;
		const expired = job.state === ArtifactPreprocessJobState.Claimed && job.claimExpiresAt !== null && job.claimExpiresAt <= now;
		if (job.state !== ArtifactPreprocessJobState.Pending && !retryReady && !expired)
		{
			return null;
		}

		// 1. Reserve the controller delivery before allocating its hidden generated artifact.
		const derivedArtifactId = job.derivedArtifactId ?? randomUUID();
		const claimFence = randomUUID();
		const deliveryCount = job.deliveryCount + 1;
		const claimExpiresAt = new Date(now.getTime() + _CLAIM_LIFETIME_MILLISECONDS);
		const changed = await this.transaction.artifactPreprocessJob.updateMany({
			where: { id: job.id, state: job.state, taskId: job.taskId, taskName: job.taskName, taskKey: job.taskKey, deliveryCount: job.deliveryCount, claimFence: job.claimFence },
			data: { state: ArtifactPreprocessJobState.Claimed, claimFence, profileName: _PROFILE_NAME, claimedAt: now, deliveryCount, claimExpiresAt, workloadUid: null, firstPodUid: null, bootstrapReferenceHash: null, bootstrapNamespace: null, outputLeaseId: null, nextAttemptAt: null, failureCode: null },
		});
		if (changed.count !== 1)
		{
			return null;
		}
		// 2. Only the compare-and-swap winner creates and attaches the generated output identity.
		if (job.derivedArtifactId === null)
		{
			await this.transaction.artifact.create({ data: { id: derivedArtifactId, siloId: job.sourceRevision.artifact.siloId, ownerPrincipalId: job.sourceRevision.artifact.ownerPrincipalId, kind: ArtifactKind.Generated } });
			await this.transaction.artifactPreprocessJob.update({ where: { id: job.id }, data: { derivedArtifactId } });
		}
		job = await this._Job(preprocessJobId);
		return job === null ? null : _Record(job);
	}

	/** Binds the immutable Job UID and hashed bootstrap reference to the current delivery. */
	async bindWorkload(preprocessJobId: string, task: IWorkflowTaskReceipt, command: ArtifactPreprocessWorkloadBindCommand): Promise<"bound" | "idempotent" | "conflict">
	{
		if (!_IsNamespace(command.namespace) || command.binding.profileName !== _PROFILE_NAME || command.binding.workloadUid.trim().length === 0 || !__IsArtifactPreprocessBootstrapReference(command.bootstrapReference) || command.bootstrapReference !== await __CreateArtifactPreprocessBootstrapReference(preprocessJobId))
		{
			return "conflict";
		}
		const job = await this._Job(preprocessJobId);
		if (job === null || job.state !== ArtifactPreprocessJobState.Claimed || !_BindingMatches(job, task, command) || !await this._IsActive(job))
		{
			return "conflict";
		}
		const referenceHash = await __HashArtifactPreprocessBootstrapReference(command.bootstrapReference);
		if (job.workloadUid !== null)
		{
			return job.workloadUid === command.binding.workloadUid && job.bootstrapReferenceHash === referenceHash && job.bootstrapNamespace === command.namespace
				? "idempotent"
				: "conflict";
		}
		const changed = await this.transaction.artifactPreprocessJob.updateMany({
			where: { id: job.id, state: ArtifactPreprocessJobState.Claimed, claimFence: job.claimFence, claimedAt: job.claimedAt, deliveryCount: job.deliveryCount, claimExpiresAt: job.claimExpiresAt, workloadUid: null },
			data: { workloadUid: command.binding.workloadUid, bootstrapReferenceHash: referenceHash, bootstrapNamespace: command.namespace },
		});
		return changed.count === 1 ? "bound" : "conflict";
	}

	/** Binds the immutable first Pod UID only beneath the Job accepted for this delivery. */
	async bindFirstPod(preprocessJobId: string, task: IWorkflowTaskReceipt, command: ArtifactPreprocessPodBindCommand): Promise<"bound" | "idempotent" | "conflict">
	{
		if (command.binding.firstPodUid === undefined || command.binding.firstPodUid.trim().length === 0)
		{
			return "conflict";
		}
		const job = await this._Job(preprocessJobId);
		if (job === null || job.state !== ArtifactPreprocessJobState.Claimed || !_BindingMatches(job, task, command) || job.workloadUid !== command.binding.workloadUid || !await this._IsActive(job))
		{
			return "conflict";
		}
		if (job.firstPodUid !== null)
		{
			return job.firstPodUid === command.binding.firstPodUid ? "idempotent" : "conflict";
		}
		const changed = await this.transaction.artifactPreprocessJob.updateMany({
			where: { id: job.id, state: ArtifactPreprocessJobState.Claimed, claimFence: job.claimFence, claimedAt: job.claimedAt, deliveryCount: job.deliveryCount, claimExpiresAt: job.claimExpiresAt, workloadUid: command.binding.workloadUid, firstPodUid: null },
			data: { firstPodUid: command.binding.firstPodUid },
		});
		return changed.count === 1 ? "bound" : "conflict";
	}

	/** Exchanges a mounted reference for its active, fully bound worker delivery. */
	async loadWorkerBootstrap(reference: string, namespace: string): Promise<ArtifactPreprocessorJobClaim | null>
	{
		if (!__IsArtifactPreprocessBootstrapReference(reference) || !_IsNamespace(namespace))
		{
			return null;
		}
		const bootstrapReferenceHash = await __HashArtifactPreprocessBootstrapReference(reference);
		const job = await this.transaction.artifactPreprocessJob.findUnique({ where: { bootstrapReferenceHash }, select: _PREPROCESS_SELECT });
		if (job === null
			|| job.state !== ArtifactPreprocessJobState.Claimed
			|| job.bootstrapNamespace !== namespace
			|| job.workloadUid === null
			|| job.firstPodUid === null
			|| job.claimFence === null
			|| job.claimExpiresAt === null
			|| job.deliveryCount < 1
			|| !_IsEligible(job)
			|| job.sourceRevision.byteLength < 1n
			|| job.sourceRevision.byteLength > BigInt(Number.MAX_SAFE_INTEGER)
			|| !await this._IsActive(job))
		{
			return null;
		}
		return {
			lease: { jobId: job.id, attempt: job.deliveryCount, claimFence: job.claimFence, expiresAt: job.claimExpiresAt.toISOString() },
			sourceMediaType: "application/pdf",
			sourceByteLength: Number(job.sourceRevision.byteLength),
		};
	}

	/** Loads only the completion inbox entry owned by the admitted task receipt. */
	async loadCompletion(preprocessJobId: string, completionDigest: string, task: IWorkflowTaskReceipt): Promise<ArtifactPreprocessCompletion | null>
	{
		const job = await this._Job(preprocessJobId);
		return job !== null && _TaskMatches(job, task) && _IsCompletionDigest(completionDigest) && job.completionDigest === completionDigest
			? { preprocessJobId, completionDigest }
			: null;
	}

	/** Consumes the matching inbox entry and makes the preprocessing job terminal exactly once. */
	async complete(preprocessJobId: string, completion: ArtifactPreprocessCompletion, task: IWorkflowTaskReceipt): Promise<"completed" | "idempotent" | "conflict">
	{
		const job = await this._Job(preprocessJobId);
		if (job === null || completion.preprocessJobId !== job.id || !_TaskMatches(job, task) || !_IsCompletionDigest(completion.completionDigest) || job.completionDigest !== completion.completionDigest)
		{
			return "conflict";
		}
		if (job.state === ArtifactPreprocessJobState.Completed && job.completionConsumedAt !== null)
		{
			return "idempotent";
		}
		if (job.state !== ArtifactPreprocessJobState.Claimed || job.workloadUid === null || job.firstPodUid === null || job.completionConsumedAt !== null)
		{
			return "conflict";
		}
		const now = await this._DatabaseNow();
		const changed = await this.transaction.artifactPreprocessJob.updateMany({
			where: { id: job.id, state: ArtifactPreprocessJobState.Claimed, taskId: job.taskId, completionDigest: job.completionDigest, completionConsumedAt: null, workloadUid: job.workloadUid, firstPodUid: job.firstPodUid },
			data: { state: ArtifactPreprocessJobState.Completed, completionConsumedAt: now, completedAt: now },
		});
		return changed.count === 1 ? "completed" : "conflict";
	}

	/** Loads the task and delivery projection inside this transaction. */
	private _Job(preprocessJobId: string): Promise<_PreprocessJob | null>
	{
		return this.transaction.artifactPreprocessJob.findUnique({ where: { id: preprocessJobId }, select: _PREPROCESS_SELECT });
	}

	/** Reads whether the current claim remains live according to the database clock. */
	private async _IsActive(job: _PreprocessJob): Promise<boolean>
	{
		return job.claimExpiresAt !== null && job.claimExpiresAt > await this._DatabaseNow();
	}

	/** Reads the shared database clock used by every artifact lease decision. */
	private async _DatabaseNow(): Promise<Date>
	{
		const clock = await this.transaction.artifactAuthorityClock.findUnique({ where: { singleton: 1 }, select: { now: true } });
		if (clock === null || !(clock.now instanceof Date) || Number.isNaN(clock.now.getTime()))
		{
			throw new Error("artifact authority database clock unavailable");
		}
		return clock.now;
	}
}
