import type { RunInputSnapshot } from "@opencrane/contracts";
import { ___IsSha256Digest } from "@opencrane/util";

import type { IdentityEnvelopeInput } from "../session-assembly.types.js";

/** Returns whether a timestamp is already in the one UTC ISO-8601 form used in digests, e.g. `2026-01-01T00:00:00.000Z`. */
export function _IsCanonicalUtcInstant(value: string): boolean
{
	return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
		&& Number.isFinite(Date.parse(value))
		&& new Date(value).toISOString() === value;
}

/** Returns whether the identity's membership fields are all filled in and its trust window has not expired at `requestedAt`. */
export function _IsIdentityFresh(identity: IdentityEnvelopeInput, requestedAt: string): boolean
{
	return identity.executionSubjectId.trim().length > 0
		&& identity.fleetMembershipIssuer.trim().length > 0
		&& identity.fleetMembershipIssuerKeyId.trim().length > 0
		&& identity.fleetMembershipAssertionId.trim().length > 0
		&& ___IsSha256Digest(identity.fleetMembershipPayloadDigest)
		&& ___IsSha256Digest(identity.capabilitySetDigest)
		&& Number.isSafeInteger(identity.fleetMembershipRevision)
		&& identity.fleetMembershipRevision >= 0
		&& _IsCanonicalUtcInstant(identity.fleetMembershipTrustedUntil)
		&& Date.parse(identity.fleetMembershipTrustedUntil) > Date.parse(requestedAt);
}

/**
 * Sorts memory facts and their provenance entries into a fixed order, copying the arrays instead of
 * reusing the source's.
 *
 * The sort is not cosmetic. The snapshot is hashed as RFC 8785 canonical JSON, and that hash is
 * taken over the text, so two runs given the same facts in a different row order would otherwise
 * produce different digests and look like different inputs.
 *
 * @see https://www.rfc-editor.org/rfc/rfc8785 - JSON Canonicalization Scheme, the serialisation
 * `___DigestCanonicalJson` hashes. It fixes object key order but not array order, which is why the
 * arrays have to be sorted here first.
 */
export function _CanonicalMemoryFacts(values: RunInputSnapshot["memoryFacts"]): RunInputSnapshot["memoryFacts"]
{
	return [...values].sort(function _compare(left, right): number
	{
		return `${left.datasetId}\u0000${left.factId}\u0000${left.contentDigest}`.localeCompare(`${right.datasetId}\u0000${right.factId}\u0000${right.contentDigest}`);
	}).map(function _canonicalFact(fact)
	{
		return {
			...fact,
			provenance: [...fact.provenance].sort(_compareProvenance).map(function _copyProvenance(provenance)
			{
				return { ...provenance };
			}),
		};
	});
}

/**
 * Compares two provenance entries on all their fields, so the digest never depends on row order.
 *
 * Every field goes into the key, because two entries that differ only in a later field must still
 * sort the same way on every machine.
 *
 * @see https://www.rfc-editor.org/rfc/rfc8785 - JSON Canonicalization Scheme. It defines object key
 * order for the digest but leaves array order to the caller, so this comparator supplies it.
 */
function _compareProvenance(left: RunInputSnapshot["memoryFacts"][number]["provenance"][number], right: RunInputSnapshot["memoryFacts"][number]["provenance"][number]): number
{
	const leftKey = `${left.sourceKind}\u0000${left.sourceId}\u0000${left.artifactRevisionId ?? ""}\u0000${left.sourceUserId ?? ""}\u0000${left.capturedAt}`;
	const rightKey = `${right.sourceKind}\u0000${right.sourceId}\u0000${right.artifactRevisionId ?? ""}\u0000${right.sourceUserId ?? ""}\u0000${right.capturedAt}`;
	return leftKey.localeCompare(rightKey);
}
