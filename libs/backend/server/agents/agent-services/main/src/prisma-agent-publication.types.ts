import type { AgentRevision, AgentService } from "@opencrane/models/agents";

import type { AuditDecisionRecord } from "@opencrane/backend/server/iam/audit";
import type { AtomicAgentRevisionPublication } from "./agent-publication.types.js";

/** Builds exact audit evidence for one publication while its transaction is active. */
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
