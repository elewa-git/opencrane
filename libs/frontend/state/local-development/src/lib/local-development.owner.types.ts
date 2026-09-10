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

/** Accepted first-chat command retained so an exact retry returns the same projection. */
export interface _LocalDevelopmentFirstChatReceipt
{
	/** Original retry coordinate and payload. */
	readonly command: _LocalDevelopmentFirstChatAnswerCommand;
}

/** Mutable disposable data shared by every local gateway binding. */
export interface _LocalDevelopmentState
{
	/** Currently selected reviewed archetype. */
	archetype: PersonaFirstChatArchetypes;
	/** Selected deterministic scenario. */
	scenario: LocalDevelopmentScenarios;
	/** Current persona workflow projection. */
	persona: PersonaOnboardingSnapshot;
	/** Whether the one-time first chat exists. */
	firstChatStarted: boolean;
	/** Whether the one-time first chat passed validation. */
	firstChatCompleted: boolean;
	/** Answers accepted into the first chat. */
	firstChatAnswers: string[];
	/** Current reviewed persona tie choices in authority order. */
	personaResolutions: Map<PersonaResolutionKinds, PersonaColours | PersonaModifiers>;
	/** First-chat successes indexed by retry key. */
	firstChatReceipts: Map<string, _LocalDevelopmentFirstChatReceipt>;
	/** Conversation creations indexed by their caller-scoped retry key. */
	conversationReceipts: Map<string, _LocalDevelopmentConversationReceipt>;
	/** Participant messages indexed by conversation and retry key. */
	messageReceipts: Map<string, _LocalDevelopmentMessageReceipt>;
	/** File reservations indexed by conversation and retry key. */
	assetReceipts: Map<string, _LocalDevelopmentAssetReceipt>;
	/** Group-child requests indexed by their caller-scoped retry key. */
	groupChildReceipts: Map<string, _LocalDevelopmentGroupChildReceipt>;
	/** Reviewed shares indexed by parent conversation and retry key. */
	groupShareReceipts: Map<string, _LocalDevelopmentGroupShareReceipt>;
	/** Whether the retry scenario still owes its single failure. */
	retryAvailable: boolean;
	/** Current conversation metadata rows. */
	conversations: ConversationWorkspaceDetail[];
	/** Current immutable history projections by conversation. */
	histories: Map<string, ConversationHistoryProjection>;
	/** Current file metadata by conversation. */
	assets: Map<string, ConversationAsset[]>;
	/** Disposable file bytes by asset coordinate. */
	assetBytes: Map<string, Blob>;
	/** Current group-child request projections. */
	children: GroupChildView[];
}

/** Ports whose behavior is owned by the shared workspace data. */
export interface _LocalDevelopmentWorkspacePorts
{
	/** Conversation metadata and commands. */
	readonly workspace: ConversationWorkspaceGateway;
	/** Immutable-history updates. */
	readonly stream: ConversationEventStream;
	/** File metadata and bytes. */
	readonly assets: ConversationAssetsGateway;
	/** Personal activity rows. */
	readonly personalRuns: ConversationPersonalRunsGateway;
	/** Group-child requests and shares. */
	readonly groupChildren: ConversationGroupChildGateway;
	/** Fail-closed computer review. */
	readonly computerReview: ConversationComputerReviewGateway;
}

/** Private collection of ports backed by one disposable local state owner. */
export interface LocalDevelopmentOwnerPorts
{
	/** Persona interview commands and reads. */
	readonly persona: PersonaGateway;
	/** First-chat commands and reads. */
	readonly firstChat: _LocalDevelopmentFirstChatGateway;
	/** Conversation directory, snapshot, and message commands. */
	readonly workspace: ConversationWorkspaceGateway;
	/** Conversation event updates. */
	readonly stream: ConversationEventStream;
	/** Conversation file commands. */
	readonly assets: ConversationAssetsGateway;
	/** Recent personal run reads. */
	readonly personalRuns: ConversationPersonalRunsGateway;
	/** Group child commands. */
	readonly groupChildren: ConversationGroupChildGateway;
	/** Active-computer review commands that fail closed locally. */
	readonly computerReview: ConversationComputerReviewGateway;
	/** Fixed verified local subject used by own-message controls. */
	readonly subject: Signal<string | null>;
}
