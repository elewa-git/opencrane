import { Prisma, type PrismaClient } from "@prisma/client";

import type { ArtifactScannerFailureCommand, ArtifactScannerJobClaim, ArtifactScannerResultCommand } from "@opencrane/contracts";

import type { ArtifactScanSourceRead, ArtifactScanUnitOfWork } from "./artifact-scanning.types.js";
import { PrismaArtifactScanRepository } from "./prisma-artifact-scan-repository.js";

/** Transaction owner for each short fenced scanner lifecycle operation. */
export class PrismaArtifactScanUnitOfWork implements ArtifactScanUnitOfWork
{
	private readonly prisma: PrismaClient;

	/** Creates the scanner unit of work. */
	constructor(prisma: PrismaClient) { this.prisma = prisma; }

	/** Claims one job in a serializable transaction. */
	claim(): Promise<ArtifactScannerJobClaim | null> { return this._write(function _Claim(repository) { return repository.claim(); }); }

	/** Reads a source in one repeatable snapshot. */
	readSource(command: { readonly jobId: string; readonly attempt: number; readonly claimFence: string }): Promise<ArtifactScanSourceRead | null> { return this._read(function _Read(repository) { return repository.readSource(command); }); }

	/** Completes one verdict in a serializable transaction. */
	complete(command: ArtifactScannerResultCommand): Promise<"completed" | "idempotent" | "stale"> { return this._write(function _Complete(repository) { return repository.complete(command); }); }

	/** Applies one failed attempt in a serializable transaction. */
	fail(command: ArtifactScannerFailureCommand): Promise<"failed" | "idempotent" | "stale"> { return this._write(function _Fail(repository) { return repository.fail(command); }); }

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
		return this.prisma.$transaction(async function _Transaction(transaction)
		{
			return work(new PrismaArtifactScanRepository(transaction));
		}, { isolationLevel });
	}
}
