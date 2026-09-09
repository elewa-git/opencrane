import { OrgMemberStatus, PrincipalProvenance } from "@prisma/client";
import { ExecutionSubjectMembershipKinds, ___StandaloneMembershipSchema } from "@opencrane/contracts";
import { describe, expect, it, vi } from "vitest";

import { __DigestHumanMembershipEvidence, __SameMembershipBinding } from "../human-membership-evidence";
import { FleetMembershipDeploymentModes } from "../membership-authority.types";
import { PrismaHumanMembershipEvidenceRepository } from "../prisma-human-membership-evidence";

/** Supplies mutable database rows while exercising the real deployment-selected reader. */
function _Fixture()
{
	const principal = { id: "human-1", siloId: "silo-1", issuer: "https://issuer.example", subject: "oidc-1", provenance: PrincipalProvenance.External };
	const membership = { id: "local-membership-1", clusterTenant: "silo-1", subject: "oidc-1", status: OrgMemberStatus.Active, updatedAt: new Date(1_000) };
	const transaction = { principal: { findFirst: vi.fn().mockResolvedValue(principal) }, orgMembership: { findUnique: vi.fn().mockResolvedValue(membership) }, verifiedFleetMembershipRevision: { findFirst: vi.fn() } };
	const config = { mode: FleetMembershipDeploymentModes.Standalone, siloId: "silo-1", trustedOidcIssuer: "https://issuer.example", maximumStalenessMs: 5_000 } as const;
	return { principal, membership, transaction, config, repository: new PrismaHumanMembershipEvidenceRepository(transaction as never, config) };
}

describe("PrismaHumanMembershipEvidenceRepository standalone authority", function _Suite()
{
	it("reads current local authority without requiring or fabricating a signed Fleet revision", async function _ReadsLocal()
	{
		const f = _Fixture();
		const evidence = await f.repository.load("silo-1", "human-1", 2_000);
		expect(evidence).toEqual({ kind: ExecutionSubjectMembershipKinds.Standalone, principalId: "human-1", siloId: "silo-1", issuer: "https://issuer.example", subjectId: "oidc-1", membershipId: "local-membership-1", membershipUpdatedAt: new Date(1_000).toISOString(), observedAt: new Date(2_000).toISOString(), trustedUntil: new Date(7_000).toISOString() });
		expect(f.transaction.verifiedFleetMembershipRevision.findFirst).not.toHaveBeenCalled();
		expect(f.transaction.principal.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "human-1", siloId: "silo-1", provenance: PrincipalProvenance.External, issuer: "https://issuer.example" } }));
		expect(f.transaction.orgMembership.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { clusterTenant_subject: { clusterTenant: "silo-1", subject: "oidc-1" } } }));
	});

	it.each([null, { id: "other" }, { siloId: "other" }, { issuer: "https://other.example" }, { provenance: PrincipalProvenance.Internal }])("rejects unavailable or substituted Principal %j", async function _RejectsPrincipal(patch)
	{
		const f = _Fixture();
		f.transaction.principal.findFirst.mockResolvedValue(patch === null ? null : { ...f.principal, ...patch });
		await expect(f.repository.load("silo-1", "human-1", 2_000)).resolves.toBeNull();
		expect(f.transaction.orgMembership.findUnique).not.toHaveBeenCalled();
	});

	it.each([null, { status: OrgMemberStatus.Suspended }, { clusterTenant: "other" }, { subject: "other" }, { updatedAt: new Date(3_000) }])("rejects unavailable, inactive or future membership %j", async function _RejectsMembership(patch)
	{
		const f = _Fixture();
		f.transaction.orgMembership.findUnique.mockResolvedValue(patch === null ? null : { ...f.membership, ...patch });
		await expect(f.repository.load("silo-1", "human-1", 2_000)).resolves.toBeNull();
	});

	it("never lets a caller select another silo or fall back after a missing Fleet revision", async function _NoFallback()
	{
		const f = _Fixture();
		await expect(f.repository.load("other-silo", "human-1", 2_000)).resolves.toBeNull();
		expect(f.transaction.principal.findFirst).not.toHaveBeenCalled();
		f.transaction.verifiedFleetMembershipRevision.findFirst.mockResolvedValue(null);
		const verifier = { verify: vi.fn() };
		const fleet = new PrismaHumanMembershipEvidenceRepository(f.transaction as never, { mode: FleetMembershipDeploymentModes.Fleet, trustedIssuerId: "fleet-1", maximumStalenessMs: 5_000, verifier });
		await expect(fleet.load("silo-1", "human-1", 2_000)).resolves.toBeNull();
		expect(f.transaction.orgMembership.findUnique).not.toHaveBeenCalled();
		expect(verifier.verify).not.toHaveBeenCalled();
	});

	it("ignores login profile updates while detecting replacement or changed membership authority", async function _VersionBinding()
	{
		const f = _Fixture();
		const original = (await f.repository.load("silo-1", "human-1", 2_000))!;
		f.transaction.principal.findFirst.mockResolvedValue({ ...f.principal, email: "new@example.test", displayName: "New name", updatedAt: new Date(3_000) });
		const refreshed = (await f.repository.load("silo-1", "human-1", 3_000))!;
		expect(__SameMembershipBinding(original, refreshed)).toBe(true);
		expect(__DigestHumanMembershipEvidence(original)).not.toBe(__DigestHumanMembershipEvidence(refreshed));
		for (const patch of [{ id: "replacement" }, { updatedAt: new Date(2_500) }])
		{
			f.transaction.orgMembership.findUnique.mockResolvedValue({ ...f.membership, ...patch });
			const changed = (await f.repository.load("silo-1", "human-1", 3_000))!;
			expect(__SameMembershipBinding(original, changed)).toBe(false);
		}
	});

	it.each([0, -1, Number.NaN, Infinity, 9e15])("rejects an invalid observation clock %s", async function _Clock(now)
	{
		await expect(_Fixture().repository.load("silo-1", "human-1", now)).resolves.toBeNull();
	});

	it("validates local evidence strictly and rejects contradictory Fleet fields and times", async function _StrictWitness()
	{
		const evidence = await _Fixture().repository.load("silo-1", "human-1", 2_000);
		for (const patch of [{ revision: 1 }, { assertionId: "fake" }, { signature: "fake" }, { unknown: true }, { observedAt: new Date(8_000).toISOString() }, { trustedUntil: new Date(2_000).toISOString() }, { membershipUpdatedAt: "1970-01-01T00:00:01Z" }])
			expect(___StandaloneMembershipSchema.safeParse({ ...evidence, ...patch }).success).toBe(false);
	});
});
