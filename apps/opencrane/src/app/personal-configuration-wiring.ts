import type { PrismaClient } from "@prisma/client";
import type { Router } from "express";

import { __CreatePersonalConfigurationRouter, PrismaPersonalConfigurationChangeRepository } from "@opencrane/backend/agents/personal/configuration";

import { _log } from "./log.js";
import { _ResolvePersonalSelfCaller } from "./personal-self-caller.js";

/** Build the app-composed self-only personal-configuration decision API. */
export function _CreatePersonalConfigurationRouter(prisma: PrismaClient): Router
{
	const changes = new PrismaPersonalConfigurationChangeRepository(prisma, _log);
	return __CreatePersonalConfigurationRouter({
		resolveCaller: _ResolvePersonalSelfCaller,
		changes,
		materializer: changes,
		clock: { now(): Date { return new Date(); } },
		logger: _log,
	});
}
