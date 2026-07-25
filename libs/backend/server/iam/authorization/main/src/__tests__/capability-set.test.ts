import type { CapabilityReference } from "@opencrane/models/authorization";
import { describe, expect, it } from "vitest";

import { __CreateCapabilitySet, __IsCapabilitySetSubset } from "../capability-set.js";
import type { CapabilitySet } from "../capability-set.types.js";

/** First immutable reference used by capability-set tests. */
const FIRST_CAPABILITY: CapabilityReference = {
	catalog: {
		catalogId: "catalog-main",
		revision: 2,
		digest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
	},
	capabilityId: "artifact.read",
};

/** Second immutable reference used by capability-set tests. */
const SECOND_CAPABILITY: CapabilityReference = {
	catalog: {
		catalogId: "catalog-main",
		revision: 2,
		digest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
	},
	capabilityId: "artifact.write",
};

describe("capability sets", function _suite()
{
	it("orders copied references and derives one stable digest", function _canonicalises()
	{
		const source = [_copyFixture(SECOND_CAPABILITY), _copyFixture(FIRST_CAPABILITY)];
		const result = __CreateCapabilitySet(source);

		expect(result).toEqual({
			capabilities: [FIRST_CAPABILITY, SECOND_CAPABILITY],
			digest: "sha256:b523deae6406cc1f8e068b422dfac8c11cd39b908019fe38a52f47694e1fd855",
		});
		source[0]!.capabilityId = "mutated";
		expect(result?.capabilities[1]?.capabilityId).toBe("artifact.write");
	});

	it("retains a valid empty capability set without granting a capability", function _empty()
	{
		const result = __CreateCapabilitySet([]);

		expect(result).toEqual({
			capabilities: [],
			digest: "sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
		});
	});

	it("rejects malformed and repeated immutable identities", function _rejects()
	{
		const malformed: CapabilityReference = { ...FIRST_CAPABILITY, capabilityId: " " };

		expect(__CreateCapabilitySet([FIRST_CAPABILITY, FIRST_CAPABILITY])).toBeNull();
		expect(__CreateCapabilitySet([malformed])).toBeNull();
	});

	it("accepts only a child set which is a strict narrowing or equal subset", function _narrows()
	{
		const parent = _requireCapabilitySet([FIRST_CAPABILITY, SECOND_CAPABILITY]);
		const child = _requireCapabilitySet([FIRST_CAPABILITY]);
		const broader = _requireCapabilitySet([SECOND_CAPABILITY, {
			catalog: {
				catalogId: "catalog-extra",
				revision: 1,
				digest: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
			},
			capabilityId: "memory.read",
		}]);

		expect(__IsCapabilitySetSubset(parent, child)).toBe(true);
		expect(__IsCapabilitySetSubset(parent, broader)).toBe(false);
	});

	it("rejects a child whose supplied digest does not bind its actual references", function _rejectsForgedDigest()
	{
		const parent = _requireCapabilitySet([FIRST_CAPABILITY, SECOND_CAPABILITY]);
		const forgedChild: CapabilitySet = {
			capabilities: [FIRST_CAPABILITY],
			digest: parent.digest,
		};

		expect(__IsCapabilitySetSubset(parent, forgedChild)).toBe(false);
	});

	it("uses code-unit ordering instead of a host locale for durable digests", function _usesStableOrdering()
	{
		const zed = _withCapabilityId(FIRST_CAPABILITY, "z");
		const aUmlaut = _withCapabilityId(SECOND_CAPABILITY, "ä");
		const result = _requireCapabilitySet([aUmlaut, zed]);

		expect(result.capabilities.map(function _capabilityId(value): string { return value.capabilityId; })).toEqual(["z", "ä"]);
	});
});

/** Returns the valid set expected by tests, failing immediately if a fixture violates the contract. */
function _requireCapabilitySet(values: readonly CapabilityReference[]): CapabilitySet
{
	const result = __CreateCapabilitySet(values);
	if (!result)
	{
		throw new Error("Expected a valid capability-set fixture.");
	}
	return result;
}

/** Copies a mutable model fixture so one test cannot alter another test's input. */
function _copyFixture(value: CapabilityReference): CapabilityReference
{
	return {
		catalog: {
			catalogId: value.catalog.catalogId,
			revision: value.catalog.revision,
			digest: value.catalog.digest,
		},
		capabilityId: value.capabilityId,
	};
}

/** Copies a fixture while assigning one capability identifier for ordering coverage. */
function _withCapabilityId(value: CapabilityReference, capabilityId: string): CapabilityReference
{
	return { ..._copyFixture(value), capabilityId };
}
