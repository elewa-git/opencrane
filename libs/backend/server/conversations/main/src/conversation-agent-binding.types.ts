import type { ConversationComputerAgentServiceKind, ConversationComputerProfileSelector } from "./conversation-computer-profile-selection.types";

/** Lists the closed reasons a conversation creation flow cannot bind its requested agent. */
export enum ConversationAgentBindingDenialReasons
{
	/** The requested service is absent, foreign, inactive, or has no active published revision. */
	ServiceUnavailable = "service_unavailable",
	/** A managed service's durable Principal does not match its deterministic identity contract. */
	ManagedPrincipalUnavailable = "managed_principal_unavailable",
	/** A personal service cannot act until an explicit owned-personal delegation policy is selected. */
	PersonalDelegationUnavailable = "personal_delegation_unavailable",
	/** The local release does not admit a computer profile for the resolved service kind. */
	ProfileUnavailable = "profile_unavailable",
	/** The identity catalog cannot provide the stable identity that the computer stream must bind. */
	IdentityUnavailable = "identity_unavailable",
	/** The command did not carry server-owned nonempty coordinates. */
	InvalidCommand = "invalid_command",
}

/** Carries the trusted service coordinate for an eventual ConversationCreated command. */
export interface ConversationAgentBindingCommand
{
	/** Identifies the silo containing the active service and immutable revision. */
	readonly siloId: string;
	/** Identifies the AgentService selected by an already-authorized creation flow. */
	readonly agentServiceId: string;
}

/** Represents one exact active service and revision loaded in the binding transaction. */
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

/** Loads an exact active service and published revision inside the caller-owned transaction. */
export interface ConversationAgentBindingRepository
{
	load(command: ConversationAgentBindingCommand): Promise<ConversationAgentBindingCandidate | null>;
}

/** Carries the immutable coordinates used to retrieve a server-owned AgentIdentity. */
export interface ConversationAgentIdentitySelectionCommand
{
	/** Identifies the silo where the identity stream must be owned. */
	readonly siloId: string;
	/** Identifies the already-validated service the identity must realize. */
	readonly agentServiceId: string;
	/** Identifies the exact principal the identity must represent. */
	readonly principalId: string;
}

/** Supplies a stable AgentIdentity id only from a trusted catalog or identity-provisioning authority. */
export interface ConversationAgentIdentitySelector
{
	select(command: ConversationAgentIdentitySelectionCommand): Promise<{ readonly agentIdentityId: string } | null>;
}

/** Represents the complete immutable agent binding later persisted with conversation and computer history anchors. */
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

/** Returns one complete binding or one closed denial that must not reveal a partial agent state. */
export type ConversationAgentBindingResult
	= { readonly outcome: "bound"; readonly value: ConversationAgentBinding }
	| { readonly outcome: "denied"; readonly reason: ConversationAgentBindingDenialReasons };

/** Resolves the agent facts an eventual history-anchored conversation creation command requires. */
export interface ConversationAgentBindingAuthority
{
	bind(command: ConversationAgentBindingCommand): Promise<ConversationAgentBindingResult>;
}

/** Lists the dependencies that keep profile and identity selection out of browser- and database-controlled data. */
export interface ConversationAgentBindingAuthorityDependencies
{
	/** Selects one release-owned profile after the authority resolves the trusted service kind. */
	readonly profiles: ConversationComputerProfileSelector;
	/** Resolves an existing server-owned identity; this authority never manufactures an identity id. */
	readonly identities: ConversationAgentIdentitySelector;
}
