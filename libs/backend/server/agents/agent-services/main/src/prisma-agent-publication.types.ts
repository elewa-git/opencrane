import type { AgentRevision, AgentService } from "@opencrane/models/agents";

import type { AuditDecisionRecord } from "@opencrane/backend/server/iam/audit";
import type { AtomicAgentRevisionPublication } from "./agent-publication.types";

/**
 * Builds the audit row for one publication, while the publication transaction is still open.
 *
 * It is a port so the repository never has to know who the caller is: the request layer supplies an
 * implementation already bound to the authenticated administrator, and the audit row names that
 * person rather than the process. The row is appended before commit, so a failed audit write rolls
 * the publication back.
 *
 * Implemented by: `_buildPublicationAuditEvidence` in `prisma-agent-services.router.ts`.
 * Called by: `PrismaAgentServicePublicationRepository.publishRevisionAtomically` in
 * `prisma-agent-publication.ts`.
 */
export interface AgentPublicationAuditEvidencePort
{
	/**
	 * Builds evidence from the locked authority records that will be committed.
	 * @param publication - Atomic publication request accepted by the domain.
	 * @param service - Locked service state before activation.
	 * @param revision - Locked draft revision before publication.
	 * @returns Exact append-only authorization evidence.
	 */
	build(publication: AtomicAgentRevisionPublication, service: AgentService, revision: AgentRevision): AuditDecisionRecord;
}
