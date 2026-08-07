import type { PrismaClient } from "@prisma/client";
import type { Router } from "express";
import type { Logger } from "pino";

import type { AgentRevision, AgentService } from "@opencrane/models/agents";
import { _ResolveRequestPrincipal } from "@opencrane/backend/_server/auth";
import type { AuditDecisionRecord } from "@opencrane/backend/server/iam/audit";
import { __DigestCanonicalJson } from "@opencrane/backend/server/iam/authorization";

import { __CreateAgentServicesRouter } from "./agent-revision.router.js";
import type { AgentServicePublicationRepository, AtomicAgentRevisionPublication } from "./agent-publication.types.js";
import type { ManagedRunAdmissionPort } from "./agent-revision-lifecycle.types.js";
import type { ManagementCaller } from "./agent-revision.router.types.js";
import { PrismaAgentServicePublicationRepository } from "./prisma-agent-publication.js";
import type { AgentPublicationAuditEvidencePort } from "./prisma-agent-publication.types.js";
import { PrismaAgentRevisionLifecycleRepository } from "./prisma-agent-revision-lifecycle.js";
import { PrismaAgentScheduleRepository } from "./prisma-agent-schedule.js";
import { PrismaScopeGrantResolver } from "./prisma-scope-grant-resolver.js";

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
 * Composes the Prisma-backed managed-agent management router.
 * @param prisma - Canonical product-authority client.
 * @param runAdmission - Shared, capacity-bounded managed run admission boundary.
 * @param logger - Process logger supplied by the app composition root.
 * @returns The configured agent-services router.
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
