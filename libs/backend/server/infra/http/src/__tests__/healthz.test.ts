import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { PublicHealthServiceNames, PublicHealthServiceStatuses, PublicHealthStatuses, type PublicHealthReport } from "@opencrane/contracts";

import { _CheckHealth, type PublicHealthReportReader, type PublicHealthRouteLogger } from "../healthz";

/** Build a minimal Express app mounting the health handler over a mocked report reader. */
function _BuildHealthApp(reader: PublicHealthReportReader, logger: PublicHealthRouteLogger = { error: vi.fn() }): express.Express
{
	const app = express();
	app.get("/healthz", _CheckHealth(reader, logger));
	return app;
}

/** Build one complete report with an overridable readiness and overall state. */
function _Report(ready: boolean, status: PublicHealthStatuses): PublicHealthReport
{
	return {
		status,
		ready,
		services: {
			[PublicHealthServiceNames.Api]: PublicHealthServiceStatuses.Available,
			[PublicHealthServiceNames.Database]: ready ? PublicHealthServiceStatuses.Available : PublicHealthServiceStatuses.Unavailable,
			[PublicHealthServiceNames.Models]: PublicHealthServiceStatuses.Available,
			[PublicHealthServiceNames.Memory]: PublicHealthServiceStatuses.Available,
			[PublicHealthServiceNames.Files]: PublicHealthServiceStatuses.Available,
			[PublicHealthServiceNames.Channels]: PublicHealthServiceStatuses.Available,
			[PublicHealthServiceNames.Integrations]: PublicHealthServiceStatuses.Disabled,
		},
	};
}

describe("_CheckHealth", function _Suite()
{
	it("returns the complete service map with 200 when the core API is ready", async function _ReturnsReadyReport()
	{
		const report = _Report(true, PublicHealthStatuses.Ok);
		const read = vi.fn().mockResolvedValue(report);
		const response = await request(_BuildHealthApp({ read })).get("/healthz");
		expect(response.status).toBe(200);
		expect(response.body).toEqual(report);
		expect(read).toHaveBeenCalledOnce();
	});

	it("keeps optional degradation visible without taking the core API out of readiness", async function _ReturnsOptionalDegradation()
	{
		const report = _Report(true, PublicHealthStatuses.Degraded);
		report.services[PublicHealthServiceNames.Memory] = PublicHealthServiceStatuses.Unavailable;
		const response = await request(_BuildHealthApp({ read: vi.fn().mockResolvedValue(report) })).get("/healthz");
		expect(response.status).toBe(200);
		expect(response.body).toEqual(report);
	});

	it("returns 503 for a non-ready report or an unexpected reader failure", async function _FailsClosed()
	{
		const notReady = _Report(false, PublicHealthStatuses.Degraded);
		const unavailable = await request(_BuildHealthApp({ read: vi.fn().mockResolvedValue(notReady) })).get("/healthz");
		expect(unavailable.status).toBe(503);
		expect(unavailable.body).toEqual(notReady);

		const error = vi.fn();
		const failed = await request(_BuildHealthApp({ read: vi.fn().mockRejectedValue(new Error("internal detail")) }, { error })).get("/healthz");
		expect(failed.status).toBe(503);
		expect(failed.text).not.toContain("internal detail");
		expect(failed.body.ready).toBe(false);
		expect(Object.keys(failed.body.services)).toEqual(Object.values(PublicHealthServiceNames));
		expect(error).toHaveBeenCalledWith({ err: expect.any(Error) }, "public health report failed");
	});
});
