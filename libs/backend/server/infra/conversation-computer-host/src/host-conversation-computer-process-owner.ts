import { spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ConversationComputerRealizationKinds } from "@opencrane/contracts";

import { _HostConversationComputerBearerDigest, _HostConversationComputerChildEnvironment, _HostConversationComputerDelay, _HostConversationComputerProcessId, _WaitForHostConversationComputerReadiness } from "./host-conversation-computer-process-support";
import type { HostConversationComputerChild, HostConversationComputerProcessBindingCommand, HostConversationComputerProcessClaimCommand, HostConversationComputerProcessCommand, HostConversationComputerProcessCoordinates, HostConversationComputerProcessIdentity, HostConversationComputerProcessOwnerOptions, HostConversationComputerProcessRenewCommand, HostConversationComputerProcessReservation, HostConversationComputerProcessStatus } from "./host-conversation-computer-process.types";

/** Prefixes private credential directories owned by workstation children. */
const _TOKEN_DIRECTORY_PREFIX = join(tmpdir(), "opencrane-conversation-computer-");

/** Names the file through which the child reads its private server bearer. */
const _TOKEN_FILE_NAME = "server-bearer";

/** Gives a child this long to handle each shutdown signal before cleanup continues. */
const _DEFAULT_SHUTDOWN_GRACE_MILLISECONDS = 2_000;

/** Keeps one live child and the evidence needed to authenticate and stop it. */
interface _HostProcessEntry
{
	/** Carries the bearer digest retained by the server instead of the bearer itself. */
	readonly bearerDigest: Buffer;
	/** Carries the child-process handle. */
	readonly child: HostConversationComputerChild;
	/** Identifies the computer that owns this process. */
	readonly computerId: string;
	/** Records the lease deadline currently applied to the shutdown timer. */
	expiresAt: string;
	/** Fences the process to one computer generation. */
	readonly generation: number;
	/** Identifies the lease that created this process. */
	readonly leaseId: string;
	/** Identifies the process without carrying its authentication secret. */
	readonly processId: string;
	/** Resolves after the child validates its configuration and writes its process marker. */
	readonly startup: Promise<void>;
	/** Stops the child when the current lease deadline arrives. */
	shutdownTimer: NodeJS.Timeout | null;
	/** Owns the private bearer file and its parent directory. */
	readonly tokenDirectory: string;
	/** Shares one cleanup attempt among release, expiry, child-close, and owner-close paths. */
	stop: Promise<void> | null;
}

/**
 * Owns workstation conversation-computer children and their private bearer credentials.
 *
 * The owner retains process state but no product history. Every operation must match the persisted
 * lease coordinates, and failed credential or child cleanup remains visible to coordinated shutdown.
 */
export class HostConversationComputerProcessOwner
{
	/** Persists no product state; this map contains children owned by the current server process. */
	private readonly entries = new Map<string, _HostProcessEntry>();

	/** Shares one startup attempt among concurrent retries of the same process. */
	private readonly starts = new Map<string, Promise<_HostProcessEntry>>();

	/** Supplies the loopback endpoint and replaceable operating-system effects. */
	public constructor(private readonly options: HostConversationComputerProcessOwnerOptions) {}

	/** Derives non-secret coordinates that the caller can record before starting a child. */
	public prepare(command: HostConversationComputerProcessReservation): HostConversationComputerProcessCoordinates
	{
		this._AssertLoopbackEndpoint();
		return { processId: _HostConversationComputerProcessId(command), endpoint: this.options.internalEndpoint };
	}

	/** Starts or observes the child reserved by the supplied coordinates. */
	public async claim(command: HostConversationComputerProcessClaimCommand): Promise<HostConversationComputerProcessCoordinates>
	{
		this._AssertPrepared(command);
		const existing = this.entries.get(command.coordinates.processId);
		if (existing !== undefined)
		{
			this._AssertEntry(existing, command.computerId, command.leaseId, command.generation);
			await existing.startup;
			if (existing.stop !== null)
			{
				await existing.stop;
				throw new Error("Host conversation computer is no longer active");
			}
			return command.coordinates;
		}
		let start = this.starts.get(command.coordinates.processId);
		if (start === undefined)
		{
			start = this._Start(command);
			this.starts.set(command.coordinates.processId, start);
		}
		let entry: _HostProcessEntry;
		try
		{
			entry = await start;
		}
		finally
		{
			this.starts.delete(command.coordinates.processId);
		}
		try
		{
			await entry.startup;
			if (this.entries.get(entry.processId) !== entry || entry.stop !== null)
			{
				throw new Error("Host conversation computer exited before activation");
			}
			this._ScheduleShutdown(entry, command.expiresAt);
			return command.coordinates;
		}
		catch (error)
		{
			try
			{
				await this._Stop(entry);
			}
			catch (cleanupFailure)
			{
				throw new AggregateError([error, cleanupFailure], "Host conversation computer startup and cleanup failed");
			}
			throw error;
		}
	}

