import type { SignedFleetMembershipRevision } from "@opencrane/models/authorization";
import { describe, expect, it, vi } from "vitest";

import { __SelectCurrentFleetMembershipAssertion } from "../membership-assertion-selection";
import type { FleetMembershipAuthorityRepository } from "../membership-authority.types";

/** Builds the minimal repository around one optional signed revision. */
function _Repository(revision: SignedFleetMembershipRevision | null): FleetMembershipAuthorityRepository
{
	return { getLatestSignedRevision: vi.fn().mockResolvedValue(revision), getHighestAcceptedRevision: vi.fn(), acceptRevisionAtomically: vi.fn() };
}

/** Builds one signed revision with caller-selected assertions. */
function _Revision(assertions: SignedFleetMembershipRevision["assertions"]): SignedFleetMembershipRevision
{
	return { revision: 4, issuerId: "fleet-1", issuerKeyId: "key-1", siloId: "silo-1", issuedAtEpochMs: 1, expiresAtEpochMs: 2, payloadDigest: "sha256:membership", signature: "signature", assertions };
}

describe("current Fleet membership assertion selection", function _Suite()
{
	it("selects exactly one assertion for the requested silo and subject", async function _Selects()
	{
		const repository = _Repository(_Revision([{ assertionId: "other", siloId: "silo-1", subjectId: "other" }, { assertionId: "match", siloId: "silo-1", subjectId: "principal-1" }]));
		await expect(__SelectCurrentFleetMembershipAssertion(repository, { trustedIssuerId: "fleet-1", siloId: "silo-1", subjectId: "principal-1" })).resolves.toEqual({ outcome: "selected", assertionId: "match" });
	});

	it("denies absent and ambiguous signed evidence", async function _Denies()
	{
		await expect(__SelectCurrentFleetMembershipAssertion(_Repository(null), { trustedIssuerId: "fleet-1", siloId: "silo-1", subjectId: "principal-1" })).resolves.toEqual({ outcome: "denied", reason: "missing_revision", revision: 0 });
		const duplicate = _Revision([{ assertionId: "first", siloId: "silo-1", subjectId: "principal-1" }, { assertionId: "second", siloId: "silo-1", subjectId: "principal-1" }]);
		await expect(__SelectCurrentFleetMembershipAssertion(_Repository(duplicate), { trustedIssuerId: "fleet-1", siloId: "silo-1", subjectId: "principal-1" })).resolves.toEqual({ outcome: "denied", reason: "assertion_mismatch", revision: 4 });
	});
});
