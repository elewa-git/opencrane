import { EventEmitter } from "node:events";
import { access, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { ConversationComputerRealizationKinds } from "@opencrane/contracts";

import { HostConversationComputerProcessOwner } from "../host-conversation-computer-process-owner";
import type { HostConversationComputerSpawn } from "../host-conversation-computer-process.types";

/** Keeps focused leases live without overflowing Node's timer range. */
const _EXPIRES_AT = new Date(Date.now() + 600_000).toISOString();

/** Exact app-owned command supplied to the infrastructure package during focused tests. */
const _LAUNCH = { executable: "test-python", arguments: ["-m", "test.entrypoint"], workingDirectory: "/workspace/test-app" };

/** Refuses an unexpected process start in coordinate-only tests. */
const _UNUSED_SPAWN: HostConversationComputerSpawn = function _UnusedSpawn(): never { throw new Error("unexpected process start"); };

/** Returns the reservation shared by one focused host-process test. */
function _Reservation(generation = 3)
{
	return { siloId: "silo-1", computerId: "computer-1", leaseId: `lease-${generation}`, generation };
}

/** Builds a child-process double that closes when it receives a graceful signal. */
function _Child()
{
	const child = new EventEmitter();
	const kill = vi.fn(function _Kill(): boolean
	{
		child.emit("close", 0, "SIGTERM");
		return true;
	});
	return Object.assign(child, { kill });
}

describe("host conversation-computer process owner", function _Suite(): void
{
	it("derives stable non-secret coordinates per lease generation", function _Prepares(): void
	{
		const owner = new HostConversationComputerProcessOwner({ internalEndpoint: "http://127.0.0.1:8081", launch: _LAUNCH, spawnProcess: _UNUSED_SPAWN });
		const first = owner.prepare(_Reservation(3));
		const retry = owner.prepare(_Reservation(3));
		const replacement = owner.prepare(_Reservation(4));
		expect(first).toEqual(retry);
		expect(first.processId).not.toBe(replacement.processId);
		expect(first).toEqual({ processId: expect.stringMatching(/^local-computer-[a-f0-9]{32}$/u), endpoint: "http://127.0.0.1:8081" });
	});

	it("passes the bearer through a private file and authenticates its child", async function _Claims(): Promise<void>
	{
		const child = _Child();
		let childEnvironment: NodeJS.ProcessEnv | undefined;
		const spawnProcess = vi.fn(function _Spawn(_command, _arguments, options)
		{
			childEnvironment = options.env;
			queueMicrotask(function _Started(): void
			{
				child.emit("spawn");
				void writeFile(options.env.OPENCRANE_HOST_READY_PATH, options.env.OPENCRANE_COMPUTER_PROCESS_ID, "utf8");
			});
			return child;
		});
		const options = { internalEndpoint: "http://127.0.0.1:8081", launch: _LAUNCH, environment: { PATH: "/bin", AWS_SECRET_ACCESS_KEY: "must-not-pass" }, randomBytes: function _Random(): Buffer { return Buffer.alloc(32, 9); }, spawnProcess };
		const owner = new HostConversationComputerProcessOwner(options);
		const reservation = _Reservation();
		const coordinates = owner.prepare(reservation);
		await expect(owner.claim({ ...reservation, coordinates, expiresAt: _EXPIRES_AT })).resolves.toEqual(coordinates);

		const tokenPath = childEnvironment?.OPENCRANE_HOST_BEARER_PATH ?? "";
		const bearer = await readFile(tokenPath, "utf8");
		expect((await stat(tokenPath)).mode & 0o777).toBe(0o600);
		expect(Buffer.from(bearer, "base64url")).toHaveLength(32);
		expect(childEnvironment).not.toHaveProperty("AWS_SECRET_ACCESS_KEY");
		expect(childEnvironment).toMatchObject({ OPENCRANE_COMPUTER_REALIZATION_KIND: ConversationComputerRealizationKinds.HostDevelopmentProcess, OPENCRANE_COMPUTER_PROCESS_ID: coordinates.processId, OPENCRANE_COMPUTER_ID: "computer-1", OPENCRANE_COMPUTER_GENERATION: "3", OPENCRANE_COMPUTER_LEASE_ID: "lease-3", OPENCRANE_INTERNAL_ENDPOINT: "http://127.0.0.1:8081" });
		expect(spawnProcess).toHaveBeenCalledWith(_LAUNCH.executable, _LAUNCH.arguments, expect.objectContaining({ cwd: _LAUNCH.workingDirectory, detached: false, stdio: "inherit" }));
		await expect(owner.authenticate(bearer)).resolves.toEqual({ processId: coordinates.processId });
		await expect(owner.authenticate(`${bearer}x`)).resolves.toBeNull();

		const lease = { computerId: "computer-1", leaseId: "lease-3", generation: 3, coordinates };
		await expect(owner.bind({ ...lease, process: { processId: coordinates.processId } })).resolves.toBe(true);
		await expect(owner.bind({ ...lease, process: { processId: "replacement" } })).resolves.toBe(false);
		await expect(owner.inspect(lease)).resolves.toEqual({ shutdownTime: _EXPIRES_AT });
		const renewedExpiry = new Date(Date.now() + 900_000).toISOString();
		await expect(owner.renew({ ...lease, expiresAt: renewedExpiry })).resolves.toBe("renewed");
		await expect(owner.inspect(lease)).resolves.toEqual({ shutdownTime: renewedExpiry });
		await expect(owner.inspect({ ...lease, leaseId: "replacement" })).rejects.toThrow("lease coordinates changed");
		await expect(owner.release({ ...lease, coordinates: { ...coordinates, endpoint: "http://127.0.0.1:9091" } })).rejects.toThrow("endpoint changed");
		await expect(owner.release(lease)).resolves.toBe("released");
		await expect(owner.inspect(lease)).resolves.toBeNull();
		await expect(owner.authenticate(bearer)).resolves.toBeNull();

		await owner.close();
		expect(child.kill).toHaveBeenCalledWith("SIGTERM");
		await expect(access(tokenPath)).rejects.toThrow();
	});

	it("releases a child when its renewed lease deadline expires", async function _Expires(): Promise<void>
	{
		const child = _Child();
		const spawnProcess = vi.fn(function _Spawn(_command, _arguments, options)
		{
			queueMicrotask(function _Started(): void
			{
				child.emit("spawn");
				void writeFile(options.env.OPENCRANE_HOST_READY_PATH, options.env.OPENCRANE_COMPUTER_PROCESS_ID, "utf8");
			});
			return child;
		});
		const owner = new HostConversationComputerProcessOwner({ internalEndpoint: "http://127.0.0.1:8081", launch: _LAUNCH, shutdownGraceMilliseconds: 1, spawnProcess });
		const reservation = _Reservation(7);
		const coordinates = owner.prepare(reservation);
		const lease = { computerId: reservation.computerId, leaseId: reservation.leaseId, generation: reservation.generation, coordinates };
		await owner.claim({ ...reservation, coordinates, expiresAt: new Date(Date.now() + 50).toISOString() });
		await new Promise<void>(function _Wait(resolve): void { setTimeout(resolve, 80); });
		await expect(owner.inspect(lease)).resolves.toBeNull();
		expect(child.kill).toHaveBeenCalledWith("SIGTERM");
	});

	it("retains an expiry cleanup failure for coordinated owner shutdown", async function _RetainsExpiryCleanupFailure(): Promise<void>
	{
		const child = _Child();
		let tokenPath = "";
		const spawnProcess = vi.fn(function _Spawn(_command, _arguments, options)
		{
			tokenPath = options.env.OPENCRANE_HOST_BEARER_PATH;
			queueMicrotask(function _Started(): void
			{
				child.emit("spawn");
				void writeFile(options.env.OPENCRANE_HOST_READY_PATH, options.env.OPENCRANE_COMPUTER_PROCESS_ID, "utf8");
			});
			return child;
		});
		const removeDirectory = vi.fn(async function _RemoveDirectory(): Promise<void> { throw new Error("token directory busy"); });
		const owner = new HostConversationComputerProcessOwner({ internalEndpoint: "http://127.0.0.1:8081", launch: _LAUNCH, removeDirectory, shutdownGraceMilliseconds: 1, spawnProcess });
		const reservation = _Reservation(8);
		const coordinates = owner.prepare(reservation);
		const lease = { computerId: reservation.computerId, leaseId: reservation.leaseId, generation: reservation.generation, coordinates };
		await owner.claim({ ...reservation, coordinates, expiresAt: new Date(Date.now() + 50).toISOString() });
		await vi.waitFor(function _ExpiryCleanupAttempted(): void { expect(removeDirectory).toHaveBeenCalledOnce(); });

		await expect(owner.inspect(lease)).resolves.toBeNull();
		await expect(owner.close()).rejects.toThrow("Host conversation-computer cleanup failed");
		expect(child.kill).toHaveBeenCalledWith("SIGTERM");
		await rm(dirname(tokenPath), { force: true, recursive: true });
	});

	it("removes the bearer when child startup fails", async function _FailedStartup(): Promise<void>
	{
		const child = _Child();
		let tokenPath = "";
		const spawnProcess = vi.fn(function _Spawn(_command, _arguments, options)
		{
			tokenPath = options.env.OPENCRANE_HOST_BEARER_PATH;
			queueMicrotask(function _Failed(): void { child.emit("error", new Error("python unavailable")); });
			return child;
		});
		const owner = new HostConversationComputerProcessOwner({ internalEndpoint: "http://127.0.0.1:8081", launch: _LAUNCH, shutdownGraceMilliseconds: 1, spawnProcess });
		const reservation = _Reservation(1);
		const coordinates = owner.prepare(reservation);
		await expect(owner.claim({ ...reservation, coordinates, expiresAt: _EXPIRES_AT })).rejects.toThrow("python unavailable");
		await expect(access(tokenPath)).rejects.toThrow();
	});

	it("rejects activation when a ready child closes before claim returns", async function _ClosedAfterReadiness(): Promise<void>
	{
		const child = _Child();
		const spawnProcess = vi.fn(function _Spawn(_command, _arguments, options)
		{
			queueMicrotask(function _StartAndClose(): void
			{
				child.emit("spawn");
				void writeFile(options.env.OPENCRANE_HOST_READY_PATH, options.env.OPENCRANE_COMPUTER_PROCESS_ID, "utf8").then(function _Close(): void { child.emit("close", 0, null); });
			});
			return child;
		});
		const owner = new HostConversationComputerProcessOwner({ internalEndpoint: "http://127.0.0.1:8081", launch: _LAUNCH, shutdownGraceMilliseconds: 1, spawnProcess });
		const reservation = _Reservation(1);
		const coordinates = owner.prepare(reservation);
		await expect(owner.claim({ ...reservation, coordinates, expiresAt: _EXPIRES_AT })).rejects.toThrow(/exited/u);
	});

	it("forces a child to stop when it ignores the graceful signal", async function _ForcesShutdown(): Promise<void>
	{
		const child = new EventEmitter();
		const kill = vi.fn(function _Kill(signal: NodeJS.Signals): boolean
		{
			if (signal === "SIGKILL")
			{
				queueMicrotask(function _Closed(): void { child.emit("close", null, "SIGKILL"); });
			}
			return true;
		});
		const processChild = Object.assign(child, { kill });
		const spawnProcess = vi.fn(function _Spawn(_command, _arguments, options)
		{
			queueMicrotask(function _Started(): void
			{
				processChild.emit("spawn");
				void writeFile(options.env.OPENCRANE_HOST_READY_PATH, options.env.OPENCRANE_COMPUTER_PROCESS_ID, "utf8");
			});
			return processChild;
		});
		const owner = new HostConversationComputerProcessOwner({ internalEndpoint: "http://127.0.0.1:8081", launch: _LAUNCH, shutdownGraceMilliseconds: 1, spawnProcess });
		const reservation = _Reservation(1);
		const coordinates = owner.prepare(reservation);
		await owner.claim({ ...reservation, coordinates, expiresAt: _EXPIRES_AT });
		await owner.close();
		expect(kill.mock.calls.map(call => call[0])).toEqual(["SIGTERM", "SIGKILL"]);
	});

	it("stops the child and reports failure when bearer-directory removal fails", async function _ReportsCleanupFailure(): Promise<void>
	{
		const child = _Child();
		let tokenPath = "";
		const spawnProcess = vi.fn(function _Spawn(_command, _arguments, options)
		{
			tokenPath = options.env.OPENCRANE_HOST_BEARER_PATH;
			queueMicrotask(function _Started(): void
			{
				child.emit("spawn");
				void writeFile(options.env.OPENCRANE_HOST_READY_PATH, options.env.OPENCRANE_COMPUTER_PROCESS_ID, "utf8");
			});
			return child;
		});
		const removeDirectory = vi.fn(async function _RemoveDirectory(): Promise<void> { throw new Error("token directory busy"); });
		const owner = new HostConversationComputerProcessOwner({ internalEndpoint: "http://127.0.0.1:8081", launch: _LAUNCH, randomBytes: function _Random(): Buffer { return Buffer.alloc(32, 4); }, removeDirectory, spawnProcess });
		const reservation = _Reservation(9);
		const coordinates = owner.prepare(reservation);
		await owner.claim({ ...reservation, coordinates, expiresAt: _EXPIRES_AT });
		const bearer = Buffer.alloc(32, 4).toString("base64url");
		await expect(owner.authenticate(bearer)).resolves.toEqual({ processId: coordinates.processId });

		await expect(owner.close()).rejects.toThrow("Host conversation-computer cleanup failed");
		expect(removeDirectory).toHaveBeenCalledOnce();
		expect(child.kill).toHaveBeenCalledWith("SIGTERM");
		await expect(owner.authenticate(bearer)).resolves.toBeNull();
		await rm(dirname(tokenPath), { force: true, recursive: true });
	});

	it("compensates the private directory when bearer setup fails before spawn", async function _CompensatesSetupFailure(): Promise<void>
	{
		const removeDirectory = vi.fn(async function _RemoveDirectory(path: string, options): Promise<void>
		{
			await rm(path, options);
		});
		const owner = new HostConversationComputerProcessOwner({
			internalEndpoint: "http://127.0.0.1:8081",
			launch: _LAUNCH,
			randomBytes: function _FailRandomBytes(): never { throw new Error("random source unavailable"); },
			removeDirectory,
			spawnProcess: _UNUSED_SPAWN,
		});
		const reservation = _Reservation(10);
		const coordinates = owner.prepare(reservation);

		await expect(owner.claim({ ...reservation, coordinates, expiresAt: _EXPIRES_AT })).rejects.toThrow("random source unavailable");
		expect(removeDirectory).toHaveBeenCalledOnce();
		expect(removeDirectory.mock.calls[0][0]).toMatch(/opencrane-conversation-computer-/u);
	});

	it("retains both startup and token-cleanup failures", async function _RetainsStartupAndCleanupFailures(): Promise<void>
	{
		const child = _Child();
		let tokenPath = "";
		const spawnProcess = vi.fn(function _Spawn(_command, _arguments, options)
		{
			tokenPath = options.env.OPENCRANE_HOST_BEARER_PATH;
			queueMicrotask(function _Failed(): void { child.emit("error", new Error("python unavailable")); });
			return child;
		});
		const removeDirectory = vi.fn(async function _RemoveDirectory(): Promise<void> { throw new Error("token directory busy"); });
		const owner = new HostConversationComputerProcessOwner({ internalEndpoint: "http://127.0.0.1:8081", launch: _LAUNCH, removeDirectory, spawnProcess });
		const reservation = _Reservation(11);
		const coordinates = owner.prepare(reservation);

		let failure: unknown;
		try
		{
			await owner.claim({ ...reservation, coordinates, expiresAt: _EXPIRES_AT });
		}
		catch (error)
		{
			failure = error;
		}
		expect(failure).toBeInstanceOf(AggregateError);
		const aggregate = failure as AggregateError;
		expect(aggregate.errors[0]).toMatchObject({ message: "python unavailable" });
		expect(aggregate.errors[1]).toMatchObject({ message: expect.stringContaining("cleanup failed") });
		expect(child.kill).toHaveBeenCalledWith("SIGTERM");
		await rm(dirname(tokenPath), { force: true, recursive: true });
	});

	it("surfaces retained bearer cleanup failure after an unexpected child exit", async function _UnexpectedExitCleanupFailure(): Promise<void>
	{
		const child = _Child();
		let tokenPath = "";
		const spawnProcess = vi.fn(function _Spawn(_command, _arguments, options)
		{
			tokenPath = options.env.OPENCRANE_HOST_BEARER_PATH;
			queueMicrotask(function _Started(): void
			{
				child.emit("spawn");
				void writeFile(options.env.OPENCRANE_HOST_READY_PATH, options.env.OPENCRANE_COMPUTER_PROCESS_ID, "utf8");
			});
			return child;
		});
		const removeDirectory = vi.fn(async function _RemoveDirectory(): Promise<void> { throw new Error("token directory busy"); });
		const owner = new HostConversationComputerProcessOwner({ internalEndpoint: "http://127.0.0.1:8081", launch: _LAUNCH, randomBytes: function _Random(): Buffer { return Buffer.alloc(32, 5); }, removeDirectory, spawnProcess });
		const reservation = _Reservation(12);
		const coordinates = owner.prepare(reservation);
		await owner.claim({ ...reservation, coordinates, expiresAt: _EXPIRES_AT });
		const bearer = Buffer.alloc(32, 5).toString("base64url");

		child.emit("close", 1, null);
		await vi.waitFor(function _CleanupAttempted(): void { expect(removeDirectory).toHaveBeenCalledOnce(); });
		await expect(owner.authenticate(bearer)).resolves.toBeNull();
		await expect(owner.inspect({ ...reservation, coordinates })).resolves.toBeNull();
		await expect(owner.claim({ ...reservation, coordinates, expiresAt: _EXPIRES_AT })).rejects.toThrow("cleanup failed");
		await expect(owner.close()).rejects.toThrow("Host conversation-computer cleanup failed");
		expect(child.kill).not.toHaveBeenCalled();
		await rm(dirname(tokenPath), { force: true, recursive: true });
	});
});
