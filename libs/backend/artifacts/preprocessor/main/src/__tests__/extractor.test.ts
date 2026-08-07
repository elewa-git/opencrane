import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

import { _CreatePdfTextExtractor } from "../extractor.js";

vi.mock("node:child_process", function _MockChildProcess()
{
	return { spawn: vi.fn() };
});

/** Create the event and termination surface used by the Poppler adapter. */
function _Child()
{
	const child = new EventEmitter() as EventEmitter & { kill: ReturnType<typeof vi.fn> };
	child.kill = vi.fn();
	return child;
}

/** Restore timers and spawn behavior after every child-process assertion. */
afterEach(function _Restore()
{
	vi.useRealTimers();
	vi.mocked(spawn).mockReset();
});

/** Prove the production converter never interpolates input into a shell command. */
describe("PDF text extractor", function _Suite()
{
	it("spawns fixed pdftotext argv with the shell disabled by omission", async function _FixedArgv()
	{
		const child = _Child();
		vi.mocked(spawn).mockReturnValue(child as never);
		const conversion = _CreatePdfTextExtractor().extract("/scratch/source.pdf", "/scratch/output.txt", 1_000, new AbortController().signal);
		child.emit("exit", 0, null);
		await conversion;
		expect(spawn).toHaveBeenCalledWith("pdftotext", ["-enc", "UTF-8", "-nopgbrk", "/scratch/source.pdf", "/scratch/output.txt"], { stdio: "ignore" });
		expect(child.kill).not.toHaveBeenCalled();
	});

	it("rejects a nonzero converter exit and terminates the child", async function _NonzeroExit()
	{
		const child = _Child();
		vi.mocked(spawn).mockReturnValue(child as never);
		const conversion = _CreatePdfTextExtractor().extract("/scratch/source.pdf", "/scratch/output.txt", 1_000, new AbortController().signal);
		child.emit("exit", 2, null);
		await expect(conversion).rejects.toThrow("pdftotext failed with code 2");
		expect(child.kill).toHaveBeenCalledWith("SIGKILL");
	});

	it("kills and rejects a converter that exceeds its wall-clock deadline", async function _Timeout()
	{
		vi.useFakeTimers();
		const child = _Child();
		vi.mocked(spawn).mockReturnValue(child as never);
		const conversion = _CreatePdfTextExtractor().extract("/scratch/source.pdf", "/scratch/output.txt", 1_000, new AbortController().signal);
		const rejected = expect(conversion).rejects.toThrow("conversion timeout");
		await vi.advanceTimersByTimeAsync(1_000);
		await rejected;
		expect(child.kill).toHaveBeenCalledWith("SIGKILL");
	});

	it("kills and rejects the converter when the worker is aborted", async function _Abort()
	{
		const child = _Child();
		const controller = new AbortController();
		vi.mocked(spawn).mockReturnValue(child as never);
		const conversion = _CreatePdfTextExtractor().extract("/scratch/source.pdf", "/scratch/output.txt", 1_000, controller.signal);
		const rejected = expect(conversion).rejects.toThrow("aborted during conversion");
		controller.abort();
		await rejected;
		expect(child.kill).toHaveBeenCalledWith("SIGKILL");
	});
});
