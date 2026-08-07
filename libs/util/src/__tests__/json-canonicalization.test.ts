import { describe, expect, it } from "vitest";
import { ___CanonicalizeJson } from "../json-canonicalization.js";
import type { JsonValue } from "../json-canonicalization.types.js";

describe("RFC 8785 JSON canonicalization", function ()
{
	it("matches the RFC 8785 serialization example", function ()
	{
		const value: JsonValue = {
			numbers: [333333333.33333329, 1e30, 4.50, 2e-3, 0.000000000000000000000000001],
			string: "€$\u000f\nA'B\"\\\"/",
			literals: [null, true, false],
		};

		expect(___CanonicalizeJson(value)).toBe("{\"literals\":[null,true,false],\"numbers\":[333333333.3333333,1e+30,4.5,0.002,1e-27],\"string\":\"€$\\u000f\\nA'B\\\"\\\\\\\"/\"}");
	});

	it("orders nested properties deterministically without normalizing Unicode", function ()
	{
		const composed = "é";
		const decomposed = "e\u0301";
		const first: JsonValue = { z: { beta: 2, alpha: 1 }, a: decomposed, b: composed };
		const second: JsonValue = { b: composed, a: decomposed, z: { alpha: 1, beta: 2 } };

		expect(___CanonicalizeJson(first)).toBe(___CanonicalizeJson(second));
		expect(___CanonicalizeJson(first)).toContain(`\"a\":\"${decomposed}\"`);
		expect(___CanonicalizeJson(first)).not.toContain(`\"a\":\"${composed}\"`);
	});

	it("matches the RFC 8785 UTF-16 property-sorting example", function ()
	{
		const value: JsonValue = {
			"\u20ac": "Euro Sign",
			"\r": "Carriage Return",
			"\ufb33": "Hebrew Letter Dalet With Dagesh",
			"1": "One",
			"\ud83d\ude00": "Emoji: Grinning Face",
			"\u0080": "Control",
			"\u00f6": "Latin Small Letter O With Diaeresis",
		};

		expect(___CanonicalizeJson(value)).toBe("{\"\\r\":\"Carriage Return\",\"1\":\"One\",\"\":\"Control\",\"ö\":\"Latin Small Letter O With Diaeresis\",\"€\":\"Euro Sign\",\"😀\":\"Emoji: Grinning Face\",\"דּ\":\"Hebrew Letter Dalet With Dagesh\"}");
	});

	it("serializes negative zero as zero and preserves the IEEE 754 round trip", function ()
	{
		expect(___CanonicalizeJson([-0, 1e-7, 0.000001, 1e21])).toBe("[0,1e-7,0.000001,1e+21]");
	});

	it("rejects non-finite numbers and values outside the JSON data model", function ()
	{
		expect(function _nan(): string { return ___CanonicalizeJson(Number.NaN as unknown as JsonValue); }).toThrow(/finite IEEE 754/);
		expect(function _infinity(): string { return ___CanonicalizeJson(Number.POSITIVE_INFINITY as unknown as JsonValue); }).toThrow(/finite IEEE 754/);
		expect(function _undefined(): string { return ___CanonicalizeJson(undefined as unknown as JsonValue); }).toThrow(/JSON values only/);
		expect(function _date(): string { return ___CanonicalizeJson(new Date(0) as unknown as JsonValue); }).toThrow(/plain JSON objects/);
	});

	it("rejects lone Unicode surrogates in values and property names", function ()
	{
		expect(function _value(): string { return ___CanonicalizeJson("\ud800"); }).toThrow(/lone Unicode surrogates/);
		expect(function _key(): string { return ___CanonicalizeJson({ "\udfff": true }); }).toThrow(/lone Unicode surrogates/);
	});

	it("rejects sparse, augmented, accessor, and symbol-bearing containers", function ()
	{
		const sparse = new Array(2) as JsonValue[];
		sparse[1] = true;
		const augmented = [true] as unknown as Record<string, JsonValue>;
		augmented.extra = false;
		const accessor = Object.defineProperty({}, "value", { enumerable: true, get: function _getValue(): boolean { return true; } });
		const symbolBearing = { value: true } as Record<PropertyKey, JsonValue>;
		symbolBearing[Symbol("hidden")] = false;

		expect(function _sparse(): string { return ___CanonicalizeJson(sparse); }).toThrow(/dense|sparse/);
		expect(function _augmented(): string { return ___CanonicalizeJson(augmented as JsonValue); }).toThrow(/dense/);
		expect(function _accessor(): string { return ___CanonicalizeJson(accessor as JsonValue); }).toThrow(/data properties/);
		expect(function _symbol(): string { return ___CanonicalizeJson(symbolBearing as JsonValue); }).toThrow(/symbol properties/);
	});

	it("rejects reference cycles while allowing repeated non-cyclic references", function ()
	{
		const shared = { value: true };
		const cyclic = { child: {} } as Record<string, JsonValue>;
		cyclic.child = cyclic;

		expect(___CanonicalizeJson({ first: shared, second: shared })).toBe("{\"first\":{\"value\":true},\"second\":{\"value\":true}}");
		expect(function _cycle(): string { return ___CanonicalizeJson(cyclic); }).toThrow(/reference cycles/);
	});
});
