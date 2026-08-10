import { describe, expect, it } from "vitest";
import { AgentConfigPatchKinds } from "@opencrane/contracts";

import { __ProposePersonalConfigurationChange } from "../proposal/personal-configuration-proposal.js";
import { PersonalConfigurationProposalCodes } from "../proposal/personal-configuration-proposal.types.js";

/** Build one valid proposal command with optional overrides. */
function _Command(overrides: Partial<Parameters<typeof __ProposePersonalConfigurationChange>[1]> = {})
{
	return { siloId: "silo-1", userId: "user-1", personaProfileId: "profile-1", agentServiceId: "service-1", sourceConversationId: "conversation-1", sourceRunId: "run-1", sourceMessageId: "message-1", requestedPatch: { kind: AgentConfigPatchKinds.ModelAlias, modelAlias: "careful-model" }, requestedPatchDigest: "sha256:2f03c46815d8ef4662fd1544f939dd487e797baebec17c65b10742222a0a4406", expectedPersonaRevisionId: "persona-1", expectedAgentRevisionId: "agent-1", proposedAt: "2026-07-23T00:00:00.000Z", ...overrides };
}

describe("personal configuration proposals", function _PersonalConfigurationProposalSuite()
{
	it("persists a provenance-bound request without changing a current run", async function _Proposes()
	{
		let accepted: unknown;
		const result = await __ProposePersonalConfigurationChange({ proposeAtomically: async function _propose(command) { accepted = command; return { status: PersonalConfigurationProposalCodes.Proposed, changeId: "change-1" } as const; } }, _Command());
		expect(result).toEqual({ outcome: PersonalConfigurationProposalCodes.Proposed, changeId: "change-1" });
		expect(accepted).toMatchObject({ sourceConversationId: "conversation-1", sourceRunId: "run-1", expectedPersonaRevisionId: "persona-1", expectedAgentRevisionId: "agent-1" });
	});

	it("refuses malformed proposal evidence before persistence", async function _RejectsMalformed()
	{
		let called = false;
		const result = await __ProposePersonalConfigurationChange({ proposeAtomically: async function _propose() { called = true; return { status: PersonalConfigurationProposalCodes.Proposed, changeId: "unexpected" } as const; } }, _Command({ requestedPatchDigest: "not-a-digest" }));
		expect(result).toEqual({ outcome: PersonalConfigurationProposalCodes.Denied, reason: PersonalConfigurationProposalCodes.InvalidCommand });
		expect(called).toBe(false);
	});

	it("refuses a valid-looking digest for a different patch", async function _RejectsMismatchedDigest()
	{
		const result = await __ProposePersonalConfigurationChange({ proposeAtomically: async function _propose() { return { status: PersonalConfigurationProposalCodes.Proposed, changeId: "unexpected" } as const; } }, _Command({ requestedPatchDigest: `sha256:${"a".repeat(64)}` }));
		expect(result).toEqual({ outcome: PersonalConfigurationProposalCodes.Denied, reason: PersonalConfigurationProposalCodes.InvalidCommand });
	});

	it("rejects a malformed null patch without throwing", async function _RejectsNullPatch()
	{
		const result = await __ProposePersonalConfigurationChange({ proposeAtomically: async function _propose() { return { status: PersonalConfigurationProposalCodes.Proposed, changeId: "unexpected" } as const; } }, _Command({ requestedPatch: null as never }));
		expect(result).toEqual({ outcome: PersonalConfigurationProposalCodes.Denied, reason: PersonalConfigurationProposalCodes.InvalidCommand });
	});

	it("rejects a patch variant or extra field that no later authority may interpret", async function _RejectsUnknownPatch()
	{
		const result = await __ProposePersonalConfigurationChange({ proposeAtomically: async function _propose() { return { status: PersonalConfigurationProposalCodes.Proposed, changeId: "unexpected" } as const; } }, _Command({ requestedPatch: { kind: "model_alias", modelAlias: "careful-model", budget: 10 } as never }));
		expect(result).toEqual({ outcome: PersonalConfigurationProposalCodes.Denied, reason: PersonalConfigurationProposalCodes.InvalidCommand });
	});
});
