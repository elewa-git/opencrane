import { ConversationAgentBindingDenialReasons, type ConversationAgentBindingAuthority as ConversationAgentBindingAuthorityPort, type ConversationAgentBindingAuthorityDependencies, type ConversationAgentBindingCandidate, type ConversationAgentBindingCommand, type ConversationAgentBindingRepository, type ConversationAgentBindingResult, type ConversationAgentBindingVerificationResult, type ConversationAgentBindingVerifier, type ConversationManagedAgentPrincipalValidator } from "./conversation-agent-binding.types";

/**
 * Verifies the managed-service snapshot required before external binding work begins.
 *
 * The resolver rejects an absent, personal, or invalid-principal candidate before profile selection
 * or identity provisioning sees it. It returns only checked service facts, so the outer binding
 * authority can resolve those separately owned coordinates after the SQL transaction has closed.
 * @implements ConversationAgentBindingVerifier
 */
export class ConversationAgentBindingVerificationResolver
{
	/** Holds the candidate reader and the AgentService-owned Principal validator. */
	public constructor(private readonly repository: ConversationAgentBindingRepository, private readonly managedPrincipalValidator: ConversationManagedAgentPrincipalValidator) {}

	/**
	 * Returns a verified managed snapshot or the first reason this checkpoint must deny it.
	 *
	 * An empty command denies before any lookup. A personal candidate denies before the profile or
	 * identity authority can receive its Principal. The remaining checks run in ownership order so no
	 * external authority sees a Principal that the AgentService boundary rejected.
	 * @returns `verified` with checked service coordinates, or `denied` without partial facts.
	 */
	public async verify(command: ConversationAgentBindingCommand): Promise<ConversationAgentBindingVerificationResult>
	{
		if (!_Present(command.siloId) || !_Present(command.agentServiceId) || !_Present(command.callerPrincipalId) || !_Present(command.callerSubjectId))
			return _VerificationDenied(ConversationAgentBindingDenialReasons.InvalidCommand);
		const candidate = await this.repository.load(command);
		if (candidate === null)
			return _VerificationDenied(ConversationAgentBindingDenialReasons.ServiceUnavailable);
		if (candidate.agentServiceKind === "personal")
			return { outcome: "verified", value: { ...candidate, agentServiceKind: "personal", principalId: command.callerPrincipalId, delegationPolicyId: `agent-revision:${candidate.agentRevisionId}` } };
		const principalId = candidate.principalId;
		if (principalId === null || candidate.principal === null
			|| !this.managedPrincipalValidator.validate({ agentServiceId: candidate.agentServiceId, principalId, ...candidate.principal }))
			return _VerificationDenied(ConversationAgentBindingDenialReasons.ManagedPrincipalUnavailable);
		return { outcome: "verified", value: { ...candidate, agentServiceKind: "managed", principalId, principal: candidate.principal } };
	}
}

/**
 * Completes a verified service snapshot with its profile and AgentIdentity after SQL has closed.
 *
 * Keeping these separately owned ports outside the serializable unit of work prevents their history
 * work from extending that PostgreSQL transaction. A verifier denial returns unchanged; missing
 * profile or identity coordinates deny the binding.
 * @implements ConversationAgentBindingAuthority
 */
export class ConversationAgentBindingResolver implements ConversationAgentBindingAuthorityPort
{
	/** Holds the serializable verifier plus external profile and identity authorities. */
	public constructor(private readonly verifier: ConversationAgentBindingVerifier, private readonly dependencies: ConversationAgentBindingAuthorityDependencies) {}

	/**
	 * Returns a complete binding after the verifier has closed its SQL transaction.
	 *
	 * The method preserves a verifier denial without calling profile or identity ports. It denies when
	 * either later port cannot provide its coordinate.
	 */
	public async bind(command: ConversationAgentBindingCommand): Promise<ConversationAgentBindingResult>
	{
		const verification = await this.verifier.verify(command);
		if (!("value" in verification))
			return verification;
		const candidate = verification.value;
		const profile = await this.dependencies.profiles.select({ siloId: command.siloId, agentServiceKind: candidate.agentServiceKind });
		if (profile === null)
			return _Denied(ConversationAgentBindingDenialReasons.ProfileUnavailable);
		const identity = await this.dependencies.identities.ensure({ siloId: command.siloId, agentServiceId: candidate.agentServiceId, principalId: candidate.principalId, agentServiceName: candidate.agentServiceName });
		if (identity === null || !_Present(identity.agentIdentityId))
			return _Denied(ConversationAgentBindingDenialReasons.IdentityUnavailable);
		return { outcome: "bound", value: { agentServiceId: candidate.agentServiceId, agentRevisionId: candidate.agentRevisionId, agentServiceKind: candidate.agentServiceKind, principalId: candidate.principalId, agentIdentityId: identity.agentIdentityId, profileRevisionId: profile.profileRevisionId } };
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
