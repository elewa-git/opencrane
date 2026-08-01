import { __DigestCanonicalJson } from "@opencrane/backend/server/iam/authorization";
import type { AuthorizationScope, SignedFleetMembershipRevision } from "@opencrane/models/authorization";
import type { JsonValue } from "@opencrane/util";

/** Signed membership fields whose canonical digest excludes only the digest and signature envelope. */
type FleetMembershipSignedPayload = Omit<SignedFleetMembershipRevision, "payloadDigest" | "signature">;

/** Copies one typed scope into the canonical JSON vocabulary without weakening its type globally. */
function _CanonicalScope(scope: AuthorizationScope): JsonValue
{
	if (scope.kind === "organization") return { kind: scope.kind, organizationId: scope.organizationId };
	if (scope.kind === "department") return { kind: scope.kind, organizationId: scope.organizationId, departmentId: scope.departmentId };
	if (scope.kind === "team") return { kind: scope.kind, organizationId: scope.organizationId, teamId: scope.teamId };
	if (scope.kind === "project") return { kind: scope.kind, organizationId: scope.organizationId, projectId: scope.projectId };
	return { kind: scope.kind, organizationId: scope.organizationId, userId: scope.userId };
}

/**
 * Computes the canonical digest that a fleet issuer signs and OpenCrane independently verifies.
 *
 * Assertions are sorted by their complete canonical content so database row order cannot change the
 * signed meaning, while any issuer, time, silo, subject, assertion, or scope mutation changes the
 * digest and invalidates the detached signature.
 *
 * @param revision - Complete signer-owned membership payload without envelope digest or signature.
 * @returns Canonical SHA-256 digest signed as its UTF-8 `sha256:<hex>` representation.
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
				scope: _CanonicalScope(assertion.scope),
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
		schema: "opencrane.fleet-membership/v1",
		revision: revision.revision,
		issuerId: revision.issuerId,
		issuerKeyId: revision.issuerKeyId,
		siloId: revision.siloId,
		issuedAtEpochMs: revision.issuedAtEpochMs,
		expiresAtEpochMs: revision.expiresAtEpochMs,
		assertions,
	});
}
