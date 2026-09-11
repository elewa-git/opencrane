import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import { _BindDevelopmentSignalCleanup } from "../cleanup";

describe("Tier 2 process signal cleanup", function _Suite(): void
{
	it("finishes telemetry and console cleanup after a server cleanup failure", async function _ReportsCleanupFailure(): Promise<void>
	{
		const processHost = Object.assign(new EventEmitter(), { exitCode: undefined as number | undefined });
		const events: string[] = [];
		const handle = { stop: vi.fn(async function _StopServer(): Promise<void>
		{
			events.push("server");
			throw new Error("server cleanup failed");
		}) };
		const shutdownTelemetry = vi.fn(async function _StopTelemetry(): Promise<void> { events.push("telemetry"); });
		const unbindConsole = vi.fn(function _UnbindConsole(): void { events.push("console"); });
		const logger = { info: vi.fn(), error: vi.fn() };
		_BindDevelopmentSignalCleanup(handle, shutdownTelemetry, unbindConsole, processHost as never, logger as never);

		processHost.emit("SIGTERM");
		await vi.waitFor(function _FailureReported(): void { expect(logger.error).toHaveBeenCalledOnce(); });
		expect(events).toEqual(["server", "telemetry", "console"]);
		expect(processHost.exitCode).toBe(1);
		expect(logger.error.mock.calls[0][0]).toMatchObject({ err: expect.any(AggregateError), signal: "SIGTERM" });
	});
});
