import { AgentIdentityStates, type ManagedAgentIdentity } from "@opencrane/contracts";
import type { AgentIdentityHistory } from "@opencrane/backend/server/iam/identity";
import { HistoryExpectedRevisions } from "@opencrane/backend/server/infra/history-store";

import type { CompanyAssistantProvisioningResult } from "./company-assistant-provisioning.types";

/**
 * Establishes the committed company identity once, without reviving suspended or revoked identities.
 *
 * Called by: company assistant setup after the PostgreSQL provisioning transaction commits.
 * A failed append may be retried from the committed result; a concurrent append must leave the same
 * active identity before setup reports success.
 * @see PrismaCompanyAssistantProvisioningRepository for the durable creation boundary.
 */
export async function __EnsureCompanyAssistantIdentity(history: Pick<AgentIdentityHistory, "load" | "append" | "loadActive">, result: CompanyAssistantProvisioningResult): Promise<void>
{
	const coordinates = { siloId: result.siloId, agentIdentityId: result.agentIdentityId, agentServiceId: result.agentServiceId, principalId: result.principalId };
	const current = await history.load(coordinates);
	if (current === null)
	{
		const identity: ManagedAgentIdentity = { schemaVersion: 1, kind: "managed", id: result.agentIdentityId, siloId: result.siloId, agentServiceId: result.agentServiceId, principalId: result.principalId, name: result.name, avatarArtifactRevisionId: null, state: AgentIdentityStates.Active, createdByPrincipalId: result.createdByPrincipalId, createdAt: result.createdAt };
		try { await history.append({ expectedRevision: HistoryExpectedRevisions.NoStream, eventId: result.identityEventId, identity }); }
		catch
		{
			const winner = await history.loadActive(coordinates);
			if (winner.identity.kind !== "managed")
				throw new Error("Company assistant identity is unavailable");
			return;
		}
	}
	const active = await history.loadActive(coordinates);
	if (active.identity.kind !== "managed")
		throw new Error("Company assistant identity is unavailable");
}
