import { randomUUID } from "node:crypto";

import { AgentIdentityStates, type ManagedAgentIdentity } from "@opencrane/contracts";
import { HistoryExpectedRevisions } from "@opencrane/backend/server/infra/history-store";

import { AgentIdentityHistory } from "./agent-identity-history";
import type { CurrentAgentIdentity } from "./agent-identity-history.types";
import type { ManagedAgentIdentityProvisionCommand, ManagedAgentIdentityProvisioner, ManagedAgentIdentityProvisionerClock } from "./managed-agent-identity-provisioner.types";

/** Derives the sole AgentIdentity coordinate a managed AgentService may realize. */
export function __ManagedAgentIdentityId(agentServiceId: string): string
{
	if (!_Identifier(agentServiceId))
		throw new Error("Managed agent identity provision requires a server-provided agent service identifier");
	return `managed-agent-identity:${agentServiceId}`;
}

/** Ensures one active managed identity history stream from already-verified managed service facts. */
export class ManagedAgentIdentityHistoryProvisioner implements ManagedAgentIdentityProvisioner
{
	/** Uses identity history for durable state and a server clock only when the stream is new. */
	public constructor(private readonly history: AgentIdentityHistory, private readonly clock: ManagedAgentIdentityProvisionerClock) {}

	/** Returns the exact active managed identity after first append or a concurrent stream creator. */
	public async ensure(command: ManagedAgentIdentityProvisionCommand): Promise<{ readonly agentIdentityId: string }>
	{
		_ValidateCommand(command);
		const agentIdentityId = __ManagedAgentIdentityId(command.agentServiceId);
		const current = await this.history.load({ siloId: command.siloId, agentIdentityId, agentServiceId: command.agentServiceId, principalId: command.principalId });
		if (current !== null)
			return _ManagedIdentityResult(current, command, agentIdentityId);
		try
		{
			await this.history.append({ expectedRevision: HistoryExpectedRevisions.NoStream, eventId: randomUUID(), identity: _ManagedIdentity(command, agentIdentityId, this.clock.now()) });
		}
		catch (error)
		{
			const raced = await this.history.load({ siloId: command.siloId, agentIdentityId, agentServiceId: command.agentServiceId, principalId: command.principalId });
			if (raced === null)
				throw error;
			return _ManagedIdentityResult(raced, command, agentIdentityId);
		}
		const provisioned = await this.history.load({ siloId: command.siloId, agentIdentityId, agentServiceId: command.agentServiceId, principalId: command.principalId });
		if (provisioned === null)
			throw new Error("Managed agent identity provision did not persist its identity stream");
		return _ManagedIdentityResult(provisioned, command, agentIdentityId);
	}
}

/** Builds the first immutable snapshot for one managed service's deterministic identity stream. */
function _ManagedIdentity(command: ManagedAgentIdentityProvisionCommand, agentIdentityId: string, createdAt: Date): ManagedAgentIdentity
{
	return {
		schemaVersion: 1,
		id: agentIdentityId,
		siloId: command.siloId,
		agentServiceId: command.agentServiceId,
		name: command.agentServiceName,
		avatarArtifactRevisionId: null,
		state: AgentIdentityStates.Active,
		createdByPrincipalId: command.principalId,
		createdAt: createdAt.toISOString(),
		kind: "managed",
		principalId: command.principalId,
	};
}

/** Rejects a stream that does not remain the exact active managed realization of this service. */
function _ManagedIdentityResult(current: CurrentAgentIdentity, command: ManagedAgentIdentityProvisionCommand, agentIdentityId: string): { readonly agentIdentityId: string }
{
	const identity = current.identity;
	if (identity.kind !== "managed" || identity.state !== AgentIdentityStates.Active
		|| identity.id !== agentIdentityId || identity.siloId !== command.siloId
		|| identity.agentServiceId !== command.agentServiceId || identity.principalId !== command.principalId
		|| identity.createdByPrincipalId !== command.principalId || identity.avatarArtifactRevisionId !== null)
		throw new Error("Managed agent identity provision found a conflicting identity stream");
	return { agentIdentityId };
}

/** Rejects untrusted empty managed-service coordinates before they select an identity stream. */
function _ValidateCommand(command: ManagedAgentIdentityProvisionCommand): void
{
	if (!_Identifier(command.siloId) || !_Identifier(command.agentServiceId) || !_Identifier(command.principalId) || !_Identifier(command.agentServiceName))
		throw new Error("Managed agent identity provision requires complete server-provided service coordinates");
}

/** Checks one durable coordinate without silently normalizing it. */
function _Identifier(value: string): boolean
{
	return value.trim().length > 0 && value === value.trim();
}