	/** Reads the shutdown deadline applied to the selected live child. */
	public async inspect(command: HostConversationComputerProcessCommand): Promise<HostConversationComputerProcessStatus | null>
	{
		const entry = this._Entry(command);
		return entry === null || entry.stop !== null ? null : { shutdownTime: entry.expiresAt };
	}

	/** Moves the selected child's shutdown deadline without changing its identity. */
	public async renew(command: HostConversationComputerProcessRenewCommand): Promise<"renewed" | "absent">
	{
		const entry = this._Entry(command);
		if (entry === null)
		{
			return "absent";
		}
		this._ScheduleShutdown(entry, command.expiresAt);
		return "renewed";
	}

	/** Stops the child selected by the complete lease fence. */
	public async release(command: HostConversationComputerProcessCommand): Promise<"released" | "absent">
	{
		const entry = this._Entry(command);
		if (entry === null)
		{
			return "absent";
		}
		await this._Stop(entry);
		return "released";
	}

	/** Checks that an authenticated process identity matches the selected child. */
	public async bind(command: HostConversationComputerProcessBindingCommand): Promise<boolean>
	{
		const entry = this._Entry(command);
		return entry !== null && entry.processId === command.process.processId;
	}

	/** Resolves a private bearer to the process that owns it. */
	public async authenticate(bearer: string): Promise<HostConversationComputerProcessIdentity | null>
	{
		if (!bearer || bearer !== bearer.trim())
		{
			return null;
		}
		const digest = _HostConversationComputerBearerDigest(bearer);
		for (const entry of this.entries.values())
		{
			if (entry.stop === null && entry.bearerDigest.length === digest.length && timingSafeEqual(entry.bearerDigest, digest))
			{
				return { processId: entry.processId };
			}
		}
		return null;
	}

	/** Attempts to stop every owned child, remove every bearer directory, and report all failures. */
	public async close(): Promise<void>
	{
		const stops = Array.from(this.entries.values()).map(entry => this._Stop(entry));
		const results = await Promise.allSettled(stops);
		const failures = results.flatMap(result => result.status === "rejected" ? [result.reason] : []);
		if (failures.length > 0)
		{
			throw new AggregateError(failures, "Host conversation-computer cleanup failed");
		}
	}

	/** Starts one Python child after creating its private bearer file. */
	private async _Start(command: HostConversationComputerProcessClaimCommand): Promise<_HostProcessEntry>
	{
		const tokenDirectory = await mkdtemp(_TOKEN_DIRECTORY_PREFIX);
		const tokenPath = join(tokenDirectory, _TOKEN_FILE_NAME);
		const readinessPath = join(tokenDirectory, "ready");
		let child: HostConversationComputerChild;
		let bearer: string;
		try
		{
			await chmod(tokenDirectory, 0o700);
			bearer = (this.options.randomBytes ?? randomBytes)(32).toString("base64url");
			await writeFile(tokenPath, bearer, { encoding: "utf8", flag: "wx", mode: 0o600 });
			const environment = {
				..._HostConversationComputerChildEnvironment(this.options.environment ?? process.env),
				OPENCRANE_COMPUTER_REALIZATION_KIND: ConversationComputerRealizationKinds.HostDevelopmentProcess,
				OPENCRANE_COMPUTER_PROCESS_ID: command.coordinates.processId,
				OPENCRANE_COMPUTER_ID: command.computerId,
				OPENCRANE_COMPUTER_GENERATION: String(command.generation),
				OPENCRANE_COMPUTER_LEASE_ID: command.leaseId,
				OPENCRANE_INTERNAL_ENDPOINT: command.coordinates.endpoint,
				OPENCRANE_HOST_BEARER_PATH: tokenPath,
				OPENCRANE_HOST_READY_PATH: readinessPath,
			};
			const spawnProcess = this.options.spawnProcess ?? function _Spawn(executable, argumentsList, options): HostConversationComputerChild { return spawn(executable, argumentsList, options); };
			child = spawnProcess(this.options.launch.executable, [...this.options.launch.arguments], { cwd: this.options.launch.workingDirectory, detached: false, env: environment, stdio: "inherit" });
		}
		catch (error)
		{
			try
			{
				await this._RemoveTokenDirectory(tokenDirectory);
			}
			catch (cleanupFailure)
			{
				throw new AggregateError([error, cleanupFailure], "Host conversation-computer credential setup and cleanup failed");
			}
			throw error;
		}
		const spawned = new Promise<void>(function _Started(resolve, reject): void
		{
			let settled = false;
			/** Resolves after Node reports that the child exists. */
			function _Resolve(): void
			{
				if (settled)
				{
					return;
				}
				settled = true;
				resolve();
			}
			/** Rejects when Node cannot start the child. */
			function _Reject(error: Error): void
			{
				if (settled)
				{
					return;
				}
				settled = true;
				reject(error);
			}
			child.once("spawn", _Resolve);
			child.once("error", _Reject);
		});
		const startup = spawned.then(function _WaitForReadinessMarker(): Promise<void> { return _WaitForHostConversationComputerReadiness(child, readinessPath, command.coordinates.processId); });
		startup.catch(function _IgnoreUntilClaim(): void {});
		const entry: _HostProcessEntry = { bearerDigest: _HostConversationComputerBearerDigest(bearer), child, computerId: command.computerId, expiresAt: command.expiresAt, generation: command.generation, leaseId: command.leaseId, processId: command.coordinates.processId, shutdownTimer: null, startup, stop: null, tokenDirectory };
		this.entries.set(entry.processId, entry);
		const owner = this;
		child.once("close", function _Closed(): void { void owner._Stop(entry, false).catch(function _RetainCleanupFailure(): void {}); });
		return entry;
	}

