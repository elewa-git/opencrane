import { describe, expect, it, vi } from "vitest";

import { __CreatePersonaDraftFromInterview } from "../persona-draft-from-interview.js";
import type { PersonaDraftFromInterviewRepository } from "../persona-draft-authority.types.js";

/** Build a complete server-owned draft request for one completed onboarding interview. */
function _Command()
{
	return { siloId: "silo-1", userId: "user-1", personaProfileId: "profile-1", interviewId: "interview-1", authoredAt: "2026-07-26T12:00:00.000Z" };
}

describe("__CreatePersonaDraftFromInterview", function _DescribePersonaDraftFromInterview()
{
	it("rejects malformed owner coordinates before persistence", async function _RejectsMalformedCommand()
	{
		const repository = { createFromInterviewAtomically: vi.fn() } as unknown as PersonaDraftFromInterviewRepository;

		await expect(__CreatePersonaDraftFromInterview(repository, { ..._Command(), userId: " " })).resolves.toEqual({ outcome: "denied", reason: "invalid_command" });
		expect(repository.createFromInterviewAtomically).not.toHaveBeenCalled();
	});

	it("delegates insight derivation without accepting browser-supplied insight text", async function _DelegatesServerDerivedInsights()
	{
		const createFromInterviewAtomically = vi.fn().mockResolvedValue({ status: "created", personaRevisionId: "revision-1" });
		const repository = { createFromInterviewAtomically } as PersonaDraftFromInterviewRepository;

		await expect(__CreatePersonaDraftFromInterview(repository, _Command())).resolves.toEqual({ outcome: "created", personaRevisionId: "revision-1" });
		expect(createFromInterviewAtomically).toHaveBeenCalledWith(_Command());
	});
});
