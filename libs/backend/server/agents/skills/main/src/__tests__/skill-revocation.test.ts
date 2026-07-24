import { describe, expect, it, vi } from "vitest";

import { __RevokeSkillRevision } from "../skill-revocation.js";

/** Builds one host-scoped request to withdraw a published revision from future admissions. */
function _Command()
{
	return { siloId: "silo-1", skillId: "skill-1", skillRevisionId: "revision-1", revokedAt: "2026-07-23T12:00:00.000Z" };
}

describe("skill revision revocation", function _describeRevocation()
{
	it("revokes an exact published revision through the atomic authority", async function _revokes()
	{
		const revokeAtomically = vi.fn().mockResolvedValue({ status: "revoked" });
		await expect(__RevokeSkillRevision({ revokeAtomically }, _Command())).resolves.toEqual({ outcome: "revoked" });
		expect(revokeAtomically).toHaveBeenCalledWith(_Command());
	});

	it("rejects a revision that is no longer published without broadening the transition", async function _rejectsNonPublished()
	{
		const revokeAtomically = vi.fn().mockResolvedValue({ status: "not_published" });
		await expect(__RevokeSkillRevision({ revokeAtomically }, _Command())).resolves.toEqual({ outcome: "denied", reason: "not_published" });
	});

	it("rejects an invalid trusted revocation instant before persistence", async function _rejectsInvalidCommand()
	{
		const revokeAtomically = vi.fn();
		await expect(__RevokeSkillRevision({ revokeAtomically }, { ..._Command(), revokedAt: "not-a-date" })).resolves.toEqual({ outcome: "denied", reason: "invalid_command" });
		expect(revokeAtomically).not.toHaveBeenCalled();
	});
});
