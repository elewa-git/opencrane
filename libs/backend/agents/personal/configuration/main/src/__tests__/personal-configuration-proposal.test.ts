import { AgentConfigPatchKinds } from "@opencrane/contracts";
import { describe, expect, it, vi } from "vitest";

import { __ProposePersonalConfigurationChange } from "../proposal/personal-configuration-proposal.js";
import type { PersonalConfigurationProposalPersistenceReceipt } from "../proposal/personal-configuration-proposal-repository.types.js";
import { PersonalConfigurationProposalCodes, type ProposePersonalConfigurationChangeCommand } from "../proposal/personal-configuration-proposal.types.js";

/** Build one valid proposal command with optional overrides. */
function _Command(overrides: Partial<ProposePersonalConfigurationChangeCommand> = {}): ProposePersonalConfigurationChangeCommand
{
	return { siloId: "silo-1", userId: "user-1", personaProfileId: "profile-1", agentServiceId: "service-1", sourceConversationId: "conversation-1", sourceRunId: "run-1", sourceMessageId: "message-1", requestedPatch: { kind: AgentConfigPatchKinds.ModelAlias, modelAlias: "careful-model" }, requestedPatchDigest: "sha256:2f03c46815d8ef4662fd1544f939dd487e797baebec17c65b10742222a0a4406", expectedPersonaRevisionId: "persona-1", expectedAgentRevisionId: "agent-1", proposedAt: "2026-07-23T00:00:00.000Z", ...overrides };
}

/** Invalid command classes that must fail before the provenance transaction is entered. */
const _INVALID_COMMANDS = [
	{ label: "a blank required identifier", command: _Command({ siloId: "   " }) },
	{ label: "an overlong required identifier", command: _Command({ userId: "u".repeat(201) }) },
	{ label: "a blank optional message identifier", command: _Command({ sourceMessageId: "" }) },
	{ label: "a blank expected revision identifier", command: _Command({ expectedAgentRevisionId: "" }) },
	{ label: "an invalid proposal instant", command: _Command({ proposedAt: "not-an-instant" }) },
	{ label: "a parseable but non-ISO proposal instant", command: _Command({ proposedAt: "2026-07-23" }) },
	{ label: "an unknown top-level field", command: { ..._Command(), unexpected: true } as never },
];

/** Build one durable proposal receipt returned by the persistence boundary. */
function _proposalReceipt(changeId: string): PersonalConfigurationProposalPersistenceReceipt
{
	const receipt: PersonalConfigurationProposalPersistenceReceipt = { changeId };
	return receipt;
}

describe("personal configuration proposals", function _PersonalConfigurationProposalSuite()
{
	it("persists a provenance-bound request without changing a current run", async function _Proposes()
	{
		let accepted: unknown;
		const result = await __ProposePersonalConfigurationChange({ propose: async function _Propose(command) { accepted = command; return _proposalReceipt("change-1"); } }, _Command({ sourceMessageId: null }));
		expect(result).toEqual({ outcome: PersonalConfigurationProposalCodes.Proposed, changeId: "change-1" });
		expect(accepted).toMatchObject({ sourceConversationId: "conversation-1", sourceRunId: "run-1", sourceMessageId: null, expectedPersonaRevisionId: "persona-1", expectedAgentRevisionId: "agent-1" });
	});

	it.each(_INVALID_COMMANDS)("refuses $label before persistence", async function _RejectsInvalidCommand(testCase)
	{
		const propose = vi.fn(async function _Propose() { return _proposalReceipt("unexpected"); });
		const result = await __ProposePersonalConfigurationChange({ propose }, testCase.command);

		expect(result).toEqual({ outcome: PersonalConfigurationProposalCodes.Denied, reason: PersonalConfigurationProposalCodes.InvalidCommand });
		expect(propose).not.toHaveBeenCalled();
	});

	it("refuses malformed proposal evidence before persistence", async function _RejectsMalformed()
	{
		let called = false;
		const result = await __ProposePersonalConfigurationChange({ propose: async function _propose() { called = true; return _proposalReceipt("unexpected"); } }, _Command({ requestedPatchDigest: "not-a-digest" }));
		expect(result).toEqual({ outcome: PersonalConfigurationProposalCodes.Denied, reason: PersonalConfigurationProposalCodes.InvalidCommand });
		expect(called).toBe(false);
	});

	it("refuses a valid-looking digest for a different patch", async function _RejectsMismatchedDigest()
	{
		const result = await __ProposePersonalConfigurationChange({ propose: async function _propose() { return _proposalReceipt("unexpected"); } }, _Command({ requestedPatchDigest: `sha256:${"a".repeat(64)}` }));
		expect(result).toEqual({ outcome: PersonalConfigurationProposalCodes.Denied, reason: PersonalConfigurationProposalCodes.InvalidCommand });
	});

	it("rejects a patch with an extra field that no later authority may interpret", async function _RejectsExtraPatchField()
	{
		const result = await __ProposePersonalConfigurationChange({ propose: async function _propose() { return _proposalReceipt("unexpected"); } }, _Command({ requestedPatch: { kind: "model_alias", modelAlias: "careful-model", budget: 10 } as never }));
		expect(result).toEqual({ outcome: PersonalConfigurationProposalCodes.Denied, reason: PersonalConfigurationProposalCodes.InvalidCommand });
	});
});
