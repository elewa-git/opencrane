import type { RoutineSchedule } from "@opencrane/models/agents";

import type { RequestRoutineProposalSource } from "./request-routine-proposal-source.types";

/** Strict model arguments for a routine suggestion; the server supplies all requester and authority facts. */
export interface RequestRoutineSuggestion
{
	/** Plaintext instruction proposed for later human review. */
	readonly instruction: string;
	/** Schedule proposed for later human review. */
	readonly schedule: RoutineSchedule;
}

/** Scheduling-owned command emitted by one validated first-party model selection. */
export interface RequestRoutineProposalCommand extends RequestRoutineProposalSource
{
	/** Strict suggestion validated against the frozen request_routine tool schema. */
	readonly suggestion: RequestRoutineSuggestion;
}

/** Durable proposal identity returned to the conversation notification owner. */
export interface RequestRoutineProposalReceipt
{
	/** Opaque scheduling-owned proposal reference. */
	readonly proposalRef: string;
	/** Database-clock deadline after which human acceptance is refused. */
	readonly expiresAt: string;
}

/** First-party dispatch port that persists one proposal without executing a routine. */
export interface RequestRoutineProposalPort
{
	/** Creates or recovers the exact source-slot proposal after current source authorization. */
	propose(command: RequestRoutineProposalCommand): Promise<RequestRoutineProposalReceipt>;
}

/** Content-free evidence required before conversation history announces a proposal. */
export interface RequestRoutineProposalNotificationEvidence extends RequestRoutineProposalSource, RequestRoutineProposalReceipt {}

/** Scheduling-owned reader used by the durable requester-only notification publisher. */
export interface RequestRoutineProposalNotificationEvidenceReader
{
	/** Returns an exact pending, unexpired proposal or null without exposing its suggestion. */
	readCurrent(command: RequestRoutineProposalNotificationEvidence): Promise<RequestRoutineProposalNotificationEvidence | null>;
}
