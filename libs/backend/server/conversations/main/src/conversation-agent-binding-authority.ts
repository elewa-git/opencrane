import { ConversationAgentBindingDenialReasons, type ConversationAgentBindingAuthority as ConversationAgentBindingAuthorityPort, type ConversationAgentBindingAuthorityDependencies, type ConversationAgentBindingCandidate, type ConversationAgentBindingCommand, type ConversationAgentBindingRepository, type ConversationAgentBindingResult, type ConversationAgentBindingVerificationResult, type ConversationAgentBindingVerifier, type ConversationManagedAgentPrincipalValidator } from "./conversation-agent-binding.types";

/**
 * Resolves the complete managed-agent binding required before conversation history is created.
 *
 * The resolver accepts a service candidate only after the AgentService Principal validator, release
 * profile selector, and identity selector each return their owned coordinate. A missing coordinate
 * becomes a denial, which prevents a later creation flow from persisting a partial agent binding.
 * @implements ConversationAgentBindingAuthority
 */
export class ConversationAgentBindingVerificationResolver
{
	/** Holds the transaction-scoped reader and the AgentService-owned Principal validator. */
	public constructor(private readonly repository: ConversationAgentBindingRepository, private readonly managedPrincipalValidator: ConversationManagedAgentPrincipalValidator) {}

	/**
	 * Returns a complete managed binding or the first reason this checkpoint must deny it.
	 *
	 * An empty command denies before any lookup; a personal candidate denies before profile or identity
	 * selection. The remaining checks run in ownership order so no selector sees a Principal that the
	 * AgentService boundary rejected.
	 * @returns `bound` with all creation coordinates, or `denied` without a partial binding.
	 */
	public async verify(command: ConversationAgentBindingCommand): Promise<ConversationAgentBindingVerificationResult>
	{
		if (!_Present(command.siloId) || !_Present(command.agentServiceId))
			return _VerificationDenied(ConversationAgentBindingDenialReasons.InvalidCommand);
		const candidate = await this.repository.load(command);
		if (candidate === null)
			return _VerificationDenied(ConversationAgentBindingDenialReasons.ServiceUnavailable);
		if (candidate.agentServiceKind === "personal")
			return _VerificationDenied(ConversationAgentBindingDenialReasons.PersonalDelegationUnavailable);
		const principalId = candidate.principalId;
		if (principalId === null || candidate.principal === null
			|| !this.managedPrincipalValidator.validate({ agentServiceId: candidate.agentServiceId, principalId, ...candidate.principal }))
			return _VerificationDenied(ConversationAgentBindingDenialReasons.ManagedPrincipalUnavailable);
		return { outcome: "verified", value: { ...candidate, agentServiceKind: "managed", principalId, principal: candidate.principal } };
	}
}

/** Resolves external profile and identity coordinates only after SQL verification has completed. */
export class ConversationAgentBindingResolver implements ConversationAgentBindingAuthorityPort
{
	/** Holds the serializable verifier plus external profile and identity authorities. */
	public constructor(private readonly verifier: ConversationAgentBindingVerifier, private readonly dependencies: ConversationAgentBindingAuthorityDependencies) {}

	/** Returns a complete binding after the verifier has closed its SQL transaction. */
	public async bind(command: ConversationAgentBindingCommand): Promise<ConversationAgentBindingResult>
	{
		const verification = await this.verifier.verify(command);
		if (verification.outcome === "denied")
			return verification;
		const candidate = verification.value;
		const profile = await this.dependencies.profiles.select({ siloId: command.siloId, agentServiceKind: candidate.agentServiceKind });
		if (profile === null)
			return _Denied(ConversationAgentBindingDenialReasons.ProfileUnavailable);
		const identity = await this.dependencies.identities.ensure({ siloId: command.siloId, agentServiceId: candidate.agentServiceId, principalId: candidate.principalId, agentServiceName: candidate.agentServiceName });
		if (identity === null || !_Present(identity.agentIdentityId))
			return _Denied(ConversationAgentBindingDenialReasons.IdentityUnavailable);
		return { outcome: "bound", value: { agentServiceId: candidate.agentServiceId, agentRevisionId: candidate.agentRevisionId, agentServiceKind: "managed", principalId: candidate.principalId, agentIdentityId: identity.agentIdentityId, profileRevisionId: profile.profileRevisionId } };
	}
}

/** Builds a denial result so no branch returns the candidate facts it rejected. */
function _Denied(reason: ConversationAgentBindingDenialReasons): ConversationAgentBindingResult
{
	return { outcome: "denied", reason };
}

/** Builds a verifier denial without pretending it is a complete externally resolved binding. */
function _VerificationDenied(reason: ConversationAgentBindingDenialReasons): ConversationAgentBindingVerificationResult
{
	return { outcome: "denied", reason };
}

/** Checks an input coordinate before a repository or selector receives it. */
function _Present(value: string): boolean
{
	return value.trim().length > 0;
}
