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
	/** Identifies the authenticated Principal that a personal service may proxy. */
	readonly callerPrincipalId: string;
	/** Identifies the authenticated user whose active persona owns a personal service. */
	readonly callerSubjectId: string;
}

/** Holds service facts before their Principal, profile, and AgentIdentity checks complete. */
export interface ConversationAgentBindingCandidate
{
	/** Carries the service name read with the snapshot so identity provisioning can seed its deterministic history. */
	readonly agentServiceName: string;
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
export type ConversationAgentIdentitySelectionCommand
	= {
	/** Identifies the silo where the identity stream must be owned. */
	readonly siloId: string;
	/** Identifies the already-validated service the identity must realize. */
	readonly agentServiceId: string;
	/** Identifies the exact principal the identity must represent. */
	readonly principalId: string;
	/** Carries the database-selected service name when provisioning the first AgentIdentity history event. */
	readonly agentServiceName: string;
	/** Selects the managed identity provisioner. */
	readonly agentServiceKind: "managed";
}
	| {
		/** Identifies the silo where the identity stream must be owned. */
		readonly siloId: string;
		/** Identifies the personal AgentService that the caller verified. */
		readonly agentServiceId: string;
		/** Identifies the user Principal whose current authority the personal agent may proxy. */
		readonly principalId: string;
		/** Carries the personal-agent display name for the immutable identity snapshot. */
		readonly agentServiceName: string;
		/** Selects the proxied identity provisioner. */
		readonly agentServiceKind: "personal";
		/** Pins the active revision policy as the personal delegation ceiling. */
		readonly delegationPolicyId: string;
	};

/**
 * Returns or provisions the deterministic AgentIdentity from its owning authority.
 *
 * The selector receives the database-verified service facts after SQL verification has closed, so
 * it can create the first identity-history event without a browser-chosen identity. `null` denies
 * the binding.
 */
export interface ConversationAgentIdentitySelector
{
	/** Returns the existing or newly provisioned identity, or `null` when the binding must deny. */
	ensure(command: ConversationAgentIdentitySelectionCommand): Promise<{ readonly agentIdentityId: string } | null>;
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
	/** Identifies the managed or proxied personal service kind. */
	readonly agentServiceKind: ConversationComputerAgentServiceKind;
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
 * It verifies the service, revision, and Principal before profile selection and AgentIdentity
 * provisioning run outside the serializable SQL transaction. It denies when an owned boundary
 * cannot supply its coordinate and never falls back to the older personal-service lookup.
 */
export interface ConversationAgentBindingAuthority
{
	/** Returns complete creation coordinates, or the denial that prevents the creation flow from continuing. */
	bind(command: ConversationAgentBindingCommand): Promise<ConversationAgentBindingResult>;
}

/**
 * Verifies the database-backed managed-service facts before the outer authority calls external ports.
 *
 * A verified outcome lets the caller select a profile and provision an AgentIdentity after SQL has
 * closed. A denied outcome tells the caller to stop without calling either port.
 */
export interface ConversationAgentBindingVerifier
{
	/** Returns a verified snapshot, or the denial that prevents profile and identity resolution. */
	verify(command: ConversationAgentBindingCommand): Promise<ConversationAgentBindingVerificationResult>;
}

/**
 * Describes the result of checking a service snapshot.
 *
 * `verified` carries managed-service facts that later profile and identity resolution may consume.
 * `denied` preserves the reason without exposing a partial binding.
 */
export type ConversationAgentBindingVerificationResult
	= { readonly outcome: "verified"; readonly value: ConversationAgentBindingCandidate & { readonly agentServiceKind: "managed"; readonly principalId: string; readonly principal: { readonly issuer: string; readonly provenance: "internal" | "external"; readonly subject: string } } }
	| { readonly outcome: "verified"; readonly value: ConversationAgentBindingCandidate & { readonly agentServiceKind: "personal"; readonly principalId: string; readonly delegationPolicyId: string } }
	| { readonly outcome: "denied"; readonly reason: ConversationAgentBindingDenialReasons };

/** Lists the separately owned policy ports that complete a repository candidate. */
export interface ConversationAgentBindingAuthorityDependencies
{
	/** Selects one release-owned profile after the authority resolves the trusted service kind. */
	readonly profiles: ConversationComputerProfileSelector;
	/** Ensures the server-owned identity; this authority never accepts a browser identity id. */
	readonly identities: ConversationAgentIdentitySelector;
}
