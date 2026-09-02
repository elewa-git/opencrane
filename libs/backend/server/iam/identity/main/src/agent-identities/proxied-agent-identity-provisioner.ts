import { createHash, randomUUID } from "node:crypto";

import { AgentIdentityStates, type ProxiedAgentIdentity } from "@opencrane/contracts";
import { HistoryExpectedRevisions } from "@opencrane/backend/server/infra/history-store";

import { AgentIdentityHistory } from "./agent-identity-history";
import type { CurrentAgentIdentity } from "./agent-identity-history.types";
import type { ProxiedAgentIdentityProvisionCommand, ProxiedAgentIdentityProvisioner, ProxiedAgentIdentityProvisionerClock } from "./proxied-agent-identity-provisioner.types";

/** Names the sole discriminated identity variant this provisioner may create or accept. */
const _PROXIED_IDENTITY_KIND: ProxiedAgentIdentity["kind"] = "proxied";

/** Derives the deterministic identity coordinate for one personal service acting for one user. */
export function __ProxiedAgentIdentityId(agentServiceId: string, proxiedPrincipalId: string): string
{
	if (!_Identifier(agentServiceId) || !_Identifier(proxiedPrincipalId))
		throw new Error("Proxied agent identity provision requires server-provided service and principal identifiers");
	return `proxied-agent-identity:${createHash("sha256").update(JSON.stringify([agentServiceId, proxiedPrincipalId])).digest("hex")}`;
}

/** Establishes or reuses the immutable identity after the binding authority verified its coordinates. */
export class ProxiedAgentIdentityHistoryProvisioner implements ProxiedAgentIdentityProvisioner
{
	/** Uses identity history for durable state and reads the clock only for a missing stream. */
	public constructor(private readonly history: AgentIdentityHistory, private readonly clock: ProxiedAgentIdentityProvisionerClock) {}

	/** @inheritdoc */
	public async ensure(command: ProxiedAgentIdentityProvisionCommand): Promise<{ readonly agentIdentityId: string }>
	{
		_ValidateCommand(command);
		const agentIdentityId = __ProxiedAgentIdentityId(command.agentServiceId, command.proxiedPrincipalId);
		const current = await this.history.load({ siloId: command.siloId, agentIdentityId, agentServiceId: command.agentServiceId, principalId: command.proxiedPrincipalId });
		if (current !== null)
			return _ProxiedIdentityResult(current, command, agentIdentityId);
		try
		{
			await this.history.append({ expectedRevision: HistoryExpectedRevisions.NoStream, eventId: randomUUID(), identity: _ProxiedIdentity(command, agentIdentityId, this.clock.now()) });
		}
		catch (error)
		{
			const raced = await this.history.load({ siloId: command.siloId, agentIdentityId, agentServiceId: command.agentServiceId, principalId: command.proxiedPrincipalId });
			if (raced === null)
				throw error;
			return _ProxiedIdentityResult(raced, command, agentIdentityId);
		}
		const provisioned = await this.history.load({ siloId: command.siloId, agentIdentityId, agentServiceId: command.agentServiceId, principalId: command.proxiedPrincipalId });
		if (provisioned === null)
			throw new Error("Proxied agent identity provision did not persist its identity stream");
		return _ProxiedIdentityResult(provisioned, command, agentIdentityId);
	}
}

/** Builds the revision-zero snapshot; later authorization reads the current proxied principal. */
function _ProxiedIdentity(command: ProxiedAgentIdentityProvisionCommand, agentIdentityId: string, createdAt: Date): ProxiedAgentIdentity
{
	return { schemaVersion: 1, id: agentIdentityId, siloId: command.siloId, agentServiceId: command.agentServiceId, name: command.agentServiceName, avatarArtifactRevisionId: null, state: AgentIdentityStates.Active, createdByPrincipalId: command.proxiedPrincipalId, createdAt: createdAt.toISOString(), kind: _PROXIED_IDENTITY_KIND, proxiedPrincipalId: command.proxiedPrincipalId, delegationPolicyId: command.delegationPolicyId };
}

/** Refuses any stream that would realize a different service, user, or delegation ceiling. */
function _ProxiedIdentityResult(current: CurrentAgentIdentity, command: ProxiedAgentIdentityProvisionCommand, agentIdentityId: string): { readonly agentIdentityId: string }
{
	const identity = current.identity;
	if (identity.kind !== _PROXIED_IDENTITY_KIND || identity.state !== AgentIdentityStates.Active || identity.id !== agentIdentityId || identity.siloId !== command.siloId || identity.agentServiceId !== command.agentServiceId || identity.proxiedPrincipalId !== command.proxiedPrincipalId || identity.delegationPolicyId !== command.delegationPolicyId || identity.createdByPrincipalId !== command.proxiedPrincipalId || identity.avatarArtifactRevisionId !== null)
		throw new Error("Proxied agent identity provision found a conflicting identity stream");
	return { agentIdentityId };
}

/** Rejects missing or normalized coordinates before they derive an identity stream. */
function _ValidateCommand(command: ProxiedAgentIdentityProvisionCommand): void
{
	if (!_Identifier(command.siloId) || !_Identifier(command.agentServiceId) || !_Identifier(command.proxiedPrincipalId) || !_Identifier(command.delegationPolicyId) || !_Identifier(command.agentServiceName))
		throw new Error("Proxied agent identity provision requires complete server-provided service coordinates");
}

/** Checks one durable coordinate without silently normalizing it. */
function _Identifier(value: string): boolean
{
	return value.trim().length > 0 && value === value.trim();
}
