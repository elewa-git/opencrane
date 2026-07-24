import type { PrismaClient } from "@prisma/client";
import type { Request, Router } from "express";

import { PrismaPersonalConfigurationChangeRepository, __CreatePersonalConfigurationDecisionRouter } from "@opencrane/backend/agents/personal/configuration";

import { _log } from "./log.js";
import { _ResolveActivePersonalCaller } from "./personal-owner-wiring.js";

/** Compose the public owner-only personal configuration decision API over the canonical Prisma authority. */
export function _CreatePersonalConfigurationDecisionRouter(prisma: PrismaClient): Router
{
	return __CreatePersonalConfigurationDecisionRouter({
		resolveCaller: function _ResolveCaller(request: Request) { return _ResolveActivePersonalCaller(prisma, request); },
		decisions: new PrismaPersonalConfigurationChangeRepository(prisma),
		clock: { now: function _Now(): Date { return new Date(); } },
		logger: _log,
	});
}
