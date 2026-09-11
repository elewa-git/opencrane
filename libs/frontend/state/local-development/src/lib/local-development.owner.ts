import { signal } from "@angular/core";

import { ConversationModes } from "@opencrane/models/conversations";
import { PersonaFirstChatArchetypes } from "@opencrane/models/user-onboarding";
import { PersonaOnboardingStates } from "@opencrane/state/onboarding";

import { _CreateLocalDevelopmentFirstChatGateway, _CreateLocalDevelopmentFirstChatSnapshot } from "./local-development.first-chat";
import { _CreateLocalDevelopmentHistory } from "./local-development.history";
import type { _LocalDevelopmentState, LocalDevelopmentOwnerPorts } from "./local-development.owner.types";
import { _CreateLocalDevelopmentPersona, _CreateLocalDevelopmentPersonaGateway } from "./local-development.persona";
import { LocalDevelopmentScenarios, type LocalDevelopmentConfig } from "./local-development.types";
import { _CreateLocalDevelopmentAgentConversation, _CreateLocalDevelopmentOrdinaryConversation, _CreateLocalDevelopmentWorkspacePorts, _LOCAL_DEVELOPMENT_SUBJECT } from "./local-development.workspace";

/** Replaces every archetype-dependent workspace projection as one coherent fixture set. */
function _ResetWorkspace(state: _LocalDevelopmentState): void
{
	const conversations = [
		...(state.persona.state === PersonaOnboardingStates.Ready ? [_CreateLocalDevelopmentAgentConversation(state)] : []),
		_CreateLocalDevelopmentOrdinaryConversation("local-conversation-direct", ConversationModes.Direct, [_LOCAL_DEVELOPMENT_SUBJECT, "local-peer"]),
		_CreateLocalDevelopmentOrdinaryConversation("local-conversation-group", ConversationModes.Group, [_LOCAL_DEVELOPMENT_SUBJECT, "local-peer", "local-peer-two"])
	];
	const histories = new Map<string, ReturnType<typeof _CreateLocalDevelopmentHistory>>();
	for (const conversation of conversations)
	{
		histories.set(conversation.id, _CreateLocalDevelopmentHistory(state, conversation.id));
	}
	state.conversations = conversations;
	state.histories = histories;
}

/** Builds every current Tier 1 port over one disposable in-memory owner. */
export function _CreateLocalDevelopmentOwner(config: LocalDevelopmentConfig): LocalDevelopmentOwnerPorts
{
	const archetype = config.archetype ?? PersonaFirstChatArchetypes.Commander;
	const startsWithOnboarding = config.startWithOnboarding ?? config.archetype === undefined;
	const firstChatAnswers = startsWithOnboarding ? [] : ["Current OpenCrane work", "Repeated setup", "Use direct evidence"];
	const state: _LocalDevelopmentState = {
		archetype,
		scenario: config.scenario ?? LocalDevelopmentScenarios.HappyPath,
		persona: _CreateLocalDevelopmentPersona(archetype, startsWithOnboarding),
		personaResolutions: new Map(),
		firstChatStarted: !startsWithOnboarding,
		firstChatCompleted: !startsWithOnboarding,
		firstChatAnswers,
		firstChatReceipts: new Map(),
		conversationReceipts: new Map(),
		messageReceipts: new Map(),
		assetReceipts: new Map(),
		groupChildReceipts: new Map(),
		groupShareReceipts: new Map(),
		retryAvailable: config.scenario === LocalDevelopmentScenarios.Retry,
		conversations: [],
		histories: new Map(),
		assets: new Map(),
		assetBytes: new Map(),
		children: []
	};
	_ResetWorkspace(state);

	const persona = _CreateLocalDevelopmentPersonaGateway(state, function _ResetPersonaWorkspace() { _ResetWorkspace(state); });
	const firstChat = _CreateLocalDevelopmentFirstChatGateway(state);
	const workspacePorts = _CreateLocalDevelopmentWorkspacePorts(state, function _FirstChatSnapshot() { return _CreateLocalDevelopmentFirstChatSnapshot(state); });
	return { persona, firstChat, ...workspacePorts, subject: signal<string | null>(_LOCAL_DEVELOPMENT_SUBJECT).asReadonly() };
}
