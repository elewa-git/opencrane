import type { RunInputSnapshot } from "@opencrane/contracts";
import { ___IsSha256Digest } from "@opencrane/util";

import type { IdentityEnvelopeInput } from "../session-assembly.types.js";

/** Returns whether an instant is already the single UTC ISO-8601 representation used in a digest. */
export function _IsCanonicalUtcInstant(value: string): boolean
{
	return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
		&& Number.isFinite(Date.parse(value))
		&& new Date(value).toISOString() === value;
}

/** Verifies that pinned membership evidence is complete and remains trusted at admission time. */
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

/** Sorts fact and provenance coordinates without retaining mutable authority-owned arrays. */
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

/** Orders provenance by every stable source coordinate before it contributes to the canonical digest. */
function _compareProvenance(left: RunInputSnapshot["memoryFacts"][number]["provenance"][number], right: RunInputSnapshot["memoryFacts"][number]["provenance"][number]): number
{
	const leftKey = `${left.sourceKind}\u0000${left.sourceId}\u0000${left.artifactRevisionId ?? ""}\u0000${left.sourceUserId ?? ""}\u0000${left.capturedAt}`;
	const rightKey = `${right.sourceKind}\u0000${right.sourceId}\u0000${right.artifactRevisionId ?? ""}\u0000${right.sourceUserId ?? ""}\u0000${right.capturedAt}`;
	return leftKey.localeCompare(rightKey);
}
