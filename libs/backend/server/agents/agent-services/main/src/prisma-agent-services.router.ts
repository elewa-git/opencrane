import type { PrismaClient } from "@prisma/client";
import type { Router } from "express";
import type { Logger } from "pino";

import type { AgentRevision, AgentService } from "@opencrane/models/agents";
import { _ResolveRequestPrincipal } from "@opencrane/backend/server/infra/auth";
import type { AuditDecisionRecord } from "@opencrane/backend/server/iam/audit";
import { __DigestCanonicalJson } from "@opencrane/backend/server/iam/authorization";

import { __CreateAgentServicesRouter } from "./agent-revision.router";
import type { AgentServicePublicationRepository, AtomicAgentRevisionPublication } from "./agent-publication.types";
import type { ManagedRunAdmissionPort } from "./agent-revision-lifecycle.types";
import type { ManagementCaller } from "./agent-revision.router.types";
import { PrismaAgentServicePublicationRepository } from "./prisma-agent-publication";
import type { AgentPublicationAuditEvidencePort } from "./prisma-agent-publication.types";
import { PrismaAgentRevisionLifecycleRepository } from "./prisma-agent-revision-lifecycle";
import { PrismaAgentScheduleRepository } from "./prisma-agent-schedule";
import { PrismaScopeGrantResolver } from "./prisma-scope-grant-resolver";

/** Stable capability-catalogue reference recorded for a management publish decision. */
const _MANAGEMENT_CATALOG_ID = "opencrane-agent-management";

/** Maps authenticated request facts to the caller contract owned by agent management. */
function _resolveCaller(request: Parameters<typeof _ResolveRequestPrincipal>[0]): ManagementCaller | null
{
	const principal = _ResolveRequestPrincipal(request);
	return principal ? { subjectId: principal.subjectId, siloId: principal.siloId, isOrgAdmin: principal.isOrgAdmin } : null;
}

/** Builds caller-attributed publication audit evidence for one publish decision. */
function _buildPublicationAuditEvidence(caller: ManagementCaller): AgentPublicationAuditEvidencePort
{
	return {
		build(publication: AtomicAgentRevisionPublication, service: AgentService, revision: AgentRevision): AuditDecisionRecord
		{
			const argumentsDigest = __DigestCanonicalJson({ agentServiceId: publication.agentServiceId, agentRevisionId: publication.agentRevisionId, expectedActiveRevisionId: publication.expectedActiveRevisionId, publishedAt: publication.publishedAt });
			const effectiveAuthorizationDigest = __DigestCanonicalJson({ actor: caller.subjectId, siloId: service.siloId, revision: revision.revision, digest: revision.digest });
			const decisionDigest = __DigestCanonicalJson({ argumentsDigest, effectiveAuthorizationDigest, action: "publish", resourceId: service.id });
			return {
				decisionDigest,
				siloId: service.siloId,
				actorKind: "user",
				actorId: caller.subjectId,
				resourceKind: "agent-service",
				resourceId: service.id,
				agentServiceId: service.id,
				agentRevisionId: revision.id,
				action: "publish",
				catalogId: _MANAGEMENT_CATALOG_ID,
				catalogRevision: 1,
				catalogDigest: __DigestCanonicalJson({ catalog: _MANAGEMENT_CATALOG_ID, revision: 1 }),
				argumentsDigest,
				policyRevisionHash: __DigestCanonicalJson({ policy: "agent-management", role: "org-admin" }),
				effectiveAuthorizationDigest,
				outcome: "allow",
				reasonCode: "authorized",
			};
		},
	};
}

/** Builds a caller-attributed publication repository so the audit records the real actor. */
function _publicationFor(prisma: PrismaClient, caller: ManagementCaller): AgentServicePublicationRepository
{
	return new PrismaAgentServicePublicationRepository(prisma, _buildPublicationAuditEvidence(caller));
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
		lifecycle: new PrismaAgentRevisionLifecycleRepository(prisma),
		publicationFor(caller: ManagementCaller): AgentServicePublicationRepository { return _publicationFor(prisma, caller); },
		runAdmission,
		schedules: new PrismaAgentScheduleRepository(prisma),
		scopeGrantResolver: new PrismaScopeGrantResolver(prisma),
		resolveCaller: _resolveCaller,
		clock: { now(): Date { return new Date(); } },
		logger,
	});
}
