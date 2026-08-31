import type { PrismaClient } from "@prisma/client";
import type { Router } from "express";
import type { Logger } from "pino";

import { _ResolveRequestPrincipal } from "@opencrane/backend/server/infra/auth";

import { __CreateAgentServicesRouter } from "./agent-revision.router";
import type { AgentServicePublicationRepository } from "./agent-publication.types";
import type { ManagedRunAdmissionPort } from "./agent-revision-lifecycle.types";
import type { ManagementCaller } from "./agent-revision.router.types";
import { PrismaAgentServicePublicationUnitOfWork } from "./db/prisma-agent-publication";
import { PrismaAgentRevisionLifecycleUnitOfWork } from "./db/prisma-agent-revision-lifecycle-unit-of-work";
import { PrismaAgentScheduleUnitOfWork } from "./db/prisma-agent-schedule";

/** Maps authenticated request facts to the caller contract owned by agent management. */
function _resolveCaller(request: Parameters<typeof _ResolveRequestPrincipal>[0]): ManagementCaller | null
{
	const principal = _ResolveRequestPrincipal(request);
	return principal ? { principalId: principal.principalId, externalSubject: principal.externalSubject, siloId: principal.siloId } : null;
}

/** Builds a caller-attributed publication repository for central admission evidence. */
function _publicationFor(prisma: PrismaClient, caller: ManagementCaller): AgentServicePublicationRepository
{
	return new PrismaAgentServicePublicationUnitOfWork(prisma, caller);
}

/**
 * Builds the managed-agent management router with its Prisma-backed dependencies.
 *
 * Every repository here is silo-scoped at query level and the caller's silo comes from the session,
 * so nothing needs a silo from the request body. Note the publication repository is built per
 * request, not once, so each publish audit row names the administrator who made it.
 *
 * Called by: apps/opencrane/src/app/routes.ts, mounted at `/api/v1/agent-services`.
 *
 * @param prisma - The OpenCrane Prisma client.
 * @param runAdmission - Run-recording port, shared with the scheduler so both go through one
 *   capacity limit.
 * @param logger - Process logger from the app's composition root.
 * @returns The router, ready to mount.
 */
export function _CreateAgentServicesRouter(prisma: PrismaClient, runAdmission: ManagedRunAdmissionPort, logger: Logger): Router
{
	return __CreateAgentServicesRouter({
		lifecycle: new PrismaAgentRevisionLifecycleUnitOfWork(prisma),
		publicationFor(caller: ManagementCaller): AgentServicePublicationRepository { return _publicationFor(prisma, caller); },
		runAdmission,
		schedules: new PrismaAgentScheduleUnitOfWork(prisma),
		resolveCaller: _resolveCaller,
		clock: { now(): Date { return new Date(); } },
		logger,
	});
}
