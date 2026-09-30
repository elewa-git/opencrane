import { z } from "zod";

import type { ModelTariff, ModelTariffLookup, ModelTariffQuote } from "./model-tariff.types";

const _DECIMAL_DIGITS = z.string().regex(/^(?:0|[1-9][0-9]*)$/u).max(19).refine(function _SignedInt64(value)
{
	try { return BigInt(value) <= 9_223_372_036_854_775_807n; }
	catch { return false; }
});
const _MODEL_ALIAS = z.string().regex(/^[A-Za-z0-9._/-]{1,256}$/u);
const _POSITIVE_INT = z.number().int().min(1).max(2_147_483_647);

/** Validates the versioned EUR tariff without inventing a rate or defaulting absent pricing. */
export const ___ModelTariffSchema: z.ZodType<ModelTariff> = z.object({
	version: z.literal(1), modelAlias: _MODEL_ALIAS, currency: z.literal("EUR"), inputEurMicrosPerUnit: _DECIMAL_DIGITS, outputEurMicrosPerUnit: _DECIMAL_DIGITS, tokenUnit: z.literal(1_000_000), maxInputTokens: _POSITIVE_INT, revision: _POSITIVE_INT, effectiveAt: z.string().datetime({ offset: true }), validUntil: z.string().datetime({ offset: true }), digest: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
}).strict().refine(function _ValidWindow(value) { return Date.parse(value.validUntil) > Date.parse(value.effectiveAt); });

/** Validates the model-bound lookup input without accepting an input ceiling or caller rate. */
export const ___ModelTariffLookupSchema: z.ZodType<ModelTariffLookup> = z.object({ siloId: z.string().min(1).max(256), modelAlias: _MODEL_ALIAS, maxCompletionTokens: _POSITIVE_INT }).strict();

/** Validates frozen tariff evidence and a decimal-string worst-case EUR total. */
export const ___ModelTariffQuoteSchema: z.ZodType<ModelTariffQuote> = z.object({ tariff: ___ModelTariffSchema, maxCompletionTokens: _POSITIVE_INT, worstCaseEurMicros: _DECIMAL_DIGITS }).strict();
