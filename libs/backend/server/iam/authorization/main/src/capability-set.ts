import type { CapabilityReference } from "@opencrane/models/authorization";

import { __DigestCanonicalJson } from "./canonical-json-digest.js";
import type { CapabilitySet } from "./capability-set.types.js";

/**
 * Canonicalises a capability set and returns the only digest accepted for that exact set.
 * @param values - Candidate immutable catalog references to preserve for a run.
 * @returns An immutable ordered set, or `null` when a reference is malformed or duplicated.
 */
export function __CreateCapabilitySet(values: readonly CapabilityReference[]): CapabilitySet | null
{
	// 1. Reject invalid source identities before they can become durable authorization evidence.
	if (values.some(_isInvalidCapability))
	{
		return null;
	}

	// 2. Copy and order the references so later caller mutation cannot alter the retained meaning.
	const capabilities = values.map(_copyCapability).sort(_compareCapability);
	if (capabilities.some(_isDuplicateCapability))
	{
		return null;
	}

	// 3. Bind exactly that ordered content, including a valid empty no-capability set, to its digest.
	return { capabilities: Object.freeze(capabilities), digest: __DigestCanonicalJson(capabilities.map(_canonicalCapability)) };
}

/**
 * Returns whether every exact child reference belongs to the parent capability set.
 * @param parent - Capability set frozen for the parent run.
 * @param child - Candidate narrowed set for a child run.
 * @returns Whether the child set cannot broaden the parent's authority.
 */
export function __IsCapabilitySetSubset(parent: CapabilitySet, child: CapabilitySet): boolean
{
	// 1. Rebuild both sets so a caller cannot pair valid references with a forged durable digest.
	const canonicalParent = __CreateCapabilitySet(parent.capabilities);
	const canonicalChild = __CreateCapabilitySet(child.capabilities);
	if (!canonicalParent || !canonicalChild || canonicalParent.digest !== parent.digest || canonicalChild.digest !== child.digest)
	{
		return false;
	}

	// 2. Compare the verified parent identity with every verified child identity.
	const parentKeys = new Set(canonicalParent.capabilities.map(_key));
	return canonicalChild.capabilities.every(_isIncludedInParent);

	/** Checks the current child reference against the parent's complete immutable identity. */
	function _isIncludedInParent(capability: CapabilityReference): boolean
	{
		return parentKeys.has(_key(capability));
	}
}

/** Builds the stable comparison key for one immutable capability reference. */
function _key(value: CapabilityReference): string
{
	return `${value.catalog.catalogId}\u0000${value.catalog.revision}\u0000${value.catalog.digest}\u0000${value.capabilityId}`;
}

/** Copies one reference into the immutable in-memory representation retained by the run. */
function _copyCapability(value: CapabilityReference): CapabilityReference
{
	return Object.freeze({
		catalog: Object.freeze({
			catalogId: value.catalog.catalogId,
			revision: value.catalog.revision,
			digest: value.catalog.digest,
		}),
		capabilityId: value.capabilityId,
	});
}

/** Converts one typed reference into the JSON-only representation covered by the durable digest. */
function _canonicalCapability(value: CapabilityReference): { readonly catalog: { readonly catalogId: string; readonly revision: number; readonly digest: string }; readonly capabilityId: string }
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

/** Detects one repeated immutable identity in an already sorted capability set. */
function _isDuplicateCapability(value: CapabilityReference, index: number, values: readonly CapabilityReference[]): boolean
{
	return index > 0 && _key(value) === _key(values[index - 1]!);
}

/** Rejects any non-canonical reference before it contributes to a durable set digest. */
function _isInvalidCapability(value: CapabilityReference): boolean
{
	return value.capabilityId.trim().length === 0 || value.catalog.catalogId.trim().length === 0 || !Number.isSafeInteger(value.catalog.revision) || value.catalog.revision < 1 || !/^sha256:[0-9a-f]{64}$/u.test(value.catalog.digest);
}

/** Compares capability references by their complete immutable identity. */
function _compareCapability(first: CapabilityReference, second: CapabilityReference): number
{
	const firstKey = _key(first);
	const secondKey = _key(second);
	return firstKey === secondKey ? 0 : firstKey < secondKey ? -1 : 1;
}
