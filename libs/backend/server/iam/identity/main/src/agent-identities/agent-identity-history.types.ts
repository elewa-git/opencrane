import type { AgentIdentity } from "@opencrane/contracts";
import type { HistoryExpectedRevisions } from "@opencrane/backend/server/infra/history-store";

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
