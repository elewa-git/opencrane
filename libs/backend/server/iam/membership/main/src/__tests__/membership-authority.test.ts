import type { FleetSignatureVerificationEvidence, SignedFleetMembershipRevision } from "@opencrane/models/authorization";
import { describe, expect, it } from "vitest";

import { __VerifyCurrentFleetMembership } from "../membership-authority.js";
import type { FleetMembershipAcceptance, FleetMembershipAcceptanceResult, FleetMembershipAuthorityRepository, FleetMembershipSignatureVerifier, VerifyFleetMembershipCommand } from "../membership-authority.types.js";

/** Creates a signed fleet revision whose assertion matches the command fixture. */
function _revision(issuedAtEpochMs = 1000, revision = 7): SignedFleetMembershipRevision
{
	return {
		revision,
		issuerId: "fleet-1",
		issuerKeyId: "key-1",
		siloId: "silo-1",
		issuedAtEpochMs,
		expiresAtEpochMs: 10000,
		payloadDigest: `sha256:membership-${revision}`,
		signature: `signature-${revision}`,
		assertions: [{ assertionId: "assertion-1", siloId: "silo-1", subjectId: "user-1", scope: { kind: "project", organizationId: "org-1", projectId: "project-1" } }],
	};
}

/** Creates exact signature-verification evidence for a revision. */
function _evidence(revision: SignedFleetMembershipRevision): FleetSignatureVerificationEvidence
{
	return {
		verified: true,
		issuerId: revision.issuerId,
		issuerKeyId: revision.issuerKeyId,
		revision: revision.revision,
		siloId: revision.siloId,
		payloadDigest: revision.payloadDigest,
		signature: revision.signature,
	};
}

/** Creates the exact membership expectation for the signed fixture. */
function _command(nowEpochMs = 2000): VerifyFleetMembershipCommand
{
	return {
		trustedIssuerId: "fleet-1",
		siloId: "silo-1",
		subjectId: "user-1",
		assertionId: "assertion-1",
		scope: { kind: "project", organizationId: "org-1", projectId: "project-1" },
		nowEpochMs,
		maximumStalenessMs: 3000,
	};
}

/** In-memory monotonic membership repository used by trust-boundary tests. */
class _MembershipRepository implements FleetMembershipAuthorityRepository
{
	/** Newest signed revisions indexed by exact issuer and silo. */
	private readonly revisions = new Map<string, SignedFleetMembershipRevision>();
	/** Highest verified accepted revision indexed by exact issuer and silo. */
	private readonly highestAcceptedRevisions = new Map<string, number>();
	/** Digests accepted at each exact issuer-and-silo high-watermark. */
	private readonly acceptedDigests = new Map<string, string>();

	/** Creates a repository around one signed revision. */
	constructor(revision: SignedFleetMembershipRevision)
	{
		this.revisions.set(this._key(revision.issuerId, revision.siloId), revision);
	}

	/** Builds the explicit compound persistence key. */
	private _key(issuerId: string, siloId: string): string
	{
		return `${issuerId}\u0000${siloId}`;
	}

	/** Loads the configured signed revision only for the exact issuer and silo. */
	async getLatestSignedRevision(trustedIssuerId: string, siloId: string): Promise<SignedFleetMembershipRevision | null>
	{
		return this.revisions.get(this._key(trustedIssuerId, siloId)) ?? null;
	}

	/** Loads the current monotonic high-watermark for the exact issuer and silo. */
	async getHighestAcceptedRevision(trustedIssuerId: string, siloId: string): Promise<number>
	{
		return this.highestAcceptedRevisions.get(this._key(trustedIssuerId, siloId)) ?? 0;
	}

	/** Advances the high-watermark while rejecting rollback or digest substitution. */
	async acceptRevisionAtomically(acceptance: FleetMembershipAcceptance): Promise<FleetMembershipAcceptanceResult>
	{
		const key = this._key(acceptance.issuerId, acceptance.siloId);
		const highestAcceptedRevision = this.highestAcceptedRevisions.get(key) ?? 0;
		const acceptedDigest = this.acceptedDigests.get(key) ?? null;
		if (acceptance.revision < highestAcceptedRevision || (acceptance.revision === highestAcceptedRevision && acceptedDigest !== null && acceptance.payloadDigest !== acceptedDigest))
		{
			return { status: "conflict", highestAcceptedRevision };
		}
		if (acceptance.revision === highestAcceptedRevision)
		{
			return { status: "already_accepted", highestAcceptedRevision };
		}
		this.highestAcceptedRevisions.set(key, acceptance.revision);
		this.acceptedDigests.set(key, acceptance.payloadDigest);
		return { status: "accepted", highestAcceptedRevision: acceptance.revision };
	}
}

/** Signature verifier that binds evidence to the supplied envelope. */
class _Verifier implements FleetMembershipSignatureVerifier
{
	/** Returns exact successful verification evidence. */
	async verify(revision: SignedFleetMembershipRevision): Promise<FleetSignatureVerificationEvidence>
	{
		return _evidence(revision);
	}
}

describe("fleet-membership authority", function _suite()
{
	it("fails closed when the last signed revision exceeds maximum staleness", async function _stale()
	{
		const result = await __VerifyCurrentFleetMembership(new _MembershipRepository(_revision()), new _Verifier(), _command(4000));

		expect(result).toEqual({ outcome: "denied", reason: "stale", revision: 7 });
	});

	it("accepts fresh signed membership and records the revision high-watermark", async function _fresh()
	{
		const repository = new _MembershipRepository(_revision());
		const result = await __VerifyCurrentFleetMembership(repository, new _Verifier(), _command(2000));

		expect(result).toEqual({ outcome: "trusted", revision: 7, trustedUntilEpochMs: 4000 });
		expect(await repository.getHighestAcceptedRevision("fleet-1", "silo-1")).toBe(7);
		expect(await repository.getHighestAcceptedRevision("fleet-other", "silo-1")).toBe(0);
	});

	it("rejects a subject mismatch even under a valid fleet signature", async function _wrongSubject()
	{
		const result = await __VerifyCurrentFleetMembership(new _MembershipRepository(_revision()), new _Verifier(), { ..._command(), subjectId: "user-other" });

		expect(result).toEqual({ outcome: "denied", reason: "assertion_mismatch", revision: 7 });
	});

	it("never reads a revision or high-watermark from a different issuer", async function _issuerIsolation()
	{
		const repository = new _MembershipRepository(_revision());
		const result = await __VerifyCurrentFleetMembership(repository, new _Verifier(), { ..._command(), trustedIssuerId: "fleet-other" });

		expect(result).toEqual({ outcome: "denied", reason: "missing_revision", revision: 0 });
		expect(await repository.getHighestAcceptedRevision("fleet-1", "silo-1")).toBe(0);
		expect(await repository.getHighestAcceptedRevision("fleet-other", "silo-1")).toBe(0);
	});
});
