import type { AgentIdentity } from "@opencrane/contracts";
import type { HistoryExpectedHead, HistoryExpectedRevisions } from "@opencrane/backend/server/infra/history-store";

/** Names the immutable coordinates that select one agent identity and its acting principal. */
export interface AgentIdentityCurrentCommand
{
	/** Identifies the silo that owns the requested identity. */
	readonly siloId: string;
	/** Identifies the stable identity whose deterministic stream may be read. */
	readonly agentIdentityId: string;
	/** Identifies the exact agent service the identity must realize. */
	readonly agentServiceId: string;
	/** Identifies the exact principal that this identity is permitted to represent. */
	readonly principalId: string;
}

/**
 * Limits a ConversationComputer to the identity coordinates it may use to resolve a runtime actor.
 *
 * The computer must not choose an AgentService or Principal. {@link AgentIdentityHistory} derives
 * both from the active identity history so a runtime command cannot substitute another actor.
 */
export interface AgentIdentityRuntimeAuthorizationCommand
{
	/** Identifies the silo that owns the computer-selected identity. */
	readonly siloId: string;
	/** Identifies the active computer's immutable agent identity. */
	readonly agentIdentityId: string;
}

/** Carries one checked identity snapshot append to its deterministic history stream. */
export interface AgentIdentityAppendCommand
{
	/** Requires the stream revision observed by the authority before this append. */
	readonly expectedRevision: HistoryExpectedRevisions.NoStream | bigint;
	/** Supplies the caller-chosen UUID that makes a retried append idempotent. */
	readonly eventId: string;
	/** Carries the complete closed identity snapshot to persist. */
	readonly identity: AgentIdentity;
}

/** Gives a later authorization boundary the current immutable state and stream-head evidence. */
export interface CurrentAgentIdentity
{
	/** Names the stream that supplied the checked identity history. */
	readonly streamName: string;
	/** Reports the exact KurrentDB revision that supplied this current snapshot. */
	readonly revision: bigint;
	/** Digests the exact stream event behind this snapshot so a later check can tell whether the identity head moved. @see ___DigestCanonicalJson for the RFC 8785 digest this holds. */
	readonly headDigest: string;
	/** Carries the validated identity snapshot at the reported revision. */
	readonly identity: AgentIdentity;
}

/**
 * Gives a runtime command the actor derived from a checked active identity.
 *
 * A proxied identity acts as its proxied user, while managed identities act through their dedicated
 * AgentService principal. A later command append must preserve every {@link expectedIdentityHeads}
 * condition or re-read this result; otherwise a suspended identity or changed parent could authorize
 * work after the identity history changed.
 */
export interface ActiveAgentIdentityAuthorization extends CurrentAgentIdentity
{
	/** Lists every active identity and managed-sub-chat parent stream condition to preserve atomically. */
	readonly expectedIdentityHeads: readonly HistoryExpectedHead[];
	/** Identifies the AgentService realized by the checked identity. */
	readonly agentServiceId: string;
	/** Identifies the current Principal that authorization must evaluate. */
	readonly principalId: string;
	/** States whether the checked identity acts through a user or dedicated agent-service principal. */
	readonly actorKind: "user" | "agent-service";
	/** Identifies the proxied user or checked managed identity recorded in authorization evidence. */
	readonly actorId: string;
}
