import type { ElicitationPurposes, ElicitationResponseValue } from "@opencrane/contracts";

/** Exact persisted request coordinates consumed by one purpose strategy. */
export interface ElicitationPurposeRequest
{
	/** Stable request identifier. */
	readonly id: string;
	/** Exact run paused by the request. */
	readonly runId: string;
	/** Exact run attempt paused by the request. */
	readonly attempt: number;
	/** Protected server-owned payload, never projected to clients. */
	readonly purposePayload: unknown;
	/** Canonical digest of the protected payload. */
	readonly purposePayloadDigest: string;
	/** Participant authorized to resolve the request. */
	readonly assignedParticipantId: string;
	/** Server-owned response deadline. */
	readonly expiresAt: Date;
}

/** Transaction-bound consequence for one durable elicitation purpose. */
export interface ElicitationPurposeStrategy
{
	/** Apply one already-validated attributed response. */
	apply(request: ElicitationPurposeRequest, response: ElicitationResponseValue, subjectId: string, now: Date): Promise<boolean>;
	/** Apply purpose-specific expiry before the generic request terminal transition. */
	expire(request: ElicitationPurposeRequest, now: Date): Promise<void>;
}

/** Exhaustive selector for the strategy owned by each durable purpose. */
export interface ElicitationPurposeStrategyRegistry
{
	/** Return the exact strategy; unknown durable values fail closed. */
	forPurpose(purpose: ElicitationPurposes): ElicitationPurposeStrategy;
}

/** Transaction-bound repository operations consumed by purpose strategies. */
export interface ElicitationPurposeStrategyDependencies
{
	/** Persist one ordinary runtime response. */
	applyRuntimeInput(request: ElicitationPurposeRequest, response: ElicitationResponseValue): Promise<boolean>;
	/** Decide one protected deferred tool approval. */
	applyToolApproval(request: ElicitationPurposeRequest, response: ElicitationResponseValue, subjectId: string, now: Date): Promise<boolean>;
	/** Decide one exact personal-memory permission. */
	applyPersonalMemoryPermission(request: ElicitationPurposeRequest, response: ElicitationResponseValue, subjectId: string, now: Date): Promise<boolean>;
	/** Persist one display-safe A2UI action. */
	applyA2uiAction(request: ElicitationPurposeRequest, response: ElicitationResponseValue): Promise<boolean>;
	/** Expire a deferred tool approval. */
	expireToolApproval(request: ElicitationPurposeRequest, now: Date): Promise<void>;
	/** Expire an exact personal-memory permission. */
	expirePersonalMemoryPermission(request: ElicitationPurposeRequest, now: Date): Promise<void>;
	/** Publish an empty runtime-visible terminal delivery. */
	expireRuntimeDelivery(request: ElicitationPurposeRequest): Promise<void>;
}
