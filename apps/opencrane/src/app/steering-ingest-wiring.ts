import type { Request, Router } from "express";
import type { PrismaClient } from "@prisma/client";

import { __CreateSteeringIngestRouter, PrismaSteeringRequestRepository, type SteeringIngestCaller } from "@opencrane/backend/agents/execution/protocol";
import { _ClusterTenantFromHost, _RequestHost } from "@opencrane/server/_infra/auth";
// Side-effect import: loads the express-session SessionData.authUser augmentation.
import "@opencrane/server/_infra/auth";

import { _log } from "./log.js";

/** Builds the app-composed self-only runtime steering ingest API. */
export function _CreateSteeringIngestRouter(prisma: PrismaClient): Router
{
	return __CreateSteeringIngestRouter({
		resolveCaller: _resolveCaller,
		requests: new PrismaSteeringRequestRepository(prisma),
		clock: { now(): Date { return new Date(); } },
		logger: _log,
	});
}

/** Resolve the self-only steering owner from session identity and the request host's silo. */
function _resolveCaller(request: Request): SteeringIngestCaller | null
{
	const authUser = request.session?.authUser;
	if (!authUser) return null;
	const subjectId = (typeof authUser.sub === "string" ? authUser.sub.trim() : "") || (typeof authUser.email === "string" ? authUser.email.trim().toLowerCase() : "");
	const siloId = _ClusterTenantFromHost(_RequestHost(request)) ?? "";
	return subjectId && siloId ? { subjectId, siloId } : null;
}
