import { ___ConversationModelDeliverySchema, ___ModelTariffQuoteSchema } from "@opencrane/contracts";
import { ___DigestCanonicalJson } from "@opencrane/util";

import { _PriceEurMicros } from "./monthly-budget-math";
import type { PreparedManagedMonthlyBudgetReserve } from "./monthly-budget-persistence.types";
import type { ManagedMonthlyBudgetAttemptCommand, ManagedMonthlyBudgetReserveCommand } from "./monthly-budget.types";

/** Largest monetary or token count that PostgreSQL can retain in a signed bigint column. */
export const _MAX_SIGNED_BIGINT = 9_223_372_036_854_775_807n;

/** Validate caller coordinates and convert decimal money exactly once. */
export function _PrepareManagedMonthlyBudgetReserve(command: ManagedMonthlyBudgetReserveCommand): PreparedManagedMonthlyBudgetReserve
{
	_RequireIdentifier(command.siloId, "silo");
	_RequireIdentifier(command.runId, "run");
	_RequirePositiveInteger(command.runAttempt, "run attempt");
	_RequireIdentifier(command.logicalFence, "logical fence");
	_RequireIdentifier(command.modelAlias, "model alias");
	_RequirePositiveInteger(command.maxCompletionTokens, "completion ceiling");
	const quote = ___ModelTariffQuoteSchema.parse(command.quote);
	if (quote.tariff.modelAlias !== command.modelAlias || quote.maxCompletionTokens !== command.maxCompletionTokens)
		throw new Error("Managed monthly budget quote is not bound to the requested model and completion ceiling");
	const worstCaseEurMicros = BigInt(quote.worstCaseEurMicros);
	const expected = _PriceEurMicros(quote.tariff.maxInputTokens, quote.maxCompletionTokens, BigInt(quote.tariff.inputEurMicrosPerUnit), BigInt(quote.tariff.outputEurMicrosPerUnit), BigInt(quote.tariff.tokenUnit));
	if (worstCaseEurMicros !== expected)
		throw new Error("Managed monthly budget quote does not match its tariff rates");
	if (worstCaseEurMicros > _MAX_SIGNED_BIGINT)
		throw new Error("Managed monthly budget quote exceeds signed database storage");
	const quoteDigest = ___DigestCanonicalJson({
		tariff: { ...quote.tariff },
		maxCompletionTokens: quote.maxCompletionTokens,
		worstCaseEurMicros: quote.worstCaseEurMicros,
	});
	return { command, quote, worstCaseEurMicros, quoteDigest };
}

/** Validate the immutable physical-request identity before any ledger lookup. */
export function _ValidateManagedMonthlyBudgetAttempt(command: ManagedMonthlyBudgetAttemptCommand): void
{
	___ConversationModelDeliverySchema.parse({ physicalNonce: command.physicalNonce, logicalFence: command.reservation.logicalFence });
	if (!/^[0-9a-f]{64}$/u.test(command.requestBodySha256))
		throw new Error("Managed monthly budget request body digest is malformed");
	if (!Number.isSafeInteger(command.deadlineEpochMs) || command.deadlineEpochMs <= 0)
		throw new Error("Managed monthly budget request deadline is invalid");
}

/** Return the first UTC instant of the database-clock month. */
export function _ManagedMonthlyBudgetPeriodStart(now: Date): Date
{
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Reject an empty or impractically large durable coordinate. */
function _RequireIdentifier(value: string, name: string): void
{
	if (value.length < 1 || value.length > 512)
		throw new Error(`Managed monthly budget ${name} is invalid`);
}

/** Reject integers outside the positive signed database range. */
function _RequirePositiveInteger(value: number, name: string): void
{
	if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647)
		throw new Error(`Managed monthly budget ${name} is invalid`);
}
