import { randomUUID } from "node:crypto";

import { ArtifactRevisionState, ArtifactScanJobState, ArtifactState, type Prisma } from "@prisma/client";

import { ___IsSha256ContentAddress } from "@opencrane/models/artifacts";

import { ArtifactScannerVerdict, type ArtifactScannerFailureCommand, type ArtifactScannerJobClaim, type ArtifactScannerResultCommand } from "@opencrane/contracts";

import { ConversationAssetScanLifecycleStates, type ArtifactScanRepository, type ArtifactScanSourceRead, type ConversationAssetScanLifecycleRepository } from "./artifact-scanning.types.js";

/** Transaction-scoped scan job and quarantine publication repository. */
export class PrismaArtifactScanRepository implements ArtifactScanRepository
{
	/** Transaction client fixed to one surrounding unit of work. */
	private readonly transaction: Prisma.TransactionClient;
	/** Claim duration proven to cover download, scan, and result-report deadlines. */
	private readonly claimLeaseMilliseconds: number;
	/** Conversation-owned repository bound to this exact transaction. */
	private readonly conversationAssets: ConversationAssetScanLifecycleRepository;

	/** Binds every delegate to one already-open transaction. */
	constructor(transaction: Prisma.TransactionClient, claimLeaseMilliseconds: number, conversationAssets: ConversationAssetScanLifecycleRepository)
	{
		this.transaction = transaction;
		this.claimLeaseMilliseconds = claimLeaseMilliseconds;
		this.conversationAssets = conversationAssets;
	}

