import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { link, lstat, mkdir, open, stat, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { join } from "node:path";

import { __ValidateStageArtifactCommand, __ValidateStagedArtifact } from "@opencrane/backend/artifacts/store";
import type { ArtifactByteStream, ArtifactStore, ArtifactStorePromotion, ArtifactStorePurgeResult, StageArtifactCommand, StagedArtifact } from "@opencrane/backend/artifacts/store";
import { ___IsSha256ContentAddress } from "@opencrane/models/artifacts";
import type { FilesystemArtifactStoreOptions } from "./filesystem-artifact-store.types.js";

/**
 * POSIX-backed ArtifactStore adapter with private staging and atomic content-addressed promotion.
 *
 * Crash-durability model: untrusted bytes are first written and fsynced under a private
 * `staging/` directory, then published by hard-linking the staged inode at its canonical
 * `sha256/ab/<digest>` path and fsyncing that directory. A crash at any point therefore leaves the
 * store in exactly one of two states — no canonical entry, or the complete verified bytes at their
 * address. A partial file can only ever exist under `staging/`, which `read` never serves.
 *
 * Integrity model: the canonical address is computed by this adapter from the bytes it durably
 * wrote. A caller-declared digest or length is only ever cross-checked against that computation,
 * never trusted. Promotion is idempotent per address: a repeat or concurrent upload of identical
 * content succeeds against the existing object, but only after re-verifying it byte-for-byte.
 *
 * Path confinement: no caller-supplied string is ever used as a filesystem path. Staging paths
 * derive from a SHA-256 of the lease id, and canonical paths from a strictly validated
 * `sha256:<hex64>` address, so neither a lease nor an address can traverse outside `rootPath`.
 */
export class __FilesystemArtifactStore implements ArtifactStore
{
	/** Mounted volume root owned only by the artifact-service process. */
	private readonly rootPath: string;

	/** Creates an adapter rooted at one app-owned mounted volume. */
	constructor(options: FilesystemArtifactStoreOptions)
	{
		if (!options.rootPath.startsWith("/"))
		{
			throw new Error("ArtifactStore rootPath must be absolute");
		}
		this.rootPath = options.rootPath;
	}

	/** Stages untrusted bytes while computing their only accepted canonical address. */
	async stage(command: StageArtifactCommand): Promise<StagedArtifact>
	{
		if (!__ValidateStageArtifactCommand(command, Math.floor(Date.now() / 1_000)))
		{
			throw new Error("invalid or expired ArtifactStore stage command");
		}

		// 1. Create only private, deterministic staging directories under the mounted artifact volume.
		// The handle is a hash of the lease id, never the id itself, so lease content cannot shape a
		// path; "wx" + 0o600 makes a second stage of the same lease fail instead of interleaving bytes.
		await mkdir(this._stagingDirectory(), { recursive: true });
		const stagingHandle = createHash("sha256").update(command.lease.leaseId, "utf8").digest("hex");
		const stagingPath = this._stagingPath(stagingHandle);
		const file = await open(stagingPath, "wx", 0o600);
		const hash = createHash("sha256");
		let byteLength = 0;

		try
		{
			// 2. Hash and fsync every supplied chunk before accepting any promotion metadata. Promotion
			// hard-links this same inode, so the bytes must already be durable here — otherwise a crash
			// after promote() could acknowledge an address whose content never reached disk. The running
			// length check fails fast so an over-lease body stops consuming disk at the first excess chunk.
			for await (const chunk of command.bytes)
			{
				const bytes = Buffer.from(chunk);
				byteLength += bytes.byteLength;
				if (command.expectedByteLength !== null && byteLength > command.expectedByteLength)
				{
					throw new RangeError("ArtifactStore staged bytes exceed the authorized byte length");
				}
				hash.update(bytes);
				await this._writeAll(file, bytes);
			}
			await file.sync();
		}
		catch (error)
		{
			await file.close();
			await unlink(stagingPath).catch(function _ignoreMissingStagingFile() {});
			throw error;
		}
		await file.close();

		// 3. Reject a caller-supplied digest or length that does not match the durable bytes.
		const contentAddress = `sha256:${hash.digest("hex")}`;
		if ((command.expectedContentAddress !== null && command.expectedContentAddress !== contentAddress)
			|| (command.expectedByteLength !== null && command.expectedByteLength !== byteLength))
		{
			await unlink(stagingPath).catch(function _ignoreMissingStagingFile() {});
			throw new Error("ArtifactStore staged bytes do not match the authorized digest or byte length");
		}

		return { leaseId: command.lease.leaseId, stagingHandle, contentAddress, byteLength, mediaType: command.mediaType };
	}

	/** Atomically publishes staged bytes to `sha256/ab/<digest>` without overwriting a peer upload. */
	async promote(staged: StagedArtifact): Promise<ArtifactStorePromotion>
	{
		if (!__ValidateStagedArtifact(staged))
		{
			throw new Error("invalid ArtifactStore staging handle");
		}

		const sourcePath = this._stagingPath(staged.stagingHandle);
		const targetPath = this._contentPath(staged.contentAddress);
		await mkdir(this._contentDirectory(staged.contentAddress), { recursive: true });
		let created = false;
		try
		{
			// 1. Hard-linking creates the final address only when no concurrent writer already owns it.
			// Unlike rename, link(2) fails with EEXIST instead of silently replacing a peer's object,
			// so a canonical address is written exactly once and never torn by a racing promotion.
			await link(sourcePath, targetPath);
			await this._syncDirectory(this._contentDirectory(staged.contentAddress));
			created = true;
		}
		catch (error)
		{
			if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST")
			{
				throw error;
			}

			// 2. EEXIST is the idempotent-promotion path: same content already published. Never trust
			// the pathname alone — re-verify type, size, and full digest so success is only reported
			// over bytes that are provably the staged content, not a corrupt or truncated survivor.
			const existing = await lstat(targetPath);
			if (!existing.isFile() || existing.size !== staged.byteLength || await this._hashFile(targetPath) !== staged.contentAddress)
			{
				throw new Error("ArtifactStore canonical object does not match its content address");
			}
		}

		// 3. Remove only the private staging link after the canonical link is durable or confirmed
		// present. Dropping the staging link first would let a crash strand a verified-but-unpublished
		// upload with no way to retry it under the same lease.
		await unlink(sourcePath);
		return { leaseId: staged.leaseId, contentAddress: staged.contentAddress, byteLength: staged.byteLength, mediaType: staged.mediaType, created };
	}

	/** Opens immutable bytes only by a strict canonical address, never a caller-provided path. */
	async read(contentAddress: string): Promise<ArtifactByteStream | null>
	{
		if (!___IsSha256ContentAddress(contentAddress))
		{
			throw new Error("invalid ArtifactStore content address");
		}
		try
		{
			await stat(this._contentPath(contentAddress));
			return createReadStream(this._contentPath(contentAddress));
		}
		catch (error)
		{
			if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
			throw error;
		}
	}

	/** Physically purges one address after the catalog authority has completed its reference-safe gate. */
	async purge(contentAddress: string): Promise<ArtifactStorePurgeResult>
	{
		if (!___IsSha256ContentAddress(contentAddress))
		{
			throw new Error("invalid ArtifactStore content address");
		}
		try
		{
			await unlink(this._contentPath(contentAddress));
			return { purged: true };
		}
		catch (error)
		{
			if (error instanceof Error && "code" in error && error.code === "ENOENT") return { purged: false };
			throw error;
		}
	}

	/** Returns the private mounted directory for incomplete upload bytes. */
	private _stagingDirectory(): string
	{
		return join(this.rootPath, "staging");
	}

	/** Write a complete chunk even when the operating system accepts only a partial buffer. */
	private async _writeAll(file: FileHandle, bytes: Buffer): Promise<void>
	{
		let offset = 0;
		while (offset < bytes.byteLength)
		{
			const result = await file.write(bytes, offset, bytes.byteLength - offset);
			if (result.bytesWritten < 1)
			{
				throw new Error("ArtifactStore staging write made no progress");
			}
			offset += result.bytesWritten;
		}
	}

	/** Hash an existing regular file before accepting concurrent CAS promotion idempotently. */
	private async _hashFile(path: string): Promise<string>
	{
		const file = await open(path, "r");
		const hash = createHash("sha256");
		const buffer = Buffer.allocUnsafe(64 * 1024);
		try
		{
			while (true)
			{
				const result = await file.read(buffer, 0, buffer.byteLength, null);
				if (result.bytesRead === 0) break;
				hash.update(buffer.subarray(0, result.bytesRead));
			}
		}
		finally
		{
			await file.close();
		}
		return `sha256:${hash.digest("hex")}`;
	}

	/**
	 * Persist a newly linked canonical directory entry before an acknowledged promotion.
	 *
	 * fsyncing the file alone is not enough on POSIX: the new directory entry (the hard link) is
	 * durable only once the containing directory itself is fsynced. Without this, a crash after an
	 * acknowledged promotion could silently lose the canonical link while its receipt survives.
	 */
	private async _syncDirectory(directory: string): Promise<void>
	{
		const handle = await open(directory, "r");
		try
		{
			await handle.sync();
		}
		finally
		{
			await handle.close();
		}
	}

	/**
	 * Converts a deterministic internal staging handle into a path below the private staging root.
	 *
	 * The strict lowercase-hex shape is the traversal guard: a handle that round-trips through the
	 * public StagedArtifact contract can never contain `/`, `..`, or any other path syntax, so it
	 * cannot name a file outside `staging/`.
	 */
	private _stagingPath(stagingHandle: string): string
	{
		if (!/^[a-f0-9]{64}$/u.test(stagingHandle))
		{
			throw new Error("invalid ArtifactStore staging handle");
		}
		return join(this._stagingDirectory(), stagingHandle);
	}

	/** Returns the sharded directory for a strict SHA-256 content address. */
	private _contentDirectory(contentAddress: string): string
	{
		const digest = this._digest(contentAddress);
		return join(this.rootPath, "sha256", digest.slice(0, 2));
	}

	/** Returns the only permitted canonical path for a strict SHA-256 content address. */
	private _contentPath(contentAddress: string): string
	{
		const digest = this._digest(contentAddress);
		return join(this._contentDirectory(contentAddress), digest);
	}

	/**
	 * Strips the validated address prefix without accepting arbitrary filesystem path input.
	 *
	 * Every path derivation funnels through this check: only a strict `sha256:<hex64>` address ever
	 * becomes path input, which is what makes `read`, `promote`, and `purge` traversal-safe.
	 */
	private _digest(contentAddress: string): string
	{
		if (!___IsSha256ContentAddress(contentAddress))
		{
			throw new Error("invalid ArtifactStore content address");
		}
		return contentAddress.slice("sha256:".length);
	}
}
