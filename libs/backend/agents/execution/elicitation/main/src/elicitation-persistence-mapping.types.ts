import type { ElicitationPurposes, ElicitationRequestStates } from "@opencrane/contracts";

/** Persistence fields needed to build a browser-safe elicitation projection. */
export type ElicitationProjectionRow = {
	/** Stable request identifier. */
	readonly id: string;
	/** Conversation that owns the request. */
	readonly conversationId: string;
	/** Run paused by the request. */
	readonly runId: string;
	/** Run attempt paused by the request. */
	readonly attempt: number;
	/** Participant allowed to answer the request. */
	readonly assignedParticipantId: string;
	/** Persisted purpose vocabulary. */
	readonly purpose: ElicitationPurposes;
	/** Persisted lifecycle state. */
	readonly state: ElicitationRequestStates;
	/** Browser-safe request body. */
	readonly body: unknown;
	/** Whether the answer requires recent step-up authentication. */
	readonly requiresStepUp: boolean;
	/** Time at which the request was created. */
	readonly createdAt: Date;
	/** Time after which the request can no longer be answered. */
	readonly expiresAt: Date;
	/** Time at which the request reached a final state. */
	readonly resolvedAt: Date | null;
	/** Safe public reason for a final state. */
	readonly safeReason: string | null;
};

/** Stored fields compared with caller-controlled values when a request is replayed. */
export type ElicitationReplayRow = {
	/** Stable request identifier. */
	readonly id: string;
	/** Silo that owns the request. */
	readonly siloId: string;
	/** Conversation that owns the request. */
	readonly conversationId: string;
	/** Run paused by the request. */
	readonly runId: string;
	/** Run attempt paused by the request. */
	readonly attempt: number;
	/** Participant allowed to answer the request. */
	readonly assignedParticipantId: string;
	/** Caller-owned replay key. */
	readonly requestKey: string;
	/** Stored purpose value supplied by the Prisma owner. */
	readonly purpose: string;
	/** Stored body-kind value supplied by the Prisma owner. */
	readonly bodyKind: string;
	/** Digest of the public body. */
	readonly bodyDigest: string;
	/** Digest of the protected purpose payload. */
	readonly purposePayloadDigest: string;
	/** Whether the answer requires recent step-up authentication. */
	readonly requiresStepUp: boolean;
};
