import type { ModelTariffQuote } from "@opencrane/contracts";

import type { ManagedMonthlyBudgetReserveCommand } from "./monthly-budget.types";

/** Current mutable policy values used by admission. */
export interface ManagedMonthlyBudgetPolicyRecord
{
	readonly id: string;
	readonly siloId: string;
	readonly scope: string;
	readonly scopeKey: string;
	readonly groupId: string | null;
	readonly agentServiceId: string | null;
	readonly limitEurMicros: bigint;
	readonly revision: number;
}

/** Monthly account with its current policy and counters. */
export interface ManagedMonthlyBudgetAccountRecord
{
	readonly id: string;
	readonly siloId: string;
	readonly policyId: string;
	readonly periodStart: Date;
	readonly policyRevision: number;
	readonly limitEurMicros: bigint;
	readonly settledEurMicros: bigint;
	readonly unknownEurMicros: bigint;
	readonly claimedEurMicros: bigint;
	readonly reservedEurMicros: bigint;
	readonly admissionClosedAt: Date | null;
	readonly policy: ManagedMonthlyBudgetPolicyRecord;
}

/** Immutable physical claim evidence retained under one logical effect. */
export interface ManagedMonthlyBudgetAttemptRecord
{
	readonly id: string;
	readonly physicalNonce: string;
	readonly requestBodySha256: string;
	readonly deadlineEpochMs: bigint;
	readonly state: string;
}

/** Immutable tariff values needed to replay a known settlement. */
export interface ManagedMonthlyBudgetTariffRecord
{
	readonly id: string;
	readonly revision: number;
	readonly digest: string;
	readonly tokenUnit: bigint;
	readonly maxInputTokens: number;
	readonly inputEurMicrosPerUnit: bigint;
	readonly outputEurMicrosPerUnit: bigint;
	readonly effectiveAt: Date;
	readonly validUntil: Date;
}

/** Effect plus immutable price coordinates and impacted monthly accounts. */
export interface ManagedMonthlyBudgetEffectRecord
{
	readonly id: string;
	readonly siloId: string;
	readonly runId: string;
	readonly runAttempt: number;
	readonly payingGroupId: string;
	readonly agentServiceId: string;
	readonly logicalFence: string;
	readonly modelAlias: string;
	readonly periodStart: Date;
	readonly tariffRevisionId: string;
	readonly tariffRevision: number;
	readonly tariffDigest: string;
	readonly quoteDigest: string;
	readonly maxInputTokens: number;
	readonly maxCompletionTokens: number;
	readonly worstCaseEurMicros: bigint;
	readonly actualEurMicros: bigint | null;
	readonly actualInputTokens: bigint | null;
	readonly actualOutputTokens: bigint | null;
	readonly state: string;
	readonly tariff: ManagedMonthlyBudgetTariffRecord;
	readonly attempts: readonly ManagedMonthlyBudgetAttemptRecord[];
	readonly impacts: readonly { readonly accountId: string; readonly account: ManagedMonthlyBudgetAccountRecord }[];
}

/** Stored run identity needed to prove personal work or the complete managed payer tuple. */
export interface ManagedMonthlyBudgetRunRecord
{
	readonly id: string;
	readonly siloId: string;
	readonly attempt: number;
	readonly state: string;
	readonly agentServiceId: string;
	readonly payingGroupId: string | null;
	readonly payingGroupAuthorizationDecisionDigest: string | null;
	readonly payingGroupAuthorizationPolicyRevisionHash: string | null;
	readonly payingGroupEffectiveAuthorizationDigest: string | null;
	readonly executionSubject: unknown;
	readonly inputSnapshotDigest: string;
	readonly service: { readonly kind: string };
}

/** Persisted tariff row plus its model alias owner. */
export interface ManagedMonthlyBudgetTariffWithModelRecord extends ManagedMonthlyBudgetTariffRecord
{
	readonly modelDefinition: { readonly publicModelName: string };
}

/** Validated and converted reserve values used by the database adapter. */
export interface PreparedManagedMonthlyBudgetReserve
{
	readonly command: ManagedMonthlyBudgetReserveCommand;
	readonly quote: ModelTariffQuote;
	readonly worstCaseEurMicros: bigint;
	readonly quoteDigest: string;
}

/** Current-policy coverage result before one reserved effect may claim dispatch. */
export interface ManagedMonthlyBudgetClaimCoverage
{
	readonly effect: ManagedMonthlyBudgetEffectRecord;
	readonly admissionClosed: boolean;
	readonly insufficientCapacity: boolean;
}
