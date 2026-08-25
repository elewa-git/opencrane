import { Injectable, inject } from "@angular/core";

import { ConversationLifecycles, ConversationModes, MessageContentBlockKinds, MessageRoles, MessageSources, MessageStates } from "@opencrane/models/conversations";
import { PersonaFirstChatTranscriptRoles, UserOnboardingRouteStates } from "@opencrane/models/user-onboarding";
import { ConversationOnboardingHistoryStatuses, ConversationPersonalAgentStatuses, ConversationRunStates, ConversationWorkspaceGatewayError, ConversationWorkspaceGatewayErrorKinds, type ConversationMessage, type ConversationOnboardingHistoryProjection, type ConversationRun, type ConversationWorkspaceDetail, type ConversationWorkspaceGateway, type CreateConversationCommand, type RetryConversationRunCommand, type SubmitConversationMessageCommand, type SubmitConversationSteeringCommand } from "@opencrane/state/conversation/workspace";

import { LocalDevelopmentScenarioKinds } from "./local-development-scenario.types";
import { LocalDevelopmentState } from "./local-development-state";

/**
 * Implements routed conversation reads and commands against shared Tier 1 state.
 *
 * Conversation modes decide whether a message owns an Agent run, while onboarding history projects
 * the first-chat state completed through the onboarding gateways.
 */
@Injectable()
export class LocalDevelopmentConversationWorkspaceGateway implements ConversationWorkspaceGateway
{
	/** Shared state that keeps list, detail, run, and onboarding-history projections coherent. */
	private readonly _state = inject(LocalDevelopmentState);

	/** Returns fixture participants and the approved personal assistant used by the create form. */
	public async directory()
	{
		await this._state.delay();
		return {
			participants: [
				{
					participantRef: "participant-self",
					isSelf: true,
					label: "You"
				},
				{
					participantRef: "participant-one",
					isSelf: false,
					label: "Amina"
				},
				{
					participantRef: "participant-two",
					isSelf: false,
					label: "Jente"
				}
			],
			personalAgentStatus: ConversationPersonalAgentStatuses.Ready,
			personalAgent: {
				personalAgentRef: "agent-service-local-1",
				displayName: this._state.fixture.displayName
			}
		} as const;
	}

	/** Returns current local conversation rows in their stable insertion order. */
	public async list()
	{
		await this._state.delay();
		return Array.from(this._state.conversations.values());
	}

	/** Projects the completed bootstrap exchange separately from normal conversations. */
	public async onboardingHistory(): Promise<ConversationOnboardingHistoryProjection>
	{
		await this._state.delay();
		const chat = this._state.firstChat;

		if (chat.state !== UserOnboardingRouteStates.Completed || !chat.conversationId || !chat.persona || !chat.startedAt || !chat.completedAt)
		{
			return {
				status: ConversationOnboardingHistoryStatuses.NotCompleted,
				history: null
			};
		}

		return {
			status: ConversationOnboardingHistoryStatuses.Ready,
			history: {
				id: chat.conversationId,
				personaDisplayName: chat.persona.displayName,
				startedAt: chat.startedAt,
				completedAt: chat.completedAt,
				transcript: chat.transcript.map(entry => ({
					ordinal: entry.ordinal,
					role: entry.role === PersonaFirstChatTranscriptRoles.Assistant
						? MessageRoles.Assistant
						: MessageRoles.User,
					text: entry.text
				}))
			}
		};
	}

	/** Returns the selected conversation or reports that its access is no longer available. */
	public async open(conversationId: string): Promise<ConversationWorkspaceDetail>
	{
		await this._state.delay();

		if (this._state.scenario === LocalDevelopmentScenarioKinds.AccessChanged)
		{
			throw new ConversationWorkspaceGatewayError(ConversationWorkspaceGatewayErrorKinds.AccessChanged, "Access to this conversation changed.");
		}

		const detail = this._state.conversations.get(conversationId);

		if (!detail)
		{
			throw new ConversationWorkspaceGatewayError(ConversationWorkspaceGatewayErrorKinds.AccessChanged, "This conversation is unavailable.");
		}

		return detail;
	}

	/** Creates and retains a conversation in the selected mode. */
	public async create(command: CreateConversationCommand): Promise<ConversationWorkspaceDetail>
	{
		await this._state.delay();
		this._state.failOnce("conversation-create");
		const id = this._state.nextId("conversation");
		const participantRefs = command.mode === ConversationModes.AgentSession
			? ["participant-self"]
			: ["participant-self", ...command.participantRefs];
		const detail: ConversationWorkspaceDetail = {
			id,
			mode: command.mode,
			lifecycle: ConversationLifecycles.Open,
			agentServiceId: command.mode === ConversationModes.AgentSession
				? command.personalAgentRef
				: null,
			participantRefs,
			archivedAt: null,
			readThroughPosition: "0",
			updatedAt: "2026-08-21T10:00:00.000Z",
			visibleFromPosition: "1",
			accessEndedPosition: null,
			messages: []
		};
		this._state.conversations.set(id, detail);

		if (command.mode === ConversationModes.AgentSession)
		{
			const runId = this._state.nextId("run");
			this._state.runs.set(runId, {
				runId,
				attempt: 1,
				state: ConversationRunStates.Running,
				conversationId: id
			});
		}

		return detail;
	}

