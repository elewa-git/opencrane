import type { Request } from "express";

import type { AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";

/** Authenticated Principal coordinates used for spend reporting and administration. */
export interface SpendRouteCaller
{
	/** Silo derived from the trusted request host. */
	readonly siloId: string;
	/** Durable local Principal admitted by authentication middleware. */
	readonly principalId: string;
}

/** Resolves trusted spend caller coordinates from one authenticated request. */
export type SpendRouteCallerResolver = (request: Request) => SpendRouteCaller | null;

/** Builds the central authority over the transaction that owns a spend operation. */
export type SpendAuthorizationAuthorityFactory<Transaction> = (transaction: Transaction) => AuthorizationAuthority;

/** Public monthly budget ceiling. */
export interface BudgetSetting
{
	/** ISO currency code stored with the ceiling. */
	readonly currency: string;
	/** Monthly spend ceiling represented as a JSON number. */
	readonly ceilingAmount: number;
}

/** One account-specific monthly budget ceiling. */
export interface AccountBudgetSetting extends BudgetSetting
{
	/** Account whose model use is constrained by the ceiling. */
	readonly userId: string;
}

/** Validated budget values accepted by the persistence boundary. */
export interface BudgetSettingWrite
{
	/** ISO currency code stored with the ceiling. */
	readonly currency: string;
	/** Monthly spend ceiling represented as a JSON number. */
	readonly ceilingAmount: number;
}

/** One authorized token-usage row with its effective budget ceiling. */
export interface TokenUsageView
{
	/** Account whose usage was sampled. */
	readonly userId: string;
	/** Input tokens counted in the snapshot. */
	readonly inputTokens: number;
	/** Output tokens counted in the snapshot. */
	readonly outputTokens: number;
	/** Combined input and output token count. */
	readonly totalTokens: number;
	/** Currency used for cost and budget comparison. */
	readonly currency: string;
	/** Provider cost recorded for the snapshot. */
	readonly totalCost: number;
	/** Account or global ceiling in the same currency, when configured. */
	readonly budgetCeiling?: number;
}

/** Stored token-usage fields required by the public reporting projection. */
export interface TokenUsageCandidate
{
	/** Stable row identifier used for item authorization. */
	readonly id: number;
	/** Account whose usage was sampled. */
	readonly userId: string;
	/** Counted input tokens. */
	readonly inputTokens: number;
	/** Counted output tokens. */
	readonly outputTokens: number;
	/** Combined input and output token count. */
	readonly totalTokens: number;
	/** Currency used by the recorded cost. */
	readonly currency: string;
	/** Decimal provider cost returned by Prisma. */
	readonly totalCost: { toString(): string };
}

/** Transaction-scoped spend persistence used after the unit of work owns authorization. */
export interface SpendTransactionRepository
{
	/** Reads the singleton global monthly budget ceiling. */
	getGlobalBudget(siloId: string): Promise<BudgetSetting>;
	/** Creates or replaces the singleton global monthly budget ceiling. */
	putGlobalBudget(siloId: string, setting: BudgetSettingWrite): Promise<void>;
	/** Lists every account-specific budget ceiling in stable account order. */
	listAccountBudgets(siloId: string): Promise<readonly AccountBudgetSetting[]>;
	/** Creates or replaces one account-specific budget ceiling. */
	putAccountBudget(siloId: string, userId: string, setting: BudgetSettingWrite): Promise<void>;
	/** Removes one account-specific ceiling so the global value applies again. */
	deleteAccountBudget(siloId: string, userId: string): Promise<void>;
	/** Reads all current token-usage candidates before item authorization. */
	listTokenUsage(siloId: string): Promise<readonly TokenUsageCandidate[]>;
	/** Reads the stored global budget row used by token-usage projection. */
	getGlobalBudgetRow(siloId: string): Promise<{ readonly currency: string; readonly ceilingAmount: { toString(): string } } | null>;
	/** Reads stored account budget rows used by token-usage projection. */
	listAccountBudgetRows(siloId: string): Promise<readonly { readonly userId: string; readonly currency: string; readonly ceilingAmount: { toString(): string } }[]>;
}

/** Central-authorized spend reporting and budget administration contract. */
export interface SpendAuthority
{
	/** Reads the global ceiling after current organisation administration succeeds. */
	getGlobalBudget(caller: SpendRouteCaller): Promise<BudgetSetting>;
	/** Writes the global ceiling with decision evidence in the same transaction. */
	putGlobalBudget(caller: SpendRouteCaller, setting: BudgetSettingWrite): Promise<void>;
	/** Lists account ceilings after current organisation administration succeeds. */
	listAccountBudgets(caller: SpendRouteCaller): Promise<readonly AccountBudgetSetting[]>;
	/** Writes one account ceiling with decision evidence in the same transaction. */
	putAccountBudget(caller: SpendRouteCaller, userId: string, setting: BudgetSettingWrite): Promise<void>;
	/** Deletes one account ceiling with decision evidence in the same transaction. */
	deleteAccountBudget(caller: SpendRouteCaller, userId: string): Promise<void>;
	/** Lists token-usage rows covered by current exact read grants. */
	listTokenUsage(caller: SpendRouteCaller): Promise<readonly TokenUsageView[]>;
}
