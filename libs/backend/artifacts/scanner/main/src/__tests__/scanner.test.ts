import { describe, expect, it, vi } from "vitest";

import { ArtifactScannerVerdict } from "@opencrane/contracts";

import { __ProcessArtifactScanJob } from "../index";

describe("artifact scanner", () =>
{
	it("reports the bounded verdict through the exact claim fence", async () =>
	{
		const reportResult = vi.fn().mockResolvedValue(undefined);
		const remote = { claim: vi.fn(), readSource: vi.fn().mockResolvedValue(undefined), reportResult, reportFailure: vi.fn() };
		const scanner = { version: "clamav-1.5.2-definitions-pinned", scan: vi.fn().mockResolvedValue(ArtifactScannerVerdict.Clean) };
		const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn(), child: vi.fn() } as never;
		await __ProcessArtifactScanJob({ remote, scanner, scratchDirectory: "/tmp", maximumSourceBytes: 100, scanTimeoutMilliseconds: 1_000, pollIntervalMilliseconds: 1, logger }, { lease: { jobId: "job-1", attempt: 2, claimFence: "fence", expiresAt: new Date().toISOString() }, sourceByteLength: 20 }, new AbortController().signal);
		expect(reportResult).toHaveBeenCalledWith({ jobId: "job-1", attempt: 2, claimFence: "fence", verdict: ArtifactScannerVerdict.Clean, scannerVersion: scanner.version }, expect.any(AbortSignal));
	});

	it("reports and logs one handled scanner failure with safe coordinates", async () =>
	{
		const reportFailure = vi.fn().mockResolvedValue(undefined);
		const remote = { claim: vi.fn(), readSource: vi.fn().mockResolvedValue(undefined), reportResult: vi.fn(), reportFailure };
		const scanner = { version: "clamav-1.5.2-definitions-pinned", scan: vi.fn().mockRejectedValue(new Error("engine unavailable")) };
		const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn(), child: vi.fn() };

		await __ProcessArtifactScanJob({ remote, scanner, scratchDirectory: "/tmp", maximumSourceBytes: 100, scanTimeoutMilliseconds: 1_000, pollIntervalMilliseconds: 1, logger: logger as never }, { lease: { jobId: "job-1", attempt: 2, claimFence: "fence", expiresAt: new Date().toISOString() }, sourceByteLength: 20 }, new AbortController().signal);

		expect(reportFailure).toHaveBeenCalledWith({ jobId: "job-1", attempt: 2, claimFence: "fence", failureCode: "scanner_failed" }, expect.any(AbortSignal));
		expect(logger.warn).toHaveBeenCalledOnce();
		expect(logger.warn).toHaveBeenCalledWith({ jobId: "job-1", attempt: 2, failureCode: "scanner_failed" }, "artifact scan failed and was reported for fenced retry");
	});
});
