import type { RunInputSnapshot } from "@opencrane/contracts";

import { _IsPersonalConfigurationPatch } from "../proposal/personal-configuration-patch.validator";
import { __ProposePersonalConfigurationChange } from "../proposal/personal-configuration-proposal";
import type { PersonalConfigurationProposalRepository } from "../proposal/personal-configuration-proposal-repository.types";
import type { ProposePersonalConfigurationChangeCommand, ProposePersonalConfigurationChangeResult } from "../proposal/personal-configuration-proposal.types";
import type { PersonalUpgradeSessionCandidate, PersonalUpgradeSessionSnapshot, UpgradeSessionInvocation, UpgradeSessionProfileReadCommand, UpgradeSessionProfileRepository } from "./upgrade-session.types";

/** Reject snapshots that cannot prove a personal conversation before any database access. */
export function _RequirePersonalUpgradeSessionSnapshot(snapshot: RunInputSnapshot): asserts snapshot is PersonalUpgradeSessionSnapshot
{
	if (snapshot.personaRevisionId === null) throw _invalidUpgradeSession();
	if (snapshot.conversationId === null) throw _invalidUpgradeSession();
}

/** Reject runtime arguments outside the model-adjacent personal configuration-patch schema. */
export function _RequirePersonalUpgradeSessionCandidate(candidate: UpgradeSessionInvocation): asserts candidate is PersonalUpgradeSessionCandidate
{
	if (!_IsPersonalConfigurationPatch(candidate.arguments)) throw _invalidUpgradeSession();
}

/** Resolve one owner profile and propose its validated future-session change in the same transaction. */
export async function _ProposeUpgradeSession(profiles: UpgradeSessionProfileRepository, proposals: PersonalConfigurationProposalRepository, candidate: PersonalUpgradeSessionCandidate, snapshot: PersonalUpgradeSessionSnapshot, now: string): Promise<ProposePersonalConfigurationChangeResult | null>
{
	// 1. Resolve the canonical profile for the immutable execution subject.
	const profileId = await profiles.readOwnerProfileId(_profileReadCommand(snapshot));
	if (profileId === null) return null;

	// 2. Construct one complete proposal command from frozen runtime evidence.
	const command = _proposalCommand(candidate, snapshot, profileId, now);

	// 3. Revalidate the command and persist through the transaction-scoped proposal authority.
	return __ProposePersonalConfigurationChange(proposals, command);
}

/** Initializes owner coordinates copied only from the immutable run snapshot. */
function _profileReadCommand(snapshot: PersonalUpgradeSessionSnapshot): UpgradeSessionProfileReadCommand
{
	const command: UpgradeSessionProfileReadCommand = {
		siloId: snapshot.siloId,
		userId: snapshot.identitySnapshot.executionSubjectId,
	};
	return command;
}

/** Initializes the complete future-session proposal from validated runtime evidence. */
function _proposalCommand(candidate: PersonalUpgradeSessionCandidate, snapshot: PersonalUpgradeSessionSnapshot, profileId: string, now: string): ProposePersonalConfigurationChangeCommand
{
	const command: ProposePersonalConfigurationChangeCommand = {
		siloId: snapshot.siloId,
		userId: snapshot.identitySnapshot.executionSubjectId,
		personaProfileId: profileId,
		agentServiceId: snapshot.agentServiceId,
		sourceConversationId: snapshot.conversationId,
		sourceRunId: snapshot.runId,
		sourceMessageId: null,
		requestedPatch: candidate.arguments,
		requestedPatchDigest: candidate.argumentsDigest,
		expectedPersonaRevisionId: snapshot.personaRevisionId,
		expectedAgentRevisionId: snapshot.agentRevisionId,
		proposedAt: now,
	};
	return command;
}

/** Creates the unchanged fail-before-persistence error for an invalid upgrade-session request. */
function _invalidUpgradeSession(): Error
{
	return new Error("upgrade_session requires a personal conversation snapshot and supported configuration patch");
}
