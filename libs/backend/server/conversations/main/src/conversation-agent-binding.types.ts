import type { ConversationComputerAgentServiceKind, ConversationComputerProfileSelector } from "./conversation-computer-profile-selection.types";

/**
 * Explains why the pre-creation authority did not return an AgentService binding.
 *
 * Each reason means the future history-anchored creation flow has no complete binding to persist.
 */
export enum ConversationAgentBindingDenialReasons
{
	/** The requested service is absent, belongs to another silo, is inactive, or lacks a published active revision. */
	ServiceUnavailable = "service_unavailable",
	/** The stored Principal does not meet the managed service's issuer, subject, and identity contract. */
	ManagedPrincipalUnavailable = "managed_principal_unavailable",
	/** A personal service has no selected delegation policy or proxied identity in this checkpoint. */
	PersonalDelegationUnavailable = "personal_delegation_unavailable",
	/** The local release does not admit a computer profile for the resolved service kind. */
	ProfileUnavailable = "profile_unavailable",
	/** The identity authority did not provide the stored AgentIdentity needed by the computer stream. */
	IdentityUnavailable = "identity_unavailable",
	/** The caller supplied an empty silo or service coordinate, so no repository lookup ran. */
	InvalidCommand = "invalid_command",
}

/** Carries the silo and service that an already-authorized creation flow resolved. */
export interface ConversationAgentBindingCommand
{
	/** Identifies the silo containing the active service and immutable revision. */
	readonly siloId: string;
	/** Identifies the AgentService selected by an already-authorized creation flow. */
	readonly agentServiceId: string;
}

/** Holds service facts before their Principal, profile, and AgentIdentity checks complete. */
export interface ConversationAgentBindingCandidate
{
	/** Identifies the active service in the command silo. */
	readonly agentServiceId: string;
	/** Identifies the published revision selected by the service's current pointer. */
	readonly agentRevisionId: string;
	/** States which principal and delegation rules apply to the service. */
	readonly agentServiceKind: ConversationComputerAgentServiceKind;
	/** Identifies the service principal when the service is managed, otherwise null. */
	readonly principalId: string | null;
	/** Gives the durable Principal facts that prove the managed-service identity, otherwise null. */
	readonly principal: { readonly issuer: string; readonly provenance: "internal" | "external"; readonly subject: string } | null;
}

/**
 * Loads an active service and the published revision named by its active pointer.
 *
 * `null` denies creation rather than allowing a stale service fact to proceed.
 */
export interface ConversationAgentBindingRepository
{
	load(command: ConversationAgentBindingCommand): Promise<ConversationAgentBindingCandidate | null>;
}

/** Carries checked service and Principal coordinates for an existing AgentIdentity lookup. */
export interface ConversationAgentIdentitySelectionCommand
{
	/** Identifies the silo where the identity stream must be owned. */
	readonly siloId: string;
	/** Identifies the already-validated service the identity must realize. */
	readonly agentServiceId: string;
	/** Identifies the exact principal the identity must represent. */
	readonly principalId: string;
}

/**
 * Selects an existing AgentIdentity from its owning authority.
 *
 * `null` denies the binding; this checkpoint has no AgentService-to-AgentIdentity producer and no
 * fallback identity creation.
 */
export interface ConversationAgentIdentitySelector
{
	select(command: ConversationAgentIdentitySelectionCommand): Promise<{ readonly agentIdentityId: string } | null>;
}

/**
 * Checks the Principal facts that identify a managed AgentService.
 *
 * The AgentService boundary owns the rule, so a false result denies before profile or identity
 * selection can use the service.
 */
export interface ConversationManagedAgentPrincipalValidator
{
	validate(command: { readonly agentServiceId: string; readonly principalId: string; readonly issuer: string; readonly provenance: "internal" | "external"; readonly subject: string }): boolean;
}

/**
 * Represents every managed-agent coordinate that a later creation command must persist together.
 *
 * Personal services deny until their delegation policy can supply an identity.
 */
export interface ConversationAgentBinding
{
	/** Identifies the active service. */
	readonly agentServiceId: string;
	/** Identifies the active published revision. */
	readonly agentRevisionId: string;
	/** Identifies the managed service kind. */
	readonly agentServiceKind: "managed";
	/** Identifies the service's verified dedicated Principal. */
	readonly principalId: string;
	/** Identifies the stable AgentIdentity selected by the trusted identity authority. */
	readonly agentIdentityId: string;
	/** Identifies the immutable release-owned computer profile revision. */
	readonly profileRevisionId: string;
}

/** Returns complete creation coordinates or a denial with no partial binding to persist. */
export type ConversationAgentBindingResult
	= { readonly outcome: "bound"; readonly value: ConversationAgentBinding }
	| { readonly outcome: "denied"; readonly reason: ConversationAgentBindingDenialReasons };

/**
 * Resolves the service, revision, Principal, profile, and AgentIdentity that pre-creation needs.
 *
 * It denies when any owned boundary cannot supply its coordinate; it never creates an identity or
 * falls back to the older personal-service lookup.
 */
export interface ConversationAgentBindingAuthority
{
	bind(command: ConversationAgentBindingCommand): Promise<ConversationAgentBindingResult>;
}

/** Lists the separately owned policy ports that complete a repository candidate. */
export interface ConversationAgentBindingAuthorityDependencies
{
	/** Selects one release-owned profile after the authority resolves the trusted service kind. */
	readonly profiles: ConversationComputerProfileSelector;
	/** Verifies managed Principal facts through the independently-owned AgentService contract. */
	readonly managedPrincipalValidator: ConversationManagedAgentPrincipalValidator;
	/** Resolves an existing server-owned identity; this authority never manufactures an identity id. */
	readonly identities: ConversationAgentIdentitySelector;
}
