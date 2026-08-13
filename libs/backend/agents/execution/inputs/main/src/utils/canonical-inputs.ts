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
