import type { Request, Router } from "express";
import type { PrismaClient } from "@prisma/client";

import type { AgentRevision, AgentService } from "@opencrane/models/agents";
import { __CreateAgentServicesRouter, PrismaAgentRevisionLifecycleRepository, PrismaAgentScheduleRepository, PrismaAgentServicePublicationRepository, PrismaScopeGrantResolver } from "@opencrane/backend/server/agents/agent-services";
import type { AgentPublicationAuditEvidencePort, AgentServicePublicationRepository, AtomicAgentRevisionPublication, ManagedRunAdmissionPort, ManagementCaller } from "@opencrane/backend/server/agents/agent-services";
import type { AuditDecisionRecord } from "@opencrane/backend/server/iam/audit";
import { __DigestCanonicalJson } from "@opencrane/backend/server/iam/authorization";
import { _ClusterTenantFromHost, _RequestHost } from "@opencrane/server/_infra/auth";
// Side-effect import: loads the express-session `SessionData.authUser` augmentation.
import "@opencrane/server/_infra/auth";

import { _log } from "./log.js";

/** Stable capability-catalog reference recorded for a management publish decision. */
const _MANAGEMENT_CATALOG_ID = "opencrane-agent-management";

/** Resolves the authenticated management caller from the browser session, or null. */
function _resolveCaller(req: Request): ManagementCaller | null
{
	const authUser = req.session?.authUser;
	if (!authUser) return null;
	const subjectId = (typeof authUser.sub === "string" ? authUser.sub.trim() : "") || (typeof authUser.email === "string" ? authUser.email.trim().toLowerCase() : "");
	const siloId = _ClusterTenantFromHost(_RequestHost(req)) ?? "";
	if (!subjectId || !siloId) return null;
	return { subjectId, siloId, isOrgAdmin: authUser.isOrgAdmin === true };
}

/** Builds the caller-attributed publication audit evidence for one publish decision. */
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

/** Builds a caller-attributed publication repository so the publish audit records the real actor. */
function _publicationFor(prisma: PrismaClient, caller: ManagementCaller): AgentServicePublicationRepository
{
	return new PrismaAgentServicePublicationRepository(prisma, _buildPublicationAuditEvidence(caller));
}

/**
 * Compose the authoritative managed-agent management router for the app.
 * @param prisma - Canonical product-authority client.
	* @param runAdmission - Shared, capacity-bounded managed run admission boundary.
 * @returns The configured `/api/v1/agent-services` router.
 */
export function _CreateAgentServicesRouter(prisma: PrismaClient, runAdmission: ManagedRunAdmissionPort): Router
{
	return __CreateAgentServicesRouter({
		lifecycle: new PrismaAgentRevisionLifecycleRepository(prisma),
		publicationFor(caller: ManagementCaller): AgentServicePublicationRepository { return _publicationFor(prisma, caller); },
		runAdmission,
		schedules: new PrismaAgentScheduleRepository(prisma),
		scopeGrantResolver: new PrismaScopeGrantResolver(prisma),
		resolveCaller: _resolveCaller,
		clock: { now(): Date { return new Date(); } },
		logger: _log,
	});
}
