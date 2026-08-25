import { Injectable, inject } from "@angular/core";

import type { ConversationElicitation } from "@opencrane/contracts";
import type { PersonaFirstChatSnapshot, PersonaOnboardingSnapshot } from "@opencrane/models/user-onboarding";
import type { AgentThreadSnapshot } from "@opencrane/state/conversation/agent-threads";
import type { ConversationAsset } from "@opencrane/state/conversation/assets";
import { ConversationRunStates, type ConversationRun, type ConversationWorkspaceDetail } from "@opencrane/state/conversation/workspace";

import { __LocalDevelopmentArchetypeFixture } from "./local-development-archetype.fixtures";
import { LOCAL_DEVELOPMENT_ARCHETYPE } from "./local-development-archetype";
import { __CreateLocalConversations, __CreateLocalElicitation } from "./local-development-conversation.fixtures";
import { __CreateLocalPendingFirstChat } from "./local-development-first-chat.fixtures";
import { __CreateLocalPersonaInterview } from "./local-development-persona-interview.fixtures";
import { LOCAL_DEVELOPMENT_SCENARIO } from "./local-development-scenario";
import { LocalDevelopmentScenarioKinds } from "./local-development-scenario.types";

/**
 * Owns the shared, disposable state behind every Tier 1 gateway. Registering this class once in
 * {@link provideLocalDevelopmentGateways} keeps persona approval, first chat, conversations, runs,
 * assets, approvals, and child Agent threads consistent across route changes without a backend.
 * Reloading the page creates a new lifecycle rather than restoring product data.
 */
@Injectable()
export class LocalDevelopmentState
{
	/** Reviewed fixture selected once for this application lifecycle. */
	public readonly fixture = __LocalDevelopmentArchetypeFixture(inject(LOCAL_DEVELOPMENT_ARCHETYPE));
	/** Allowlisted behaviour selected when the application started. */
	public readonly scenario = inject(LOCAL_DEVELOPMENT_SCENARIO);
	/** Persona lifecycle shared with the onboarding gateways. */
	public persona: PersonaOnboardingSnapshot = __CreateLocalPersonaInterview();
	/** Bootstrap conversation unlocked when the persona is approved. */
	public firstChat: PersonaFirstChatSnapshot = __CreateLocalPendingFirstChat(this.fixture);
	/** Conversation projections keyed by their local identifiers. */
	public readonly conversations = new Map<string, ConversationWorkspaceDetail>(__CreateLocalConversations().map(function _Index(detail): [string, ConversationWorkspaceDetail] { return [detail.id, detail]; }));
	/** Agent-run projections keyed by their local identifiers. */
	public readonly runs = new Map<string, ConversationRun>([["run-local-1", { runId: "run-local-1", attempt: 1, state: ConversationRunStates.Running, conversationId: "conversation-agent" }]]);
	/** Uploaded asset metadata retained for this browser session. */
	public readonly assets = new Map<string, ConversationAsset>();
	/** Child Agent-session projections retained for subsequent route reads. */
	public readonly agentThreads = new Map<string, AgentThreadSnapshot>();
	/** Approval request displayed through the participant-input port. */
	public elicitation: ConversationElicitation = __CreateLocalElicitation();
	/** Admitted participant-message commands keyed by their retry coordinate. */
	public readonly admittedMessageCommands = new Map<string, string>();
	/** Mutation keys already failed once in the retry scenario. */
	private readonly _failedOnce = new Set<string>();
	/** Increasing counter used to prevent duplicate local identifiers. */
	private _sequence = 10;

	/** Wait briefly only when the slow scenario is active. */
	public async delay(): Promise<void>
	{
		if (this.scenario !== LocalDevelopmentScenarioKinds.Slow)
		{
			return;
		}

		await new Promise<void>(function _Wait(resolve): void { globalThis.setTimeout(resolve, 450); });
	}

	/** Fail the first call for a named operation when the retry scenario is active. */
	public failOnce(operation: string): void
	{
		if (this.scenario !== LocalDevelopmentScenarioKinds.Retry || this._failedOnce.has(operation))
		{
			return;
		}

		this._failedOnce.add(operation);
		throw new Error("The local scenario interrupted this operation. Retry to continue.");
	}

	/** Create a deterministic identifier for a new local record. */
	public nextId(prefix: string): string
	{
		this._sequence += 1;
		return `${prefix}-local-${this._sequence}`;
	}

	/** Find the run assigned to the selected Agent conversation. */
	public runForConversation(conversationId: string): ConversationRun | undefined
	{
		return Array.from(this.runs.values()).find(run => run.conversationId === conversationId);
	}
}
