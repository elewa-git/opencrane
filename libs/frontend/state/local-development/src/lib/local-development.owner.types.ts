import { type InjectionToken, type Signal } from "@angular/core";

import type { GroupChildView } from "@opencrane/models/conversations";
import type { PersonaFirstChatArchetypes } from "@opencrane/models/user-onboarding";
import type { ConversationAsset, ConversationAssetsGateway } from "@opencrane/state/conversation/assets";
import type { ConversationEventStream, ConversationHistoryProjection } from "@opencrane/state/conversation/stream";
import type { ConversationComputerReviewGateway, ConversationGroupChildGateway, ConversationPersonalRunsGateway, ConversationWorkspaceDetail, ConversationWorkspaceGateway } from "@opencrane/state/conversation/workspace";
import { PERSONA_FIRST_CHAT_GATEWAY, type PersonaColours, type PersonaGateway, type PersonaModifiers, type PersonaOnboardingSnapshot, type PersonaResolutionKinds } from "@opencrane/state/onboarding";

import type { _LocalDevelopmentAssetReceipt, _LocalDevelopmentConversationReceipt, _LocalDevelopmentGroupChildReceipt, _LocalDevelopmentGroupShareReceipt, _LocalDevelopmentMessageReceipt } from "./local-development.receipts.types";
import type { LocalDevelopmentConfig, LocalDevelopmentScenarios } from "./local-development.types";

/** Recovers the intentionally token-owned first-chat port without importing an internal file. */
export type _LocalDevelopmentFirstChatGateway = typeof PERSONA_FIRST_CHAT_GATEWAY extends InjectionToken<infer Gateway> ? Gateway : never;

/** Recovers the current first-chat answer command from its token-owned port. */
export type _LocalDevelopmentFirstChatAnswerCommand = Parameters<_LocalDevelopmentFirstChatGateway["answer"]>[0];

/** Retains an accepted first-chat command so the same retry key returns its existing projection. */
export interface _LocalDevelopmentFirstChatReceipt
{
	/** Preserves the coordinates and payload accepted for this retry key. */
	readonly command: _LocalDevelopmentFirstChatAnswerCommand;
}

/** Shares the disposable, mutable fixture data used by every local gateway binding. */
export interface _LocalDevelopmentState
{
	/** Stores the reviewed archetype selected for this browser process. */
	archetype: PersonaFirstChatArchetypes;
	/** Stores the deterministic scenario selected for this browser process. */
	scenario: LocalDevelopmentScenarios;
	/** Holds the current persona workflow projection. */
	persona: PersonaOnboardingSnapshot;
	/** Marks whether the first chat has started. */
	firstChatStarted: boolean;
	/** Marks whether the first chat has passed completion validation. */
	firstChatCompleted: boolean;
	/** Stores answers accepted into the first chat in question order. */
	firstChatAnswers: string[];
	/** Stores reviewed persona tie choices by the scoring stage they resolve. */
	personaResolutions: Map<PersonaResolutionKinds, PersonaColours | PersonaModifiers>;
	/** Indexes accepted first-chat answers by retry key. */
	firstChatReceipts: Map<string, _LocalDevelopmentFirstChatReceipt>;
	/** Indexes accepted conversation creations by caller-scoped retry key. */
	conversationReceipts: Map<string, _LocalDevelopmentConversationReceipt>;
	/** Indexes accepted participant messages by conversation and retry key. */
	messageReceipts: Map<string, _LocalDevelopmentMessageReceipt>;
	/** Indexes accepted file reservations by conversation and retry key. */
	assetReceipts: Map<string, _LocalDevelopmentAssetReceipt>;
	/** Indexes accepted group-child requests by caller-scoped retry key. */
	groupChildReceipts: Map<string, _LocalDevelopmentGroupChildReceipt>;
	/** Indexes accepted reviewed shares by parent conversation and retry key. */
	groupShareReceipts: Map<string, _LocalDevelopmentGroupShareReceipt>;
	/** Marks whether the retry scenario still owes its configured failure. */
	retryAvailable: boolean;
	/** Stores the current conversation metadata rows. */
	conversations: ConversationWorkspaceDetail[];
	/** Stores the current immutable-history projection for each conversation. */
	histories: Map<string, ConversationHistoryProjection>;
	/** Stores the current file metadata for each conversation. */
	assets: Map<string, ConversationAsset[]>;
	/** Stores disposable file bytes by asset coordinate. */
	assetBytes: Map<string, Blob>;
	/** Stores the current group-child request projections. */
	children: GroupChildView[];
}

/** Groups the workspace ports that read and mutate the shared fixture data. */
export interface _LocalDevelopmentWorkspacePorts
{
	/** Provides conversation metadata and commands. */
	readonly workspace: ConversationWorkspaceGateway;
	/** Provides immutable-history reads and updates. */
	readonly stream: ConversationEventStream;
	/** Provides conversation file metadata and bytes. */
	readonly assets: ConversationAssetsGateway;
	/** Provides personal activity rows. */
	readonly personalRuns: ConversationPersonalRunsGateway;
	/** Provides group-child requests and reviewed-result sharing. */
	readonly groupChildren: ConversationGroupChildGateway;
	/** Rejects computer review because Tier 1 has no Agent Sandbox. */
	readonly computerReview: ConversationComputerReviewGateway;
}

/** Exposes the ports backed by one disposable local state owner to the provider factory. */
export interface LocalDevelopmentOwnerPorts
{
	/** Provides persona interview commands and reads. */
	readonly persona: PersonaGateway;
	/** Provides first-chat commands and reads. */
	readonly firstChat: _LocalDevelopmentFirstChatGateway;
	/** Provides conversation directory, snapshot, and message commands. */
	readonly workspace: ConversationWorkspaceGateway;
	/** Provides conversation event reads and updates. */
	readonly stream: ConversationEventStream;
	/** Provides conversation file commands. */
	readonly assets: ConversationAssetsGateway;
	/** Provides recent personal-run reads. */
	readonly personalRuns: ConversationPersonalRunsGateway;
	/** Provides group-child commands. */
	readonly groupChildren: ConversationGroupChildGateway;
	/** Rejects active-computer review commands because Tier 1 has no Agent Sandbox. */
	readonly computerReview: ConversationComputerReviewGateway;
	/** Identifies the local subject that own-message controls treat as signed in. */
	readonly subject: Signal<string | null>;
}