	/** Claims one eligible quarantined revision. */
	async claim(): Promise<ArtifactScannerJobClaim | null>
	{
		const now = await this._databaseNow();
		const job = await this.transaction.artifactScanJob.findFirst({ where: { artifactRevision: { state: ArtifactRevisionState.Quarantined }, OR: [{ state: ArtifactScanJobState.Pending }, { state: ArtifactScanJobState.RetryableFailed, nextAttemptAt: { lte: now } }, { state: ArtifactScanJobState.Claimed, claimExpiresAt: { lte: now } }] }, include: { artifactRevision: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
		if (job === null) return null;
		const attempt = job.attempt + 1;
		const claimFence = randomUUID();
		const expiresAt = new Date(now.getTime() + this.claimLeaseMilliseconds);
		const changed = await this.transaction.artifactScanJob.updateMany({ where: { id: job.id, attempt: job.attempt, state: job.state }, data: { state: ArtifactScanJobState.Claimed, attempt, claimFence, claimExpiresAt: expiresAt, nextAttemptAt: null, failureCode: null } });
		if (changed.count !== 1) throw new Error("Artifact scan claim conflict");
		return { lease: { jobId: job.id, attempt, claimFence, expiresAt: expiresAt.toISOString() }, sourceByteLength: Number(job.artifactRevision.byteLength) };
	}

	/** Resolves source metadata through the exact live fence. */
	async readSource(command: { readonly jobId: string; readonly attempt: number; readonly claimFence: string }): Promise<ArtifactScanSourceRead | null>
	{
		const now = await this._databaseNow();
		const job = await this.transaction.artifactScanJob.findFirst({ where: { id: command.jobId, state: ArtifactScanJobState.Claimed, attempt: command.attempt, claimFence: command.claimFence, claimExpiresAt: { gt: now } }, include: { artifactRevision: { include: { artifact: true } } } });
		const byteLength = job === null ? 0 : Number(job.artifactRevision.byteLength);
		if (job === null || job.claimExpiresAt === null || job.artifactRevision.state !== ArtifactRevisionState.Quarantined || job.artifactRevision.artifact.state !== ArtifactState.Active || !___IsSha256ContentAddress(job.artifactRevision.contentAddress) || !Number.isSafeInteger(byteLength) || byteLength <= 0) return null;
		const expiresAtEpochSeconds = Math.floor(job.claimExpiresAt.getTime() / 1_000);
		if (expiresAtEpochSeconds <= Math.floor(now.getTime() / 1_000)) return null;
		return {
			readLease: {
				leaseId: randomUUID(),
				siloId: job.artifactRevision.artifact.siloId,
				artifactId: job.artifactRevision.artifactId,
				artifactRevisionId: job.artifactRevision.id,
				contentAddress: job.artifactRevision.contentAddress,
				byteLength,
				mediaType: job.artifactRevision.mediaType,
				action: "artifact.read",
				expiresAtEpochSeconds,
			},
			mediaType: job.artifactRevision.mediaType,
			byteLength,
		};
	}

	/** Publishes clean bytes or terminally rejects unsafe bytes. */
	async complete(command: ArtifactScannerResultCommand): Promise<"completed" | "idempotent" | "stale">
	{
		const job = await this.transaction.artifactScanJob.findUnique({ where: { id: command.jobId }, include: { artifactRevision: true } });
		if (job === null) return "stale";
		if (job.state === ArtifactScanJobState.Clean || job.state === ArtifactScanJobState.Rejected) return "idempotent";
		const now = await this._databaseNow();
		if (job.state !== ArtifactScanJobState.Claimed || job.attempt !== command.attempt || job.claimFence !== command.claimFence || job.claimExpiresAt === null || job.claimExpiresAt <= now || job.artifactRevision.state !== ArtifactRevisionState.Quarantined) return "stale";
		if (command.verdict === ArtifactScannerVerdict.Clean) await this._publishClean(job, now);
		else await this._rejectUnsafe(job);
		const state = command.verdict === ArtifactScannerVerdict.Clean ? ArtifactScanJobState.Clean : ArtifactScanJobState.Rejected;
		await this.transaction.artifactScanJob.update({ where: { id: job.id }, data: { state, scannerVersion: command.scannerVersion, claimFence: null, claimExpiresAt: null, completedAt: now } });
		return "completed";
	}

	/** Applies bounded retry and a participant-safe terminal failure. */
	async fail(command: ArtifactScannerFailureCommand): Promise<"failed" | "idempotent" | "stale">
	{
		const job = await this.transaction.artifactScanJob.findUnique({ where: { id: command.jobId } });
		if (job === null) return "stale";
		if (job.state === ArtifactScanJobState.RetryableFailed || job.state === ArtifactScanJobState.TerminalFailed) return "idempotent";
		const now = await this._databaseNow();
		if (job.state !== ArtifactScanJobState.Claimed || job.attempt !== command.attempt || job.claimFence !== command.claimFence || job.claimExpiresAt === null || job.claimExpiresAt <= now) return "stale";
		const terminal = job.attempt >= 3;
		const state = terminal ? ArtifactScanJobState.TerminalFailed : ArtifactScanJobState.RetryableFailed;
		const nextAttemptAt = terminal ? null : new Date(now.getTime() + 5_000);
		const completedAt = terminal ? now : null;
		await this.transaction.artifactScanJob.update({ where: { id: job.id }, data: { state, claimFence: null, claimExpiresAt: null, failureCode: command.failureCode, nextAttemptAt, completedAt } });
		if (terminal) await this.conversationAssets.report({ revisionId: job.artifactRevisionId, state: ConversationAssetScanLifecycleStates.Failed, failureCode: "scan_failed" });
		return "failed";
	}

	/** Publish one clean revision and its normal derived work. */
	private async _publishClean(job: { readonly id: string; readonly artifactRevisionId: string; readonly artifactRevision: { readonly artifactId: string; readonly byteLength: bigint; readonly mediaType: string } }, _now: Date): Promise<void>
	{
		await this.transaction.artifactRevision.update({ where: { id: job.artifactRevisionId }, data: { state: ArtifactRevisionState.Published } });
		await this.transaction.artifact.update({ where: { id: job.artifactRevision.artifactId }, data: { currentRevisionId: job.artifactRevisionId } });
		await this.conversationAssets.report({ revisionId: job.artifactRevisionId, state: ConversationAssetScanLifecycleStates.Ready, failureCode: null });
		await this.transaction.artifactOutboxEvent.create({ data: { artifactId: job.artifactRevision.artifactId, revisionId: job.artifactRevisionId, kind: "RevisionPublished", idempotencyKey: `scan:${job.id}`, payload: { byteLength: Number(job.artifactRevision.byteLength), mediaType: job.artifactRevision.mediaType } } });
		if (job.artifactRevision.mediaType === "application/pdf") await this.transaction.artifactPreprocessJob.create({ data: { sourceRevisionId: job.artifactRevisionId, pipelineVersion: "pdf-to-text/v1" } });
	}

	/** Reject unsafe bytes without publishing their current pointer. */
	private async _rejectUnsafe(job: { readonly artifactRevisionId: string }): Promise<void>
	{
		await this.transaction.artifactRevision.update({ where: { id: job.artifactRevisionId }, data: { state: ArtifactRevisionState.Rejected } });
		await this.conversationAssets.report({ revisionId: job.artifactRevisionId, state: ConversationAssetScanLifecycleStates.Failed, failureCode: "unsafe_file" });
	}

	/** Read one database-owned timestamp. */
	private async _databaseNow(): Promise<Date>
	{
		const clock = await this.transaction.artifactAuthorityClock.findUnique({ where: { singleton: 1 }, select: { now: true } });
		if (clock === null) throw new Error("Artifact scan database clock unavailable");
		return clock.now;
	}
}
