import { describe, expect, it } from "vitest";

import { _CeilingDivide, _PriceEurMicros } from "../monthly-budget-math";

const MAX_SIGNED_BIGINT = (1n << 63n) - 1n;

const INVALID_TOKEN_COUNTS = [
	{ name: "negative input", inputTokens: -1, outputTokens: 0 },
	{ name: "unsafe input", inputTokens: Number.MAX_SAFE_INTEGER + 1, outputTokens: 0 },
	{ name: "fractional input", inputTokens: 1.5, outputTokens: 0 },
	{ name: "infinite input", inputTokens: Number.POSITIVE_INFINITY, outputTokens: 0 },
	{ name: "not-a-number input", inputTokens: Number.NaN, outputTokens: 0 },
	{ name: "negative output", inputTokens: 0, outputTokens: -1 },
	{ name: "unsafe output", inputTokens: 0, outputTokens: Number.MAX_SAFE_INTEGER + 1 },
	{ name: "fractional output", inputTokens: 0, outputTokens: 1.5 },
	{ name: "infinite output", inputTokens: 0, outputTokens: Number.POSITIVE_INFINITY },
	{ name: "not-a-number output", inputTokens: 0, outputTokens: Number.NaN },
];

const INVALID_RATES = [
	{ name: "negative input", inputRate: -1n, outputRate: 1n },
	{ name: "unsafe input number", inputRate: (Number.MAX_SAFE_INTEGER + 1) as unknown as bigint, outputRate: 1n },
	{ name: "fractional input number", inputRate: 1.5 as unknown as bigint, outputRate: 1n },
	{ name: "negative output", inputRate: 1n, outputRate: -1n },
	{ name: "unsafe output number", inputRate: 1n, outputRate: (Number.MAX_SAFE_INTEGER + 1) as unknown as bigint },
	{ name: "fractional output number", inputRate: 1n, outputRate: 1.5 as unknown as bigint },
];

const INVALID_TOKEN_UNITS = [
	{ name: "zero", value: 0n },
	{ name: "negative", value: -1n },
	{ name: "unsafe number", value: (Number.MAX_SAFE_INTEGER + 1) as unknown as bigint },
	{ name: "fractional number", value: 1.5 as unknown as bigint },
];

describe("monthly budget math", function _Suite()
{
	describe("_CeilingDivide", function _CeilingDivideSuite()
	{
		it.each([
			{ numerator: 0n, denominator: 1n, expected: 0n },
			{ numerator: 1n, denominator: 3n, expected: 1n },
			{ numerator: 3n, denominator: 3n, expected: 1n },
			{ numerator: 4n, denominator: 3n, expected: 2n },
			{ numerator: MAX_SIGNED_BIGINT, denominator: MAX_SIGNED_BIGINT, expected: 1n },
			{ numerator: MAX_SIGNED_BIGINT, denominator: 2n, expected: (MAX_SIGNED_BIGINT / 2n) + 1n },
		])("rounds $numerator/$denominator upward once", function _Rounds({ numerator, denominator, expected })
		{
			expect(_CeilingDivide(numerator, denominator)).toBe(expected);
		});

		it.each([
			{ name: "negative numerator", numerator: -1n, denominator: 1n },
			{ name: "zero denominator", numerator: 1n, denominator: 0n },
			{ name: "negative denominator", numerator: 1n, denominator: -1n },
		])("rejects $name", function _Rejects({ numerator, denominator })
		{
			expect(() => _CeilingDivide(numerator, denominator)).toThrow();
		});
	});

	describe("_PriceEurMicros", function _PriceEurMicrosSuite()
	{
		it.each([
			{ inputTokens: 1, outputTokens: 1, inputRate: 1n, outputRate: 1n, tokenUnit: 3n, expected: 1n },
			{ inputTokens: 2, outputTokens: 3, inputRate: 5n, outputRate: 7n, tokenUnit: 10n, expected: 4n },
			{ inputTokens: 2, outputTokens: 3, inputRate: 5n, outputRate: 10n, tokenUnit: 10n, expected: 4n },
		])("prices $inputTokens input and $outputTokens output tokens", function _Prices({ inputTokens, outputTokens, inputRate, outputRate, tokenUnit, expected })
		{
			expect(_PriceEurMicros(inputTokens, outputTokens, inputRate, outputRate, tokenUnit)).toBe(expected);
		});

		it("returns zero for an empty request", function _ReturnsZero()
		{
			expect(_PriceEurMicros(0, 0, 999n, 999n, 1_000_000n)).toBe(0n);
		});

		it("supports safe token boundaries and the signed bigint rate boundary", function _SupportsBoundaries()
		{
			const inputTokens = Number.MAX_SAFE_INTEGER;
			const outputTokens = Number.MAX_SAFE_INTEGER;
			const expected = (BigInt(inputTokens) * MAX_SIGNED_BIGINT) + (BigInt(outputTokens) * MAX_SIGNED_BIGINT);

			expect(_PriceEurMicros(inputTokens, outputTokens, MAX_SIGNED_BIGINT, MAX_SIGNED_BIGINT, 1n)).toBe(expected);
		});

		it.each(INVALID_TOKEN_COUNTS)("rejects $name token counts", function _RejectsTokenCounts({ inputTokens, outputTokens })
		{
			expect(() => _PriceEurMicros(inputTokens, outputTokens, 1n, 1n, 1n)).toThrow();
		});

		it.each(INVALID_RATES)("rejects $name rates", function _RejectsRates({ inputRate, outputRate })
		{
			expect(() => _PriceEurMicros(1, 0, inputRate, outputRate, 1n)).toThrow();
		});

		it.each(INVALID_TOKEN_UNITS)("rejects $name token units", function _RejectsTokenUnits({ value })
		{
			expect(() => _PriceEurMicros(1, 0, 1n, 1n, value)).toThrow();
		});
	});
});
