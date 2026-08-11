import { AgentConfigPatchKinds } from "@opencrane/contracts";
import { describe, expect, it, vi } from "vitest";

import type { PersonalConfigurationProposalPersistenceReceipt } from "../proposal/personal-configuration-proposal-repository.types.js";
import { PersonalConfigurationProposalCodes } from "../proposal/personal-configuration-proposal.types.js";
import { _ProposeUpgradeSession } from "../upgrade-session/upgrade-session-proposal.js";
import type { PersonalUpgradeSessionCandidate, PersonalUpgradeSessionSnapshot } from "../upgrade-session/upgrade-session.types.js";

/** Builds the validated candidate consumed by transaction-scoped orchestration. */
function _candidate(): PersonalUpgradeSessionCandidate
{
	const candidate = {
		runId: "run-1",
		arguments: { kind: AgentConfigPatchKinds.ModelAlias, modelAlias: "careful-model" },
		argumentsDigest: "sha256:2f03c46815d8ef4662fd1544f939dd487e797baebec17c65b10742222a0a4406",
	} as unknown as PersonalUpgradeSessionCandidate;
	return candidate;
}

/** Builds the personal conversation snapshot admitted before the transaction. */
function _snapshot(): PersonalUpgradeSessionSnapshot
{
	const snapshot = {
		runId: "run-1",
		siloId: "silo-1",
		agentServiceId: "service-1",
		agentRevisionId: "agent-1",
		conversationId: "conversation-1",
		personaRevisionId: "persona-1",
		identitySnapshot: { kind: "user", executionSubjectId: "user-1" },
	} as unknown as PersonalUpgradeSessionSnapshot;
	return snapshot;
}

/** Builds the owner-profile reader used by the pure orchestration tests. */
function _profiles(profileId: string | null = "profile-1")
{
	return { readOwnerProfileId: vi.fn(async function _ReadOwnerProfileId() { return profileId; }) };
}

/** Builds one durable proposal receipt for the transaction-scoped authority. */
function _proposalReceipt(changeId = "change-1"): PersonalConfigurationProposalPersistenceReceipt
{
	const receipt: PersonalConfigurationProposalPersistenceReceipt = { changeId };
	return receipt;
}

/** Builds the transaction-scoped proposal authority used by pure orchestration tests. */
function _proposals()
{
	return { propose: vi.fn(async function _Propose() { return _proposalReceipt(); }) };
}

describe("upgrade-session proposal orchestration", function _UpgradeSessionProposalSuite()
{
	it("maps frozen runtime evidence into one exact proposal command", async function _BuildsProposalCommand()
	{
		const profiles = _profiles();
		const proposals = _proposals();
		const result = await _ProposeUpgradeSession(profiles, proposals, _candidate(), _snapshot(), "2026-08-01T00:00:00.000Z");

		expect(result).toEqual({ outcome: PersonalConfigurationProposalCodes.Proposed, changeId: "change-1" });
		expect(profiles.readOwnerProfileId).toHaveBeenCalledWith({ siloId: "silo-1", userId: "user-1" });
		expect(proposals.propose).toHaveBeenCalledWith({
			siloId: "silo-1",
			userId: "user-1",
			personaProfileId: "profile-1",
			agentServiceId: "service-1",
			sourceConversationId: "conversation-1",
			sourceRunId: "run-1",
			sourceMessageId: null,
			requestedPatch: { kind: AgentConfigPatchKinds.ModelAlias, modelAlias: "careful-model" },
			requestedPatchDigest: "sha256:2f03c46815d8ef4662fd1544f939dd487e797baebec17c65b10742222a0a4406",
			expectedPersonaRevisionId: "persona-1",
			expectedAgentRevisionId: "agent-1",
			proposedAt: "2026-08-01T00:00:00.000Z",
		});
	});

	it("stops before proposal validation when the owner profile is unavailable", async function _RejectsMissingProfile()
	{
		const profiles = _profiles(null);
		const proposals = _proposals();

		await expect(_ProposeUpgradeSession(profiles, proposals, _candidate(), _snapshot(), "2026-08-01T00:00:00.000Z")).resolves.toBeNull();
		expect(proposals.propose).not.toHaveBeenCalled();
	});
});
