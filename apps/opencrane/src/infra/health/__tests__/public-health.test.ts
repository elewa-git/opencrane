import { describe, expect, it, vi } from "vitest";

import { PublicHealthServiceNames, PublicHealthServiceStatuses, PublicHealthStatuses } from "@opencrane/contracts";

import type { PublicHealthProbe, PublicHealthReaderDependencies } from "../public-health.types";
import { _CreatePublicHealthReportReader } from "../public-health";

/** Build a deterministic probe that resolves or rejects without external I/O. */
function _Probe(available: boolean): PublicHealthProbe
{
	return { check: available ? vi.fn().mockResolvedValue(undefined) : vi.fn().mockRejectedValue(new Error("private failure")) };
}

/** Build factory inputs while retaining the probes so call counts remain observable. */
function _Dependencies(overrides: Partial<PublicHealthReaderDependencies> = {}): PublicHealthReaderDependencies
{
	return {
		database: _Probe(true),
		models: _Probe(true),
		memory: _Probe(true),
		files: _Probe(true),
		channels: _Probe(true),
		integrations: _Probe(true),
		logger: { warn: vi.fn() },
		clock: { nowEpochMilliseconds: vi.fn().mockReturnValue(1_000) },
		cacheMilliseconds: 5_000,
		...overrides,
	};
}

describe("public health report", function _Suite()
{
	it("reports every user-visible service and treats disabled integrations as healthy", async function _ReportsCompleteMap()
	{
		const dependencies = _Dependencies({ channels: null, integrations: null });
		const reader = _CreatePublicHealthReportReader(dependencies);
		await expect(reader.read()).resolves.toEqual({
			status: PublicHealthStatuses.Ok,
			ready: true,
			services: {
				[PublicHealthServiceNames.Api]: PublicHealthServiceStatuses.Available,
				[PublicHealthServiceNames.Database]: PublicHealthServiceStatuses.Available,
				[PublicHealthServiceNames.Models]: PublicHealthServiceStatuses.Available,
				[PublicHealthServiceNames.Memory]: PublicHealthServiceStatuses.Available,
				[PublicHealthServiceNames.Files]: PublicHealthServiceStatuses.Available,
				[PublicHealthServiceNames.Channels]: PublicHealthServiceStatuses.Disabled,
				[PublicHealthServiceNames.Integrations]: PublicHealthServiceStatuses.Disabled,
			},
		});
	});

	it("keeps the API ready while a user-visible optional dependency is degraded", async function _ReportsOptionalFailure()
	{
		const dependencies = _Dependencies({ memory: _Probe(false) });
		const reader = _CreatePublicHealthReportReader(dependencies);
		const report = await reader.read();
		expect(report.status).toBe(PublicHealthStatuses.Degraded);
		expect(report.ready).toBe(true);
		expect(report.services[PublicHealthServiceNames.Memory]).toBe(PublicHealthServiceStatuses.Unavailable);
		expect(dependencies.logger.warn).toHaveBeenCalledWith({ err: expect.any(Error), healthService: PublicHealthServiceNames.Memory }, "health service check failed");
	});

	it("takes the API out of readiness when the product database is unavailable", async function _ReportsDatabaseFailure()
	{
		const reader = _CreatePublicHealthReportReader(_Dependencies({ database: _Probe(false) }));
		const report = await reader.read();
		expect(report.status).toBe(PublicHealthStatuses.Degraded);
		expect(report.ready).toBe(false);
		expect(report.services[PublicHealthServiceNames.Database]).toBe(PublicHealthServiceStatuses.Unavailable);
	});

	it("coalesces dependency checks inside the bounded public cache window", async function _CachesReport()
	{
		const dependencies = _Dependencies();
		const reader = _CreatePublicHealthReportReader(dependencies);
		const first = reader.read();
		const second = reader.read();
		expect(second).toBe(first);
		await Promise.all([first, second]);
		expect(dependencies.database.check).toHaveBeenCalledOnce();
		expect(dependencies.models.check).toHaveBeenCalledOnce();
	});

	it("refreshes every service after the public cache window expires", async function _RefreshesExpiredReport()
	{
		const nowEpochMilliseconds = vi.fn().mockReturnValueOnce(1_000).mockReturnValue(6_001);
		const dependencies = _Dependencies({ clock: { nowEpochMilliseconds } });
		const reader = _CreatePublicHealthReportReader(dependencies);
		await reader.read();
		await reader.read();
		expect(dependencies.database.check).toHaveBeenCalledTimes(2);
		expect(dependencies.models.check).toHaveBeenCalledTimes(2);
	});
});
