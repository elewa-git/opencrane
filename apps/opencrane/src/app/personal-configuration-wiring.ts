import type { PrismaClient } from "@prisma/client";
import type { Router } from "express";

import { __CreatePersonalConfigurationRouter, PrismaPersonalConfigurationChangeRepository } from "@opencrane/backend/agents/personal/configuration";

import { _log } from "./log.js";
import { _ResolvePersonalSelfCaller } from "./personal-self-caller.js";

/** Build the app-composed self-only personal-configuration decision API. */
export function _CreatePersonalConfigurationRouter(prisma: PrismaClient): Router
{
	return __CreatePersonalConfigurationRouter({
		resolveCaller: _ResolvePersonalSelfCaller,
		changes: new PrismaPersonalConfigurationChangeRepository(prisma, _log),
		clock: { now(): Date { return new Date(); } },
		logger: _log,
	});
}