	/** Applies one validated lease deadline to the child. */
	private _ScheduleShutdown(entry: _HostProcessEntry, expiresAt: string): void
	{
		const expiresAtEpochMilliseconds = Date.parse(expiresAt);
		if (!Number.isFinite(expiresAtEpochMilliseconds))
		{
			throw new Error("Host conversation computer requires a valid lease deadline");
		}
		if (entry.shutdownTimer !== null)
		{
			clearTimeout(entry.shutdownTimer);
		}
		entry.expiresAt = expiresAt;
		const delay = Math.max(0, expiresAtEpochMilliseconds - Date.now());
		const owner = this;
		entry.shutdownTimer = setTimeout(function _Expired(): void { void owner._Stop(entry).catch(function _RetainCleanupFailure(): void {}); }, delay);
		entry.shutdownTimer.unref();
	}

	/** Shares one cleanup attempt across every caller that stops the selected entry. */
	private async _Stop(entry: _HostProcessEntry, signalChild = true): Promise<void>
	{
		if (entry.stop !== null)
		{
			return entry.stop;
		}
		entry.stop = this._StopOnce(entry, signalChild);
		return entry.stop;
	}

	/** Revokes the bearer, then independently removes it and stops the child. */
	private async _StopOnce(entry: _HostProcessEntry, signalChild: boolean): Promise<void>
	{
		if (entry.shutdownTimer !== null)
		{
			clearTimeout(entry.shutdownTimer);
			entry.shutdownTimer = null;
		}
		const closed = new Promise<boolean>(function _Waiting(resolve): void
		{
			entry.child.once("close", function _Closed(): void { resolve(true); });
		});
		const failures: unknown[] = [];
		try
		{
			await this._RemoveTokenDirectory(entry.tokenDirectory);
		}
		catch (error)
		{
			failures.push(error);
		}
		try
		{
			if (signalChild)
			{
				entry.child.kill("SIGTERM");
				const grace = this.options.shutdownGraceMilliseconds ?? _DEFAULT_SHUTDOWN_GRACE_MILLISECONDS;
				if (!await Promise.race([closed, _HostConversationComputerDelay(grace)]))
				{
					entry.child.kill("SIGKILL");
					await Promise.race([closed, _HostConversationComputerDelay(grace)]);
				}
			}
		}
		catch (error)
		{
			failures.push(error);
		}
		if (failures.length === 0 && this.entries.get(entry.processId) === entry)
		{
			this.entries.delete(entry.processId);
		}
		if (failures.length > 0)
		{
			throw new AggregateError(failures, `Host conversation computer ${entry.processId} cleanup failed`);
		}
	}

	/** Removes one private bearer directory through the replaceable operating-system boundary. */
	private _RemoveTokenDirectory(tokenDirectory: string): Promise<void>
	{
		return (this.options.removeDirectory ?? rm)(tokenDirectory, { force: true, recursive: true });
	}

	/** Resolves the entry selected by one persisted host-process coordinate set. */
	private _Entry(command: HostConversationComputerProcessCommand): _HostProcessEntry | null
	{
		if (command.coordinates.endpoint !== this.options.internalEndpoint)
		{
			throw new Error("Host conversation computer endpoint changed");
		}
		const entry = this.entries.get(command.coordinates.processId) ?? null;
		if (entry !== null)
		{
			this._AssertEntry(entry, command.computerId, command.leaseId, command.generation);
		}
		return entry;
	}

	/** Requires an entry to belong to all durable lease coordinates. */
	private _AssertEntry(entry: _HostProcessEntry, computerId: string, leaseId: string, generation: number): void
	{
		if (entry.computerId !== computerId || entry.leaseId !== leaseId || entry.generation !== generation)
		{
			throw new Error("Host conversation computer lease coordinates changed");
		}
	}

	/** Requires claimed coordinates to match the deterministic reservation. */
	private _AssertPrepared(command: HostConversationComputerProcessClaimCommand): void
	{
		const prepared = this.prepare(command);
		if (prepared.processId !== command.coordinates.processId || prepared.endpoint !== command.coordinates.endpoint)
		{
			throw new Error("Host conversation computer coordinates changed after reservation");
		}
	}

	/** Refuses any endpoint that could expose the private child listener off loopback. */
	private _AssertLoopbackEndpoint(): void
	{
		const endpoint = new URL(this.options.internalEndpoint);
		if (endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1" && endpoint.hostname !== "localhost" || endpoint.username || endpoint.password)
		{
			throw new Error("Host conversation computer endpoint must use loopback HTTP without credentials");
		}
	}
}
