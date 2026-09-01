import { AgentConfigPatchKinds } from "@opencrane/contracts";
import { describe, expect, it, vi } from "vitest";

import type { PersonalConfigurationProposalPersistenceReceipt } from "../proposal/personal-configuration-proposal-repository.types";
import { PersonalConfigurationProposalCodes } from "../proposal/personal-configuration-proposal.types";
import { _ProposeUpgradeSession } from "../upgrade-session/upgrade-session-proposal";
import type { PersonalUpgradeSessionCandidate, PersonalUpgradeSessionSnapshot } from "../upgrade-session/upgrade-session.types";

/** Builds the validated candidate consumed by transaction-scoped orchestration. */
function _candidate(): PersonalUpgradeSessionCandidate
{
	const candidate: PersonalUpgradeSessionCandidate = {
		runId: "run-1",
		attempt: 1,
		toolRevisionId: "upgrade-session-v1",
		toolInvocationId: "invocation-1",
		arguments: { kind: AgentConfigPatchKinds.ModelAlias, modelAlias: "careful-model" },
		argumentsDigest: "sha256:2f03c46815d8ef4662fd1544f939dd487e797baebec17c65b10742222a0a4406",
	};
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
		attempt: 1,
		executionSubject: _ExecutionSubject(),
	} as unknown as PersonalUpgradeSessionSnapshot;
	return snapshot;
}

/** Builds the admitted execution subject used by the personal proposal tests. */
function _ExecutionSubject(): PersonalUpgradeSessionSnapshot["executionSubject"]
{
	return {
		schemaVersion: 1,
		siloId: "silo-1",
		agentIdentityId: "identity-1",
		principalId: "user-1",
		identity: { agentIdentityId: "identity-1", principalId: "user-1", siloId: "silo-1", headRevision: "1", headDigest: `sha256:${"a".repeat(64)}`, decisionEvidenceId: "identity-decision-1", verifiedAt: "2026-08-01T00:00:00.000Z" },
		membership: { principalId: "user-1", siloId: "silo-1", revision: 1, assertionId: "assertion-1", payloadDigest: `sha256:${"b".repeat(64)}`, decisionEvidenceId: "membership-decision-1", trustedUntil: "2026-08-01T01:00:00.000Z" },
		capability: { agentIdentityId: "identity-1", computerId: "computer-1", capabilitySetDigest: `sha256:${"c".repeat(64)}`, effectiveContractDigest: `sha256:${"d".repeat(64)}`, decisionEvidenceId: "capability-decision-1", decidedAt: "2026-08-01T00:00:00.000Z" },
		runScope: { siloId: "silo-1", runId: "run-1", attempt: 1, agentServiceId: "service-1", agentRevisionId: "agent-1" },
		computerScope: { siloId: "silo-1", computerId: "computer-1", leaseId: "lease-1", leaseGeneration: 1 },
		requester: { siloId: "silo-1", requesterPrincipalId: "user-1", requestIdempotencyKey: "request-1", authenticatedAt: "2026-08-01T00:00:00.000Z" },
		admission: { authorizingPrincipalId: "user-1", decisionEvidenceId: "admission-decision-1", admittedAt: "2026-08-01T00:00:00.000Z" },
	};
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

	it("rejects a candidate from a different execution attempt", async function _RejectsAttemptSubstitution()
	{
		await expect(_ProposeUpgradeSession(_profiles(), _proposals(), { ..._candidate(), attempt: 2 }, _snapshot(), "2026-08-01T00:00:00.000Z")).rejects.toThrow("requires a personal conversation snapshot");
	});
});
