import { describe, expect, it } from "vitest";

import { __ProposePersonalConfigurationChange } from "../personal-configuration.js";

/** Build one valid proposal command with optional overrides. */
function _Command(overrides: Partial<Parameters<typeof __ProposePersonalConfigurationChange>[1]> = {})
{
	return { siloId: "silo-1", userId: "user-1", personaProfileId: "profile-1", agentServiceId: "service-1", sourceThreadId: "thread-1", sourceRunId: "run-1", sourceMessageId: "message-1", requestedPatch: { modelAlias: "careful-model" }, requestedPatchDigest: "sha256:389a2c5d10dcc2b13b1910f833c7f2ceaa3417a81ac583a9085b47df00aeb7d2", expectedPersonaRevisionId: "persona-1", expectedAgentRevisionId: "agent-1", proposedAt: "2026-07-23T00:00:00.000Z", ...overrides };
}

describe("personal configuration proposals", function _Suite()
{
	it("persists a provenance-bound request without changing a current run", async function _Proposes()
	{
		let accepted: unknown;
		const result = await __ProposePersonalConfigurationChange({ proposeAtomically: async function _propose(command) { accepted = command; return { status: "proposed", changeId: "change-1" } as const; } }, _Command());
		expect(result).toEqual({ outcome: "proposed", changeId: "change-1" });
		expect(accepted).toMatchObject({ sourceThreadId: "thread-1", sourceRunId: "run-1", expectedPersonaRevisionId: "persona-1", expectedAgentRevisionId: "agent-1" });
	});

	it("refuses malformed proposal evidence before persistence", async function _RejectsMalformed()
	{
		let called = false;
		const result = await __ProposePersonalConfigurationChange({ proposeAtomically: async function _propose() { called = true; return { status: "proposed", changeId: "unexpected" } as const; } }, _Command({ requestedPatchDigest: "not-a-digest" }));
		expect(result).toEqual({ outcome: "denied", reason: "invalid_command" });
		expect(called).toBe(false);
	});

	it("refuses a valid-looking digest for a different patch", async function _RejectsMismatchedDigest()
	{
		const result = await __ProposePersonalConfigurationChange({ proposeAtomically: async function _propose() { return { status: "proposed", changeId: "unexpected" } as const; } }, _Command({ requestedPatchDigest: `sha256:${"a".repeat(64)}` }));
		expect(result).toEqual({ outcome: "denied", reason: "invalid_command" });
	});

	it("rejects a malformed null patch without throwing", async function _RejectsNullPatch()
	{
		const result = await __ProposePersonalConfigurationChange({ proposeAtomically: async function _propose() { return { status: "proposed", changeId: "unexpected" } as const; } }, _Command({ requestedPatch: null as never }));
		expect(result).toEqual({ outcome: "denied", reason: "invalid_command" });
	});
});
