import type { ConversationModelPreForwardReceipt } from "@opencrane/contracts";
import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";

import type { FrozenConversationComputerTurn } from "./conversation-computer-turn.types";

/** Non-secret evidence authenticated by the model transport before entering durable history. */
export interface ConversationComputerModelRejection
{
	/** Binds the physical request, original deadline and local limiter reset. */
	readonly receipt: ConversationModelPreForwardReceipt;
	/** Requires the next claimant to reuse the exact already-issued credential. */
	readonly credentialDigest: string;
	/** Preserves the provider-reported expiry without issuing or renewing a key. */
	readonly credentialExpiresAt: string;
	/** Records receipt delivery, not a new request or authority deadline. */
	readonly receivedAtEpochMs: number;
}

/** One fresh physical send claimed after a saved no-forward rejection. */
export interface ConversationComputerModelRetryClaim
{
	/** Identifies the unchanged logical model step. */
	readonly ordinal: number;
	/** Requires the original paid-model reservation fence. */
	readonly modelInvocationFence: string;
	/** Counts physical retry claims without consuming another logical reservation. */
	readonly retryOrdinal: number;
	/** Identifies this physical request and cannot reuse an earlier rejected nonce. */
	readonly physicalNonce: string;
	/** Must follow the saved reset and remain before the original request deadline. */
	readonly claimedAtEpochMs: number;
}

/** Retry evidence for only the current logical reservation; replay grants no dispatch authority. */
export interface ConversationComputerModelRetryProjection
{
	/** Retains every rejected physical request in order, including a final exhausted rejection. */
	readonly rejections: readonly ConversationComputerModelRejection[];
	/** Retains the latest saved claim; observing it never permits another process to send. */
	readonly claim: ConversationComputerModelRetryClaim | null;
}

/** Existing turn-store operations used for conditional model-dispatch claims, never model I/O. */
export interface ConversationComputerModelPersistence
{
	/** Appends to the existing turn stream at its replayed revision. */
	readonly history: Pick<HistoryStore, "append" | "readStream">;
	/** Replays and validates the complete turn stream before and after a claim. */
	readonly load: (bootstrapId: string) => Promise<FrozenConversationComputerTurn | null>;
}
