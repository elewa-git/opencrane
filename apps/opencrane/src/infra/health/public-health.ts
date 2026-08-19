import { PublicHealthServiceNames, PublicHealthServiceStatuses, PublicHealthStatuses, type PublicHealthReport, type PublicHealthServices } from "@opencrane/contracts";
import { ___DoWithTrace } from "@opencrane/backend/observability";
import type { PublicHealthReportReader } from "@opencrane/backend/server/infra/http";

import type { OpenCraneProcessConfig } from "../../app/config.types";
import { ___CreateDbHealthProbe } from "../db/db";
import type { PublicHealthCacheEntry, PublicHealthProbe, PublicHealthReaderDependencies } from "./public-health.types";
import { _CreateHttpHealthProbe, _CreateModelHealthProbe } from "./public-health-probe";

/** Reuse one report briefly so an unauthenticated caller cannot fan out dependency traffic. */
const _REPORT_CACHE_MILLISECONDS = 5_000;

/** Shares a short-lived report promise so concurrent public requests do not multiply dependency checks. */
class _PublicHealthReportReader implements PublicHealthReportReader
{
	/** The current completed or in-flight report, or null before the first request. */
	private _cache: PublicHealthCacheEntry | null = null;

	/** Build the reader from fixed probes, time, and cache policy. */
	public constructor(private readonly _dependencies: PublicHealthReaderDependencies) {}

	/** Return the current report, coalescing concurrent requests and refreshing after the cache limit. */
	public read(): Promise<PublicHealthReport>
	{
		const now = this._dependencies.clock.nowEpochMilliseconds();
		if (this._cache !== null && now < this._cache.expiresAtEpochMilliseconds) return this._cache.report;
		const report = this._ReadFresh();
		this._cache = { expiresAtEpochMilliseconds: now + this._dependencies.cacheMilliseconds, report };
		return report;
	}

	/** Probe every configured service concurrently and derive the fixed public contract. */
	private async _ReadFresh(): Promise<PublicHealthReport>
	{
		// Run independent checks together so an unavailable service does not delay every later check.
		const [database, models, memory, files, channels, integrations] = await Promise.all([
			_ReadProbe(PublicHealthServiceNames.Database, this._dependencies.database, this._dependencies.logger),
			_ReadProbe(PublicHealthServiceNames.Models, this._dependencies.models, this._dependencies.logger),
			_ReadProbe(PublicHealthServiceNames.Memory, this._dependencies.memory, this._dependencies.logger),
			_ReadProbe(PublicHealthServiceNames.Files, this._dependencies.files, this._dependencies.logger),
			this._dependencies.channels === null
				? Promise.resolve(PublicHealthServiceStatuses.Disabled)
				: _ReadProbe(PublicHealthServiceNames.Channels, this._dependencies.channels, this._dependencies.logger),
			this._dependencies.integrations === null
				? Promise.resolve(PublicHealthServiceStatuses.Disabled)
				: _ReadProbe(PublicHealthServiceNames.Integrations, this._dependencies.integrations, this._dependencies.logger),
		]);

		// Map results to fixed public names so the response reveals no target or failure details.
		const services: PublicHealthServices = {
			[PublicHealthServiceNames.Api]: PublicHealthServiceStatuses.Available,
			[PublicHealthServiceNames.Database]: database,
			[PublicHealthServiceNames.Models]: models,
			[PublicHealthServiceNames.Memory]: memory,
			[PublicHealthServiceNames.Files]: files,
			[PublicHealthServiceNames.Channels]: channels,
			[PublicHealthServiceNames.Integrations]: integrations,
		};

		// Keep readiness tied to the database while still reporting outages in the optional services.
		const ready = database === PublicHealthServiceStatuses.Available;
		const degraded = Object.values(services).some(function _IsUnavailable(serviceStatus) { return serviceStatus === PublicHealthServiceStatuses.Unavailable; });
		return { status: degraded ? PublicHealthStatuses.Degraded : PublicHealthStatuses.Ok, ready, services };
	}
}

/** Read one service behind the shared trace boundary and collapse every error to `unavailable`. */
async function _ReadProbe(name: PublicHealthServiceNames, probe: PublicHealthProbe, logger: PublicHealthReaderDependencies["logger"]): Promise<PublicHealthServiceStatuses>
{
	try
	{
		await ___DoWithTrace("health.service.check", { healthService: name }, async function _Check(): Promise<void> { await probe.check(); });
		return PublicHealthServiceStatuses.Available;
	}
	catch (err)
	{
		logger.warn({ err, healthService: name }, "health service check failed");
		return PublicHealthServiceStatuses.Unavailable;
	}
}

/**
 * Compose the public health reader from the same frozen service targets used by the server process.
 *
 * Called by: `apps/opencrane/src/index.ts` while constructing the public listener.
 *
 * @param prisma - Product database client used by the request-bearing readiness probe.
 * @param config - Frozen process configuration containing memory and optional integration targets.
 * @param logger - Process logger used only for structured private failure records.
 * @param environment - Process environment containing existing model and file service targets.
 * @returns Cached report reader consumed by the public `/healthz` handler.
 */
export function ___CreatePublicHealthReportReader(prisma: Parameters<typeof ___CreateDbHealthProbe>[0], config: OpenCraneProcessConfig, logger: PublicHealthReaderDependencies["logger"], environment: NodeJS.ProcessEnv = process.env): PublicHealthReportReader
{
	return _CreatePublicHealthReportReader({
		database: ___CreateDbHealthProbe(prisma),
		models: _CreateModelHealthProbe(environment),
		memory: _CreateHttpHealthProbe(config.runtime.memoryGatewayUrl, "/readyz"),
		files: _CreateHttpHealthProbe(environment.ARTIFACT_SERVICE_URL?.trim(), "/readyz"),
		channels: config.runtime.channelTargets === null ? null : _CreateHttpHealthProbe(environment.CHANNEL_PROXY_URL?.trim(), "/readyz"),
		integrations: config.obot === null ? null : _CreateHttpHealthProbe(config.obot.gatewayUrl, "/api/healthz"),
		logger,
		clock: { nowEpochMilliseconds: function _Now() { return Date.now(); } },
		cacheMilliseconds: _REPORT_CACHE_MILLISECONDS,
	});
}

/**
 * Build the report reader from already composed probes.
 *
 * Called by: `___CreatePublicHealthReportReader` above and the focused service-aggregation tests.
 *
 * @param dependencies - Fixed service probes, clock, and cache limit.
 * @returns Cached public report reader with no provider or topology fields.
 */
export function _CreatePublicHealthReportReader(dependencies: PublicHealthReaderDependencies): PublicHealthReportReader
{
	return new _PublicHealthReportReader(dependencies);
}
