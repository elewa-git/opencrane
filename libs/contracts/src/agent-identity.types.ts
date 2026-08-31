/**
 * States whether an identity may request new protected work.
 *
 * Authorization evaluates this state with the identity's current PostgreSQL authority; it is not a
 * grant by itself. These strings cross the contract boundary, so consumers must reject an unknown
 * state instead of treating it as active.
 */
export enum AgentIdentityStates
{
	/** The identity may act when current PostgreSQL authority allows the requested action. */
	Active = "active",
	/** The identity remains historical but cannot start new protected work. */
	Suspended = "suspended",
	/** The identity is permanently denied from new protected work. */
	Revoked = "revoked",
}

/**
 * Defines the shared contract coordinates for every agent identity.
 *
 * The concrete identity kind determines whose principal acts. The common fields keep the identity,
 * silo, service, and current state available to each kind without allowing a caller to infer an
 * authorization result from the record alone.
 */
export interface AgentIdentityBase
{
	/** Names the persisted contract shape. */
	readonly schemaVersion: 1;
	/** Identifies this stable agent identity. */
	readonly id: string;
	/** Identifies the silo that owns this identity. */
	readonly siloId: string;
	/** Identifies the agent service this identity realizes. */
	readonly agentServiceId: string;
	/** Captures the participant-facing name at this identity revision. */
	readonly name: string;
	/** Identifies the optional immutable avatar artifact revision. */
	readonly avatarArtifactRevisionId: string | null;
	/** States whether protected work may be requested. */
	readonly state: AgentIdentityStates;
	/** Identifies the principal that created this identity. */
	readonly createdByPrincipalId: string;
	/** Records when this identity was created. */
	readonly createdAt: string;
}

/**
 * Represents an identity that acts through a current principal and its delegation policy.
 *
 * Consumers must evaluate the referenced principal and policy when a protected request arrives;
 * this record does not copy their authority into the identity.
 */
export interface ProxiedAgentIdentity extends AgentIdentityBase
{
	/** Selects the proxied identity handler. */
	readonly kind: "proxied";
	/** Identifies the principal whose current authority is delegated. */
	readonly proxiedPrincipalId: string;
	/** Identifies the policy that limits this delegation. */
	readonly delegationPolicyId: string;
}

/** Adds the dedicated principal used by an OpenCrane-managed identity. */
export interface ConstructedAgentIdentityBase extends AgentIdentityBase
{
	/** Identifies the dedicated principal for this constructed agent. */
	readonly principalId: string;
}

/** Represents a managed agent that acts through its own dedicated principal. */
export interface ManagedAgentIdentity extends ConstructedAgentIdentityBase
{
	/** Selects the managed identity handler. */
	readonly kind: "managed";
}

/**
 * Represents a managed agent for one sub-chat conversation.
 *
 * The parent identity, parent conversation, and requester remain explicit so an authority can
 * evaluate the sub-chat in its originating context instead of treating it as its parent.
 */
export interface ManagedSubchatAgentIdentity extends ConstructedAgentIdentityBase
{
	/** Selects the managed-subchat identity handler. */
	readonly kind: "managed_subchat";
	/** Identifies the parent agent identity that requested this sub-chat. */
	readonly parentAgentIdentityId: string;
	/** Identifies the parent conversation from which this sub-chat was requested. */
	readonly parentConversationId: string;
	/** Identifies the sub-chat conversation owned by this identity. */
	readonly conversationId: string;
	/** Identifies the principal that requested this sub-chat. */
	readonly requestedByPrincipalId: string;
}

/** Lists the constructed identity records a loader may construct. */
export type ConstructedAgentIdentity = ManagedAgentIdentity | ManagedSubchatAgentIdentity;

/**
 * Lists every concrete identity record a loader may construct.
 *
 * Consumers branch on the kind field to determine the principal relationship. An unknown kind is
 * not a usable identity because it has no documented authority evaluation path.
 */
export type AgentIdentity = ProxiedAgentIdentity | ConstructedAgentIdentity;
