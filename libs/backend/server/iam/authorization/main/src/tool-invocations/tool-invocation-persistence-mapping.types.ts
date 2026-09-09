import type { ToolInvocationRecord } from "./tool-invocation.types";

/** Complete stored row required to verify authorization evidence before returning an invocation. */
export interface ToolInvocationRow extends Omit<ToolInvocationRecord, "authorizationEvidence" | "recoveryMode" | "state" | "claimKind" | "arguments" | "effectiveArguments" | "result">
{
	/** Stored lifecycle name, converted to the public invocation state. */
	readonly state: string;
	/** Stored recovery mode, converted to the public recovery mode. */
	readonly recoveryMode: string;
	/** Stored claim kind, absent before any claim. */
	readonly claimKind: string | null;
	/** Agent identity for a run-owned invocation; absent for task-owned work. */
	readonly agentIdentityId: string | null;
	/** Agent service whose run created the invocation. */
	readonly agentServiceId: string | null;
	/** Principal that received the recorded permission. */
	readonly principalId: string;
	/** Database spelling of the actor kind. */
	readonly authorizationActorKind: string | null;
	/** Saved execution subject, validated before it becomes caller-visible evidence. */
	readonly authorizationExecutionSubject: unknown;
	/** Saved resource and action coordinates. */
	readonly authorizationCoordinates: unknown;
	/** Digests of the permission decisions saved at admission. */
	readonly authorizationDecisionDigests: readonly string[];
	/** Digest of the assignment that allowed this tool. */
	readonly authorizationAssignmentDigest: string | null;
	/** Digest of the complete saved authorization evidence. */
	readonly authorizationEvidenceDigest: string | null;
	/** Original JSON arguments as read from persistence. */
	readonly arguments: unknown;
	/** Arguments the executor actually receives after approval. */
	readonly effectiveArguments: unknown;
	/** Saved provider result, absent until completion. */
	readonly result: unknown;
}
