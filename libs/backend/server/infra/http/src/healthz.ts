import type { RequestHandler } from "express";
import { PublicHealthServiceNames, PublicHealthServiceStatuses, PublicHealthStatuses, type PublicHealthReport } from "@opencrane/contracts";

import type { PublicHealthReportReader, PublicHealthRouteLogger } from "./healthz.types";

export type { DbHealthProbeRepository, DbHealthProbeUnitOfWork, PublicHealthReportReader, PublicHealthRouteLogger } from "./healthz.types";

/**
 * Build the public `/healthz` handler from the application-owned service report.
 *
 * The completed report includes only fixed capability names and categorical states. The aggregate
 * sets `ready: false` when its database check fails, while optional service failures remain visible
 * as `degraded` with HTTP 200. If the reader itself rejects, the handler returns a fixed 503 report
 * and keeps the private error out of this unauthenticated response.
 *
 * Called by: apps/opencrane/src/app/public-app.ts, mounted as `GET /healthz` before authentication.
 *
 * @param reader - Application-owned aggregate health reader.
 * @param logger - Structured private logger for an unexpected aggregate-reader failure.
 * @returns Express handler for `/healthz`. It never throws and never calls `next` with an error.
 */
export function _CheckHealth(reader: PublicHealthReportReader, logger: PublicHealthRouteLogger): RequestHandler
{
	return async function _checkHealth(_req, res)
	{
		try
		{
			const report = await reader.read();
			res.status(report.ready ? 200 : 503).json(report);
		}
		catch (err)
		{
			logger.error({ err }, "public health report failed");
			res.status(503).json(_UnavailableReport());
		}
	};
}

/** Builds the public-safe 503 report used when the application health reader itself fails. */
function _UnavailableReport(): PublicHealthReport
{
	return {
		status: PublicHealthStatuses.Degraded,
		ready: false,
		services: {
			[PublicHealthServiceNames.Api]: PublicHealthServiceStatuses.Available,
			[PublicHealthServiceNames.Database]: PublicHealthServiceStatuses.Unavailable,
			[PublicHealthServiceNames.Models]: PublicHealthServiceStatuses.Unavailable,
			[PublicHealthServiceNames.Memory]: PublicHealthServiceStatuses.Unavailable,
			[PublicHealthServiceNames.Files]: PublicHealthServiceStatuses.Unavailable,
			[PublicHealthServiceNames.Channels]: PublicHealthServiceStatuses.Unavailable,
		},
	};
}
