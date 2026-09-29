import { afterEach, describe, expect, it, vi } from "vitest";

import { ___ModelTariffSchema } from "@opencrane/contracts";
import { ___DigestCanonicalJson } from "@opencrane/util";

import { __CreateConversationModelTariffLookup } from "../core/conversation-model-tariff";

/** Builds one complete tariff identity with no invented production rate. */
function _Tariff(overrides: Record<string, unknown> = {})
{
	const identity = { version: 1, modelAlias: "admitted-model", currency: "EUR", inputEurMicrosPerUnit: "125000", outputEurMicrosPerUnit: "250000", tokenUnit: 1_000_000, maxInputTokens: 1_000, revision: 2, effectiveAt: "2026-09-29T00:00:00Z", validUntil: "2027-09-29T00:00:00Z", ...overrides };
	return { ...identity, digest: ___DigestCanonicalJson(identity), };
}

describe("conversation model tariff lookup", function _TariffSuite()
{
	afterEach(function _RestoreClock()
	{
		vi.useRealTimers();
	});

	it("validates model binding, digest, input bound and calculated worst-case quote", async function _ValidQuote()
	{
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-10-01T00:00:00Z"));
		const tariff = _Tariff();
		const resolver = { lookup: async function _Lookup() { return { tariff, maxCompletionTokens: 3, worstCaseEurMicros: "126" }; } };
		await expect(__CreateConversationModelTariffLookup(resolver).lookup({ siloId: "silo-1", modelAlias: "admitted-model", maxCompletionTokens: 3 })).resolves.toMatchObject({ tariff, maxCompletionTokens: 3, worstCaseEurMicros: "126" });
	});

	it.each([
		["wrong model", { tariff: _Tariff({ modelAlias: "other-model" }), maxCompletionTokens: 3, worstCaseEurMicros: "1" }],
		["wrong digest", { tariff: { ..._Tariff(), digest: `sha256:${"b".repeat(64)}` }, maxCompletionTokens: 3, worstCaseEurMicros: "1" }],
		["wrong quote", { tariff: _Tariff(), maxCompletionTokens: 3, worstCaseEurMicros: "999" }],
	])("rejects %s", async function _Reject(_name, quote)
	{
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-10-01T00:00:00Z"));
		const resolver = { lookup: async function _Lookup() { return quote; } };
		await expect(__CreateConversationModelTariffLookup(resolver).lookup({ siloId: "silo-1", modelAlias: "admitted-model", maxCompletionTokens: 3 })).rejects.toThrow();
	});

	it.each(["abc", "1.2"])("returns validation failure for malformed decimal rate %s", function _MalformedRate(rate)
	{
		expect(function _Parse() { return ___ModelTariffSchema.safeParse(_Tariff({ inputEurMicrosPerUnit: rate })); }).not.toThrow();
		expect(___ModelTariffSchema.safeParse(_Tariff({ inputEurMicrosPerUnit: rate })).success).toBe(false);
	});

	it("rejects a decimal rate outside the signed database integer range", function _RateOverflow()
	{
		expect(___ModelTariffSchema.safeParse(_Tariff({ inputEurMicrosPerUnit: "9223372036854775808" })).success).toBe(false);
	});

	it("rejects a quote bound to a different completion ceiling", async function _CompletionBound()
	{
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-10-01T00:00:00Z"));
		const tariff = _Tariff();
		const resolver = { lookup: async function _Lookup() { return { tariff, maxCompletionTokens: 4, worstCaseEurMicros: "126" }; } };
		await expect(__CreateConversationModelTariffLookup(resolver).lookup({ siloId: "silo-1", modelAlias: "admitted-model", maxCompletionTokens: 3 })).rejects.toThrow();
	});

	it("rejects an inverted validity window", async function _InvertedWindow()
	{
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-10-01T00:00:00Z"));
		const tariff = _Tariff({ effectiveAt: "2027-09-29T00:00:00Z", validUntil: "2026-09-29T00:00:00Z" });
		const resolver = { lookup: async function _Lookup() { return { tariff, maxCompletionTokens: 3, worstCaseEurMicros: "126" }; } };
		await expect(__CreateConversationModelTariffLookup(resolver).lookup({ siloId: "silo-1", modelAlias: "admitted-model", maxCompletionTokens: 3 })).rejects.toThrow();
	});

	it.each([
		["before its effective time", "2026-09-28T23:59:59.999Z"],
		["at its exclusive end", "2027-09-29T00:00:00Z"],
		["after its exclusive end", "2027-09-29T00:00:00.001Z"],
	])("rejects a tariff %s", async function _Inactive(_case, now)
	{
		vi.useFakeTimers();
		vi.setSystemTime(new Date(now));
		const tariff = _Tariff();
		const resolver = { lookup: async function _Lookup() { return { tariff, maxCompletionTokens: 3, worstCaseEurMicros: "126" }; } };
		await expect(__CreateConversationModelTariffLookup(resolver).lookup({ siloId: "silo-1", modelAlias: "admitted-model", maxCompletionTokens: 3 })).rejects.toThrow();
	});

	it("accepts a tariff at its inclusive effective time", async function _EffectiveBoundary()
	{
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-09-29T00:00:00Z"));
		const tariff = _Tariff();
		const resolver = { lookup: async function _Lookup() { return { tariff, maxCompletionTokens: 3, worstCaseEurMicros: "126" }; } };
		await expect(__CreateConversationModelTariffLookup(resolver).lookup({ siloId: "silo-1", modelAlias: "admitted-model", maxCompletionTokens: 3 })).resolves.toMatchObject({ tariff });
	});
});
