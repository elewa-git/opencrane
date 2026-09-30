import type { ConversationModelPreForwardReceipt, ConversationModelUsage, ModelTariffQuote } from "@opencrane/contracts";

/**
 * Projects a persisted managed-budget effect into in-process receipts and results. These strings
 * are not stored separately or sent over a wire; changing one requires updating every caller that
 * branches on the durable lifecycle projection.
 */
export enum ManagedMonthlyBudgetReservationStates
{
	/** The effect is held but has not claimed a provider request. */
	Reserved = "reserved",
	/** A physical provider request already owns the hold. */
	Claimed = "claimed",
	/** Known usage already settled the effect. */
	Settled = "settled",
	/** Unknown provider cost keeps the worst-case amount charged. */
	Unknown = "unknown",
	/** Known usage exceeded the admitted bound or signed storage range. */
	PriceIntegrityBreach = "price_integrity_breach",
	/** The undispatched effect was cancelled after admission closed. */
	Cancelled = "cancelled",
}

/**
 * Closed reserve outcomes used transiently between the ledger and its server caller. These values
 * are never persisted or sent over a wire; changing one requires updating every in-process caller.
 */
export enum ManagedMonthlyBudgetReserveResultKinds
{
	/** The saved service and execution subject prove personal work on its existing charging path. */
	Personal = "personal",
	/** The exact logical effect now owns capacity and carries its durable receipt. */
	Reserved = "reserved",
	/** Current held or incurred liability leaves too little temporary capacity. */
	InsufficientCapacity = "insufficient_capacity",
	/** At least one applicable monthly account is durably closed. */
	AdmissionClosed = "admission_closed",
}

/** Stable receipt for one logical model call across process restarts. */
export interface ManagedMonthlyBudgetReservation
{
	/** Identifies the one logical paid effect. */
	readonly effectId: string;
	/** Identifies the organization fixed by the admitted run. */
	readonly siloId: string;
	/** Identifies the run that owns the effect. */
	readonly runId: string;
	/** Fences the exact run attempt. */
	readonly runAttempt: number;
	/** Identifies the authorized payer copied from the admitted run. */
	readonly payingGroupId: string;
	/** Identifies the optional assistant-level ceiling coordinate. */
	readonly agentServiceId: string;
	/** Deduplicates one logical model request across workflow retries. */
	readonly logicalFence: string;
	/** Binds the exact model selected for the logical request. */
	readonly modelAlias: string;
	/** Binds the tariff's maximum admitted input tokens. */
	readonly maxInputTokens: number;
	/** Binds the requested completion ceiling. */
	readonly maxCompletionTokens: number;
	/** Fixes the UTC month selected with the database clock. */
	readonly periodStart: string;
	/** Holds the admitted maximum charge while the outcome is unknown. */
	readonly worstCaseEurMicros: string;
	/** Identifies the immutable tariff database row. */
	readonly tariffRevisionId: string;
	/** Identifies the immutable tariff revision used for pricing. */
	readonly tariffRevision: number;
	/** Binds the complete immutable tariff identity. */
	readonly tariffDigest: string;
	/** Binds the tariff and both request ceilings used by the reservation. */
	readonly quoteDigest: string;
	/** Reports the current durable effect lifecycle. */
	readonly state: ManagedMonthlyBudgetReservationStates;
}

/** Server-owned coordinates needed to reserve one logical paid request. */
export interface ManagedMonthlyBudgetReserveCommand
{
	/** Identifies the organization fixed by the admitted run. */
	readonly siloId: string;
	/** Identifies the admitted run. */
	readonly runId: string;
	/** Fences the current run attempt. */
	readonly runAttempt: number;
	/** Deduplicates the logical model request. */
	readonly logicalFence: string;
	/** Must equal the run's admitted model alias and tariff identity. */
	readonly modelAlias: string;
	/** Fixes the requested completion ceiling. */
	readonly maxCompletionTokens: number;
	/** Supplies the server-owned, validated tariff quote. */
	readonly quote: ModelTariffQuote;
}

