import type { LocalDevelopmentProfileKinds } from "@opencrane/models/local-development";
import { LocalDevelopmentProfileKinds as ProfileKinds } from "@opencrane/models/local-development";
import type { PublicHealthReportReader } from "@opencrane/backend/server/infra/http";

import { ___CreateDbHealthProbe } from "../infra/db/db";
import { _CreateModelHealthProbe } from "../infra/health/public-health-probe";
import { _CreatePublicHealthReportReader } from "../infra/health/public-health";
import { _log } from "../app/log";

/** Prisma client shape returned by the app-owned database composition. */
type DevelopmentPrismaClient = ReturnType<typeof import("../infra/db/db").___CreatePrismaClient>;

/** Compose health so intentionally absent Tier 2 dependencies report disabled. */
export function _CreateDevelopmentHealth(prisma: DevelopmentPrismaClient, profile: LocalDevelopmentProfileKinds): PublicHealthReportReader
{
	const modelsEnabled = profile === ProfileKinds.AgentLocal || profile === ProfileKinds.AgentRemote;
	return _CreatePublicHealthReportReader({
		database: ___CreateDbHealthProbe(prisma),
		models: modelsEnabled ? _CreateModelHealthProbe(process.env) : null,
		memory: null,
		files: null,
		channels: null,
		integrations: null,
		logger: _log,
		clock: { nowEpochMilliseconds: function _Now() { return Date.now(); } },
		cacheMilliseconds: 5_000,
	});
}
