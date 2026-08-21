import { __DigestCanonicalJson } from "@opencrane/backend/server/iam/authorization";
import type { SignedFleetMembershipRevision } from "@opencrane/models/authorization";
import type { JsonValue } from "@opencrane/util";

/** The revision fields the digest covers: everything except the digest and signature themselves. */
type FleetMembershipSignedPayload = Omit<SignedFleetMembershipRevision, "payloadDigest" | "signature">;

/**
 * Computes the digest a fleet issuer signs and that OpenCrane recomputes before trusting a revision.
 *
 * Assertions are sorted by the digest of their own content, so the order rows came back from the
 * database cannot change what was signed. Any change to the issuer, times, silo, subject, assertion,
 * or scope changes this digest, which makes the issuer's existing signature stop matching.
 *
 * Called by: Ed25519FleetMembershipSignatureVerifier.verify in this package; no caller outside the
 * package yet, though the barrel exports it for the signing side.
 * @param revision - A revision's signed fields, without its digest or signature.
 * @returns The digest as a `sha256:<hex>` string; that string's UTF-8 bytes are what gets signed.
 */
export function __DigestFleetMembershipSignedPayload(revision: FleetMembershipSignedPayload): string
{
	const assertions: JsonValue[] = revision.assertions
		.map(function _Copy(assertion): JsonValue
		{
			return {
				assertionId: assertion.assertionId,
				siloId: assertion.siloId,
				subjectId: assertion.subjectId,
			};
		})
		.sort(function _ByCanonicalContent(left, right): number
		{
			const leftDigest = __DigestCanonicalJson(left);
			const rightDigest = __DigestCanonicalJson(right);
			if (leftDigest < rightDigest) return -1;
			if (leftDigest > rightDigest) return 1;
			return 0;
		});
	return __DigestCanonicalJson({
		schema: "opencrane.fleet-membership/v2",
		revision: revision.revision,
		issuerId: revision.issuerId,
		issuerKeyId: revision.issuerKeyId,
		siloId: revision.siloId,
		issuedAtEpochMs: revision.issuedAtEpochMs,
		expiresAtEpochMs: revision.expiresAtEpochMs,
		assertions,
	});
}
