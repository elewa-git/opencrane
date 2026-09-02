import { ConversationAgentBindingDenialReasons, type ConversationAgentBindingAuthority as ConversationAgentBindingAuthorityPort, type ConversationAgentBindingAuthorityDependencies, type ConversationAgentBindingCommand, type ConversationAgentBindingRepository, type ConversationAgentBindingResult } from "./conversation-agent-binding.types";

/** Resolves exact managed-agent facts for a later history-anchored conversation creation command. */
export class ConversationAgentBindingResolver implements ConversationAgentBindingAuthorityPort
{
	/** Reads transactional service facts and uses only deployment- and identity-owned selection ports. */
	public constructor(private readonly repository: ConversationAgentBindingRepository, private readonly dependencies: ConversationAgentBindingAuthorityDependencies) {}

	/** Returns a complete binding only after every durable coordinate is current and independently owned. */
	public async bind(command: ConversationAgentBindingCommand): Promise<ConversationAgentBindingResult>
	{
		if (!_Present(command.siloId) || !_Present(command.agentServiceId))
			return _Denied(ConversationAgentBindingDenialReasons.InvalidCommand);
		const candidate = await this.repository.load(command);
		if (candidate === null)
			return _Denied(ConversationAgentBindingDenialReasons.ServiceUnavailable);
		if (candidate.agentServiceKind === "personal")
			return _Denied(ConversationAgentBindingDenialReasons.PersonalDelegationUnavailable);
		const principalId = candidate.principalId;
		if (principalId === null || candidate.principal === null
			|| !this.dependencies.managedPrincipalValidator.validate({ agentServiceId: candidate.agentServiceId, principalId, ...candidate.principal }))
			return _Denied(ConversationAgentBindingDenialReasons.ManagedPrincipalUnavailable);
		const profile = await this.dependencies.profiles.select({ siloId: command.siloId, agentServiceKind: candidate.agentServiceKind });
		if (profile === null)
			return _Denied(ConversationAgentBindingDenialReasons.ProfileUnavailable);
		const identity = await this.dependencies.identities.select({ siloId: command.siloId, agentServiceId: candidate.agentServiceId, principalId });
		if (identity === null || !_Present(identity.agentIdentityId))
			return _Denied(ConversationAgentBindingDenialReasons.IdentityUnavailable);
		return { outcome: "bound", value: { agentServiceId: candidate.agentServiceId, agentRevisionId: candidate.agentRevisionId, agentServiceKind: "managed", principalId, agentIdentityId: identity.agentIdentityId, profileRevisionId: profile.profileRevisionId } };
	}
}

/** Hides partial database and deployment facts behind one closed binding denial. */
function _Denied(reason: ConversationAgentBindingDenialReasons): ConversationAgentBindingResult
{
	return { outcome: "denied", reason };
}

/** Rejects empty server-owned coordinates before a repository or selector sees them. */
function _Present(value: string): boolean
{
	return value.trim().length > 0;
}