	/** Appends participant input and a realistic fixture response for an Agent session. */
	public async send(command: SubmitConversationMessageCommand): Promise<void>
	{
		await this._state.delay();
		this._state.failOnce("conversation-send");
		const current = this._state.conversations.get(command.conversationId);

		if (!current || current.lifecycle !== ConversationLifecycles.Open)
		{
			throw new ConversationWorkspaceGatewayError(ConversationWorkspaceGatewayErrorKinds.Conflict, "This conversation no longer accepts messages.");
		}

		const run = current.mode === ConversationModes.AgentSession
			? this._state.runForConversation(current.id)
			: null;

		if (current.mode === ConversationModes.AgentSession && !run)
		{
			throw new ConversationWorkspaceGatewayError(ConversationWorkspaceGatewayErrorKinds.Unavailable, "This Agent conversation has no active run.");
		}

		const runId = run?.runId ?? null;
		const position = current.messages.length + 1;
		const userMessage: ConversationMessage = {
			id: this._state.nextId("message"),
			position: String(position),
			role: MessageRoles.User,
			state: MessageStates.Completed,
			source: MessageSources.UserInput,
			blocks: command.blocks.map(block => ({ ...block })),
			runId,
			participantRef: "participant-self",
			createdAt: "2026-08-21T10:01:00.000Z",
			completedAt: "2026-08-21T10:01:00.000Z",
			agentThread: null
		};
		const assistantMessage: ConversationMessage = {
			id: this._state.nextId("message"),
			position: String(position + 1),
			role: MessageRoles.Assistant,
			state: MessageStates.Completed,
			source: MessageSources.ModelOutput,
			blocks: [
				{
					id: this._state.nextId("block"),
					kind: MessageContentBlockKinds.Text,
					value: "I recommend starting with the highest-impact dependency, then checking the result before expanding the change."
				}
			],
			runId,
			participantRef: null,
			createdAt: "2026-08-21T10:01:01.000Z",
			completedAt: "2026-08-21T10:01:01.000Z",
			agentThread: null
		};
		const messages = current.mode === ConversationModes.AgentSession
			? [...current.messages, userMessage, assistantMessage]
			: [...current.messages, userMessage];
		this._state.conversations.set(current.id, {
			...current,
			messages,
			updatedAt: "2026-08-21T10:01:01.000Z"
		});
	}

	/** Changes the local participant's archive projection. */
	public async archive(conversationId: string, archived: boolean): Promise<ConversationWorkspaceDetail>
	{
		const current = await this.open(conversationId);
		const changed = {
			...current,
			archivedAt: archived
				? "2026-08-21T10:05:00.000Z"
				: null
		};
		this._state.conversations.set(conversationId, changed);
		return changed;
	}

	/** Permanently closes one local conversation. */
	public async close(conversationId: string): Promise<ConversationWorkspaceDetail>
	{
		const current = await this.open(conversationId);
		const closed = {
			...current,
			lifecycle: ConversationLifecycles.Closed
		};
		this._state.conversations.set(conversationId, closed);
		return closed;
	}

	/** Returns the local run state selected by the scenario. */
	public async run(runId: string): Promise<ConversationRun>
	{
		const run = this._state.runs.get(runId);

		if (!run)
		{
			throw new ConversationWorkspaceGatewayError(ConversationWorkspaceGatewayErrorKinds.Unavailable, "This run is unavailable.");
		}

		return this._state.scenario === LocalDevelopmentScenarioKinds.FailedRun && run.attempt === 1 && run.state === ConversationRunStates.Running
			? {
				...run,
				state: ConversationRunStates.Failed
			}
			: run;
	}

	/** Accepts a steering instruction without starting external execution. */
	public async steer(_command: SubmitConversationSteeringCommand): Promise<void>
	{
		this._state.failOnce("conversation-steer");
	}

	/** Cancels the run only when its attempt still matches the browser projection. */
	public async cancel(runId: string, expectedAttempt: number): Promise<ConversationRun>
	{
		const current = await this.run(runId);

		if (current.attempt !== expectedAttempt)
		{
			throw new ConversationWorkspaceGatewayError(ConversationWorkspaceGatewayErrorKinds.Conflict, "The run moved to another attempt.");
		}

		const cancelled = {
			...current,
			state: ConversationRunStates.Cancelled
		};
		this._state.runs.set(runId, cancelled);
		return cancelled;
	}

	/** Starts one fresh local attempt after a failed projection. */
	public async retry(command: RetryConversationRunCommand): Promise<ConversationRun>
	{
		const current = await this.run(command.runId);
		const retried = {
			...current,
			attempt: command.expectedAttempt + 1,
			state: ConversationRunStates.Accepted,
			conversationId: command.conversationId
		};
		this._state.runs.set(command.runId, retried);
		return retried;
	}
}