/** Closed result of managed monthly-budget reservation admission. */
export type ManagedMonthlyBudgetReserveResult =
	| { readonly kind: ManagedMonthlyBudgetReserveResultKinds.Personal }
	| { readonly kind: ManagedMonthlyBudgetReserveResultKinds.Reserved; readonly reservation: ManagedMonthlyBudgetReservation }
	| { readonly kind: ManagedMonthlyBudgetReserveResultKinds.InsufficientCapacity }
	| { readonly kind: ManagedMonthlyBudgetReserveResultKinds.AdmissionClosed };

/** Exact physical dispatch identity claimed beneath a logical reservation. */
export interface ManagedMonthlyBudgetAttemptCommand
{
	/** Carries the durable logical effect receipt. */
	readonly reservation: ManagedMonthlyBudgetReservation;
	/** Identifies one physical provider request beneath that effect. */
	readonly physicalNonce: string;
	/** Binds the exact serialized request authenticated by the transport. */
	readonly requestBodySha256: string;
	/** Preserves the original provider-request deadline without extension. */
	readonly deadlineEpochMs: number;
}

/** Authenticated proof that one claimed request did not reach the provider. */
export interface ManagedMonthlyBudgetPreForwardReleaseCommand extends ManagedMonthlyBudgetAttemptCommand
{
	/** Supplies the transport-verified no-forward receipt for the exact claim. */
	readonly receipt: ConversationModelPreForwardReceipt;
}

/** Known provider usage supplied only after transport validation. */
export interface ManagedMonthlyBudgetSettlementCommand extends ManagedMonthlyBudgetAttemptCommand
{
	/** Supplies normalized provider evidence; unknown evidence retains the full hold. */
	readonly usage: ConversationModelUsage;
}

/** Result of claiming a physical attempt. */
export interface ManagedMonthlyBudgetClaimResult
{
	/** True only for the transaction that inserted this exact provider request. */
	readonly mayDispatch: boolean;
	/** Current durable state after the claim or replay check. */
	readonly state: ManagedMonthlyBudgetReservationStates;
	/** Whether an applicable account is durably closed, not merely out of held capacity. */
	readonly admissionClosed: boolean;
}

/** Result after known or unknown usage closes one effect. */
export interface ManagedMonthlyBudgetSettlementResult
{
	/** Reports the durable terminal or retained-liability state. */
	readonly state: ManagedMonthlyBudgetReservationStates;
	/** Exact known charge, including values outside signed PostgreSQL bigint storage. */
	readonly actualEurMicros?: string;
	/** Whether an applicable account is durably closed, not merely out of held capacity. */
	readonly admissionClosed: boolean;
}

/** Hard-budget authority invoked immediately around each physical model request. */
export interface ManagedMonthlyBudgetAuthority
{
	/** Reserves managed work or returns the exact personal/capacity/closure outcome. */
	reserve(command: ManagedMonthlyBudgetReserveCommand): Promise<ManagedMonthlyBudgetReserveResult>;
	/** Claims the one physical request that may dispatch. */
	claim(command: ManagedMonthlyBudgetAttemptCommand): Promise<ManagedMonthlyBudgetClaimResult>;
	/** Returns a transport-proven no-forward attempt to its original logical reservation. */
	releasePreForward(command: ManagedMonthlyBudgetPreForwardReleaseCommand): Promise<void>;
	/** Settles known usage or retains normalized unknown usage as full liability. */
	settle(command: ManagedMonthlyBudgetSettlementCommand): Promise<ManagedMonthlyBudgetSettlementResult>;
	/** Retains the full worst-case hold after an ambiguous provider outcome. */
	retainUnknown(command: ManagedMonthlyBudgetAttemptCommand): Promise<ManagedMonthlyBudgetSettlementResult>;
}
