import type { PrismaClient } from "@prisma/client";
import type { Router } from "express";

import type { Logger } from "@opencrane/backend/observability";
import { _ResolveRequestPrincipal } from "@opencrane/backend/server/infra/auth";

import { PrismaPersonalAgentToolsUnitOfWork } from "./db/prisma-personal-agent-tools-unit-of-work";
import { _CreatePersonalAgentToolsRouter } from "./personal-agent-tools.router";

/** Composes the personal tool route from authenticated request facts and the database authority. */
export function _CreatePersonalAgentToolsComposition(prisma: PrismaClient, logger: Logger): Router
{
	return _CreatePersonalAgentToolsRouter(new PrismaPersonalAgentToolsUnitOfWork(prisma), function _ResolveOwner(request)
	{
		const principal = _ResolveRequestPrincipal(request);
		return principal === null ? null : { siloId: principal.siloId, subjectId: principal.externalSubject };
	}, logger);
}
