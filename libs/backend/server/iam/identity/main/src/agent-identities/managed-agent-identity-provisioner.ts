import { randomUUID } from "node:crypto";

import { AgentIdentityStates, type ManagedAgentIdentity } from "@opencrane/contracts";
import { HistoryExpectedRevisions } from "@opencrane/backend/server/infra/history-store";

import { AgentIdentityHistory } from "./agent-identity-history";
import type { CurrentAgentIdentity } from "./agent-identity-history.types";
import type { ManagedAgentIdentityProvisionCommand, ManagedAgentIdentityProvisioner, ManagedAgentIdentityProvisionerClock } from "./managed-agent-identity-provisioner.types";

/** Names the one discriminated identity variant this provisioner may create or accept. */
const _MANAGED_IDENTITY_KIND: ManagedAgentIdentity["kind"] = "managed";

/**
 * Derives the deterministic AgentIdentity coordinate for one managed AgentService.
 *
 * Creation and reuse must address this same stream. The function therefore rejects an empty or
 * normalized service coordinate instead of deriving an identity from a browser-supplied id.
 * @param agentServiceId - Supplies the verified managed AgentService identifier.
 * @returns The stable identity id used by this provisioner's history stream.
 * @throws {Error} When the service identifier is blank or has surrounding whitespace.
 */
export function __ManagedAgentIdentityId(agentServiceId: string): string
{
	if (!_Identifier(agentServiceId))
		throw new Error("Managed agent identity provision requires a server-provided agent service identifier");
	return `managed-agent-identity:${agentServiceId}`;
}

/**
 * Establishes the active managed AgentIdentity history for already-verified service facts.
 *
 * The authority appends only at {@link HistoryExpectedRevisions.NoStream}, then reloads the active
 * snapshot. A concurrent creator is accepted only when that reload realizes the same managed
 * service, silo, and Principal; treating any successful append race as interchangeable could bind
 * the service to a different actor. This boundary owns history creation, not AgentService lookup or
 * a relational identity catalog.
 * @see ManagedAgentIdentityProvisioner for the contract callers receive.
 */
export class ManagedAgentIdentityHistoryProvisioner implements ManagedAgentIdentityProvisioner
{
	/** Uses identity history for durable state and a server clock only when the stream is new. */
	public constructor(private readonly history: AgentIdentityHistory, private readonly clock: ManagedAgentIdentityProvisionerClock) {}

	/**
	 * Creates or reuses this service's deterministic managed identity stream.
	 *
	 * @param command - Supplies service facts that the upstream binding authority already verified.
	 * @returns The managed identity id after a matching active history snapshot is loaded.
	 * @throws {Error} When inputs are incomplete, persistence did not produce a stream, or the loaded
	 * stream realizes a different, inactive, or non-managed identity.
	 */
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
		kind: _MANAGED_IDENTITY_KIND,
		principalId: command.principalId,
	};
}

/** Rejects a stream that does not remain the exact active managed realization of this service. */
function _ManagedIdentityResult(current: CurrentAgentIdentity, command: ManagedAgentIdentityProvisionCommand, agentIdentityId: string): { readonly agentIdentityId: string }
{
	const identity = current.identity;
	if (identity.kind !== _MANAGED_IDENTITY_KIND || identity.state !== AgentIdentityStates.Active
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
