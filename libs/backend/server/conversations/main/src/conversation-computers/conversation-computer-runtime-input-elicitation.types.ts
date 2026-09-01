import type { HistoryAppendReceipt } from "@opencrane/backend/server/infra/history-store";

/** Carries the runtime facts for one ordinary input request; authority coordinates are all derived server-side. */
export interface ConversationComputerRuntimeInputElicitationCommand
{
	readonly siloId: string;
	readonly computerId: string;
	readonly conversationId: string;
	readonly profileRevisionId: string;
	readonly requestId: string;
	readonly elicitationId: string;
	readonly requestPayloadRef: string;
	readonly requestPayloadDigest: `sha256:${string}`;
	readonly causationId: string;
	readonly correlationId: string;
}

/** Resolves an active addressed participant from trusted server-side participation state. */
export interface ConversationComputerRuntimeInputParticipantResolver
{
	resolve(command: { readonly siloId: string; readonly conversationId: string; readonly computerId: string; readonly agentIdentityId: string }): Promise<{ readonly participantId: string }>;
}

/** Owns the current clock used for deadline and authorization checks. */
export interface ConversationComputerRuntimeInputClock { now(): Date; }

/** Returns the KurrentDB receipt for the sole conversation append this authority performs. */
export interface ConversationComputerRuntimeInputElicitationResult { readonly receipt: HistoryAppendReceipt; }
