import type { RoutineFiringIdentity } from "@opencrane/backend/server/agents/scheduling/contract";
import type { RoutineOccurrenceConversationGenesisOrigin } from "@opencrane/models/conversations";

/** Content-free evidence frozen after the occurrence's encrypted instruction has been saved. */
export interface RoutineOccurrenceHistoryRecord
{
	/** Organisation containing the routine, payload, conversation and computer. */
	readonly siloId: string;
	/** Independent conversation reserved for this occurrence. */
	readonly conversationId: string;
	/** Immutable routine and firing that own the conversation. */
	readonly origin: RoutineOccurrenceConversationGenesisOrigin;
	/** Managed assistant selected by the original routine. */
	readonly agentServiceId: string;
	/** Original requester retained as approval evidence, never as a current login. */
	readonly requesterPrincipalId: string;
	/** Verified issuer saved when the requester approved the routine. */
	readonly requesterIssuer: string;
	/** Verified subject saved when the requester approved the routine. */
	readonly requesterSubjectId: string;
	/** Original authentication time, which a scheduled firing must never refresh. */
	readonly requesterAuthenticatedAt: string;
	/** Existing workflow task that owns preparation and its retries. */
	readonly task: RoutineFiringIdentity["task"];
	/** Original confirmed audience; this record itself grants no access. */
	readonly audiencePrincipalIds: readonly string[];
	/** Logical computer reserved for this conversation. */
	readonly computerId: string;
	/** Existing managed identity, not a new identity proxied through the requester. */
	readonly agentIdentityId: string;
	/** Published computer profile selected during preparation. */
	readonly profileRevisionId: string;
	/** Stable server creation time saved before attempting history writes. */
	readonly createdAt: string;
	/** Reference to the already-persisted OpenCrane-authored encrypted instruction. */
	readonly payloadRef: string;
	/** Digest of those exact encrypted bytes; no plaintext enters history. */
	readonly ciphertextDigest: `sha256:${string}`;
}
