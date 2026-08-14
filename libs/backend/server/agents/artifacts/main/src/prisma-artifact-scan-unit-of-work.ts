import { Prisma, type PrismaClient } from "@prisma/client";

import type { ArtifactScannerFailureCommand, ArtifactScannerJobClaim, ArtifactScannerResultCommand } from "@opencrane/contracts";
import { ___DoWithTrace } from "@opencrane/backend/observability";

import type { ArtifactScanRepository, ArtifactScanSourceRead, ConversationAssetScanLifecycleRepository } from "./artifact-scanning.types";
import { PrismaArtifactScanRepository } from "./prisma-artifact-scan-repository";

/** Transaction owner for each short fenced scanner lifecycle operation. */
export class PrismaArtifactScanUnitOfWork implements ArtifactScanRepository
{
	/** Canonical product database client. */
	private readonly prisma: PrismaClient;
	/** Duration of every scanner claim created by repositories in this unit of work. */
	private readonly claimLeaseMilliseconds: number;
	/** Composition-fixed constructor for the conversation repository bound to the same transaction. */
	private readonly createConversationAssets: (transaction: Prisma.TransactionClient) => ConversationAssetScanLifecycleRepository;

	/** Creates the scanner unit of work. */
	constructor(prisma: PrismaClient, claimLeaseMilliseconds: number, createConversationAssets: (transaction: Prisma.TransactionClient) => ConversationAssetScanLifecycleRepository)
	{
		if (!Number.isSafeInteger(claimLeaseMilliseconds) || claimLeaseMilliseconds < 60_000 || claimLeaseMilliseconds > 300_000) throw new Error("artifact scanner claim lease must be from 60 through 300 seconds");
		this.prisma = prisma;
		this.claimLeaseMilliseconds = claimLeaseMilliseconds;
		this.createConversationAssets = createConversationAssets;
	}

	/** Claims one job in a serializable transaction. */
	claim(): Promise<ArtifactScannerJobClaim | null> { return ___DoWithTrace("artifact.scan.claim", {}, () => this._write(function _Claim(repository) { return repository.claim(); })); }

	/** Reads a source in one repeatable snapshot. */
	readSource(command: { readonly jobId: string; readonly attempt: number; readonly claimFence: string }): Promise<ArtifactScanSourceRead | null> { return ___DoWithTrace("artifact.scan.source.authorize", { jobId: command.jobId, attempt: command.attempt }, () => this._read(function _Read(repository) { return repository.readSource(command); })); }

	/** Completes one verdict in a serializable transaction. */
	complete(command: ArtifactScannerResultCommand): Promise<"completed" | "idempotent" | "stale"> { return ___DoWithTrace("artifact.scan.result.persist", { jobId: command.jobId, attempt: command.attempt, verdict: command.verdict }, () => this._write(function _Complete(repository) { return repository.complete(command); })); }

	/** Applies one failed attempt in a serializable transaction. */
	fail(command: ArtifactScannerFailureCommand): Promise<"failed" | "idempotent" | "stale"> { return ___DoWithTrace("artifact.scan.failure.persist", { jobId: command.jobId, attempt: command.attempt, failureCode: command.failureCode }, () => this._write(function _Fail(repository) { return repository.fail(command); })); }

	/** Run one read repository operation. */
	private _read<Result>(work: (repository: PrismaArtifactScanRepository) => Promise<Result>): Promise<Result>
	{
		return this._transaction(work, Prisma.TransactionIsolationLevel.RepeatableRead);
	}

	/** Run one lifecycle mutation. */
	private _write<Result>(work: (repository: PrismaArtifactScanRepository) => Promise<Result>): Promise<Result>
	{
		return this._transaction(work, Prisma.TransactionIsolationLevel.Serializable);
	}

	/** Creates the transaction-scoped repository exactly once per operation. */
	private _transaction<Result>(work: (repository: PrismaArtifactScanRepository) => Promise<Result>, isolationLevel: Prisma.TransactionIsolationLevel): Promise<Result>
	{
		const claimLeaseMilliseconds = this.claimLeaseMilliseconds;
		const createConversationAssets = this.createConversationAssets;
		return this.prisma.$transaction(async function _Transaction(transaction)
		{
			return work(new PrismaArtifactScanRepository(transaction, claimLeaseMilliseconds, createConversationAssets(transaction)));
		}, { isolationLevel });
	}
}
