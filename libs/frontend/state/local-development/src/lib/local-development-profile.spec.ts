import { HttpBackend, HttpRequest } from "@angular/common/http";
import { Injector } from "@angular/core";
import { firstValueFrom } from "rxjs";
import { describe, expect, it, vi } from "vitest";

import { ElicitationBodyKinds, ElicitationRequestStates } from "@opencrane/contracts";
import { CONTROL_PLANE_BASE_URL, ControlPlaneApiService } from "@opencrane/core";
import { ConversationAssetLifecycle } from "@opencrane/models/conversation-assets";
import { ConversationModes, MessageContentBlockKinds } from "@opencrane/models/conversations";
import { PersonaFirstChatArchetypes, PersonaOnboardingStates, UserOnboardingRouteStates } from "@opencrane/models/user-onboarding";
import { AGENT_THREAD_GATEWAY, AgentThreadTimelineEntryKinds, type AgentThreadGateway } from "@opencrane/state/conversation/agent-threads";
import { CONVERSATION_ASSETS_GATEWAY, type ConversationAssetsGateway } from "@opencrane/state/conversation/assets";
import { ELICITATION_GATEWAY, type ConversationElicitationGateway } from "@opencrane/state/conversation/elicitation";
import { ConversationEventStreamStatuses, type ConversationEventStream, type ConversationEventStreamUpdate } from "@opencrane/state/conversation/stream";
import { CONVERSATION_WORKSPACE_EVENT_STREAM, CONVERSATION_WORKSPACE_GATEWAY, ConversationOnboardingHistoryStatuses, ConversationRunStates, ConversationWorkspaceGatewayErrorKinds, type ConversationWorkspaceGateway } from "@opencrane/state/conversation/workspace";
import { PERSONA_FIRST_CHAT_GATEWAY, PERSONA_GATEWAY, type PersonaFirstChatGateway, type PersonaGateway } from "@opencrane/state/onboarding";

import { __LocalDevelopmentArchetypeFixture } from "./local-development-archetype.fixtures";
import { LOCAL_DEVELOPMENT_ARCHETYPE } from "./local-development-archetype";
import { provideLocalDevelopmentGateways } from "./local-development.providers";
import { LOCAL_DEVELOPMENT_SCENARIO } from "./local-development-scenario";
import { LocalDevelopmentScenarioKinds } from "./local-development-scenario.types";

/** Build one isolated happy-path profile for a focused lifecycle test. */
function _Profile(scenario = LocalDevelopmentScenarioKinds.HappyPath, archetype = PersonaFirstChatArchetypes.Commander): Injector
{
	return Injector.create({
		providers: [
			...provideLocalDevelopmentGateways(),
			ControlPlaneApiService,
			{ provide: CONTROL_PLANE_BASE_URL, useValue: "https://local.opencrane.invalid" },
			{ provide: LOCAL_DEVELOPMENT_SCENARIO, useValue: scenario },
			{ provide: LOCAL_DEVELOPMENT_ARCHETYPE, useValue: archetype }
		]
	});
}

describe("Tier 1 local-development profile", function _Suite()
{
	it.each(Object.values(PersonaFirstChatArchetypes))("carries the %s fixture from persona answers into completed onboarding history", async function _OnboardingLifecycle(archetype: PersonaFirstChatArchetypes)
	{
		const fixture = __LocalDevelopmentArchetypeFixture(archetype);
		const injector = _Profile(LocalDevelopmentScenarioKinds.HappyPath, archetype);
		const persona = injector.get<PersonaGateway>(PERSONA_GATEWAY);
		const firstChat = injector.get<PersonaFirstChatGateway>(PERSONA_FIRST_CHAT_GATEWAY);
		const workspace = injector.get<ConversationWorkspaceGateway>(CONVERSATION_WORKSPACE_GATEWAY);
		const agentThreads = injector.get<AgentThreadGateway>(AGENT_THREAD_GATEWAY);
		let survey = await persona.load();
		expect(survey.questionCount).toBe(10);
		expect(survey.questions[0]?.prompt).toBe("When you need to make a decision at work, which feels most natural?");
		expect(survey.questions.at(-1)?.prompt).toBe("Pick the tone that would make you most comfortable working with an AI assistant every day.");
		const selectedChoiceIds = survey.questions.map(question => fixture.answerChoiceIds[question.id]!);
		const wrongChoiceId = survey.questions[0]!.choices.find(choice => choice.id !== selectedChoiceIds[0])!.id;
		await expect(persona.recordAnswer(survey.interviewId!, survey.questions[0]!.id, wrongChoiceId)).rejects.toThrow(`Tier 1 follows the reviewed ${fixture.displayName} path`);
		expect((await persona.load()).answeredQuestionCount).toBe(0);
		await persona.recordAnswer(survey.interviewId!, survey.questions[0]!.id, selectedChoiceIds[0]!);
		await persona.startInterview();
		survey = await persona.load();
		expect(survey.answeredQuestionCount).toBe(1);
		expect(survey.questions[0]?.selectedChoiceId).toBe(selectedChoiceIds[0]);
		for (const [index, question] of survey.questions.entries())
		{
			if (index > 0)
			{
				await persona.recordAnswer(survey.interviewId!, question.id, selectedChoiceIds[index]!);
			}
		}
		survey = await persona.load();
		await persona.completeInterview(survey.interviewId!);
		const preDraft = await persona.load();
		expect(preDraft.questions.map(question => question.selectedChoiceId)).toEqual(selectedChoiceIds);
		expect(preDraft.personaRevisionId).toBeNull();
		expect(preDraft.result?.instructionPreview).toBeNull();
		await persona.createDraft(survey.interviewId!);
		const review = await persona.load();
		expect(review.state).toBe(PersonaOnboardingStates.Review);
		expect(review.questions.map(question => question.selectedChoiceId)).toEqual(selectedChoiceIds);
		expect(review.result).toMatchObject({
			displayName: fixture.displayName,
			primaryColour: fixture.primaryColour,
			secondaryColour: fixture.secondaryColour,
			colourScores: fixture.colourScores,
			opennessScores: fixture.opennessScores
		});
		expect(review.result?.instructionPreview).toBe(fixture.instructionPreview);
		expect(review.result?.instructionPreview).not.toContain("{{");
		await persona.approve(review.personaRevisionId!);
		expect((await firstChat.loadRouteState()).state).toBe(UserOnboardingRouteStates.BootstrapChatPending);

		let chat = await firstChat.start();
		expect(chat.persona).toMatchObject({
			displayName: fixture.displayName,
			archetype: fixture.archetype,
			primaryColour: fixture.firstChatColour
		});
		expect(chat.contentRevision).toMatchObject({
			id: fixture.firstChat.id,
			digest: fixture.firstChat.digest,
			sourceLabel: fixture.firstChat.sourceLabel
		});
		expect(chat.transcript[0]?.text).toBe(fixture.firstChat.opening);
		expect(chat.currentQuestion?.text).toBe(fixture.firstChat.questions[0]);
		expect((await workspace.directory()).personalAgent?.displayName).toBe(fixture.displayName);
		expect((await agentThreads.read("conversation-agent", "conversation-child")).summary.participants.at(-1)?.label).toBe(fixture.displayName);

		while (chat.currentQuestion)
		{
			chat = await firstChat.answer({
				expectedConversationId: chat.conversationId!,
				expectedQuestionOrdinal: chat.currentQuestion.ordinal,
				text: `Answer ${chat.currentQuestion.ordinal}`,
				idempotencyKey: `answer-${chat.currentQuestion.ordinal}`
			});
		}

		chat = await firstChat.conclude();

		expect(chat.state).toBe(UserOnboardingRouteStates.Completed);
		expect((await workspace.onboardingHistory()).status).toBe(ConversationOnboardingHistoryStatuses.Ready);
	});

	it("supports an Agent chat command entirely in memory", async function _AgentChat()
	{
		const injector = _Profile();
		const workspace = injector.get<ConversationWorkspaceGateway>(CONVERSATION_WORKSPACE_GATEWAY);
		const before = await workspace.open("conversation-agent");
		await workspace.send({ conversationId: before.id, idempotencyKey: "message-local-test", blocks: [{ id: "block-local-test", kind: MessageContentBlockKinds.Text, value: "Plan the next step." }] });
		const after = await workspace.open(before.id);

		expect(after.messages).toHaveLength(before.messages.length + 2);
		expect(after.messages.at(-1)?.blocks[0]?.value).toContain("highest-impact dependency");
	});

	it("owns one consistent run across a newly created Agent conversation", async function _CreatedAgentRun()
	{
		const injector = _Profile();
		const workspace = injector.get<ConversationWorkspaceGateway>(CONVERSATION_WORKSPACE_GATEWAY);
		const stream = injector.get<ConversationEventStream>(CONVERSATION_WORKSPACE_EVENT_STREAM);
		const created = await workspace.create({ mode: ConversationModes.AgentSession, personalAgentRef: "agent-service-local-1" });
		await workspace.send({ conversationId: created.id, idempotencyKey: "new-agent-message-local-1", blocks: [{ id: "new-agent-block-local-1", kind: MessageContentBlockKinds.Text, value: "Use this conversation's run." }] });
		const opened = await workspace.open(created.id);
		const runId = opened.messages[0]?.runId;
		expect(runId).toBeTruthy();
		expect(runId).not.toBe("run-local-1");
		expect(opened.messages.every(function _UsesOwnedRun(message) { return message.runId === runId; })).toBe(true);
		expect(await workspace.run(runId!)).toMatchObject({ runId, conversationId: created.id });

		const controller = new AbortController();
		const state = await stream.stream({ conversationId: created.id, signal: controller.signal, onUpdate: function _Update(update): void
		{
			if (update.state.cursor === "local-cursor-5")
			{
				controller.abort();
			}
		} });
		expect(state.runId).toBe(runId);
	});

	it("streams no Agent-run projection for a group conversation", async function _GroupStream()
	{
		const stream = _Profile().get<ConversationEventStream>(CONVERSATION_WORKSPACE_EVENT_STREAM);
		const controller = new AbortController();
		const updates: ConversationEventStreamUpdate[] = [];
		const state = await stream.stream({ conversationId: "conversation-group", signal: controller.signal, onUpdate: function _Update(update): void
		{
			updates.push(update);

			if (update.status === ConversationEventStreamStatuses.Live)
			{
				controller.abort();
			}
		} });

		expect(state.runId).toBeNull();
		expect(state.cursor).toBeNull();
		expect(Object.keys(state.messages)).toHaveLength(0);
		expect(updates.every(update => !update.state.runId)).toBe(true);
	});

	it("retains Agent-thread follow-ups for the next route read", async function _AgentThreadFollowUp()
	{
		const gateway = _Profile().get<AgentThreadGateway>(AGENT_THREAD_GATEWAY);
		const changed = await gateway.sendFollowUp("conversation-agent", "conversation-child", "Keep the safer delivery option.", "follow-up-local-1");
		const reread = await gateway.read("conversation-agent", "conversation-child");

		expect(changed.timeline.at(-1)?.kind).toBe(AgentThreadTimelineEntryKinds.Message);
		expect(reread.timeline).toEqual(changed.timeline);
		expect(reread.timeline.at(-1)).toMatchObject({ message: { body: "Keep the safer delivery option." } });
		await gateway.markReadThrough("conversation-agent", "conversation-child", reread.visibleThroughPosition);
		expect((await gateway.read("conversation-agent", "conversation-child")).summary.unreadCount).toBe(0);
	});

	it("retains the complete asset lifecycle in shared local state", async function _AssetLifecycle()
	{
		const gateway = _Profile().get<ConversationAssetsGateway>(CONVERSATION_ASSETS_GATEWAY);
		const reserved = await gateway.reserve("conversation-agent", { idempotencyKey: "asset-local-1", displayName: "brief.pdf", mediaType: "application/pdf", byteLength: 5, contentAddress: `sha256:${"b".repeat(64)}` });
		const uploaded = await gateway.upload("conversation-agent", reserved.id, new Blob(["brief"], { type: "application/pdf" }) as File);
		const content = await gateway.read("conversation-agent", reserved.id);

		expect(uploaded.state).toBe(ConversationAssetLifecycle.Ready);
		expect(await content.text()).toContain("Tier 1 local-development asset");
		expect(await gateway.list("conversation-agent")).toEqual([uploaded]);
		const removed = await gateway.remove("conversation-agent", reserved.id);
		expect(removed.state).toBe(ConversationAssetLifecycle.Removed);
		expect(await gateway.list("conversation-agent")).toEqual([removed]);
	});

	it("retains an elicitation response in reads and Activity", async function _ElicitationLifecycle()
	{
		const gateway = _Profile().get<ConversationElicitationGateway>(ELICITATION_GATEWAY);
		const initial = await gateway.read("conversation-agent", "approval-local-1");
		const response = await gateway.respond(initial.conversationId, initial.requestId, { idempotencyKey: "approval-response-local-1", response: { kind: ElicitationBodyKinds.Approval, approved: true } });

		expect(response.state).toBe(ElicitationRequestStates.Answered);
		expect(await gateway.read(initial.conversationId, initial.requestId)).toMatchObject({ state: ElicitationRequestStates.Answered, resolvedAt: response.resolvedAt });
		expect(await gateway.listActivity()).toEqual([await gateway.read(initial.conversationId, initial.requestId)]);
	});

	it("fails one retry-scenario command before accepting the unchanged retry", async function _RetryScenario()
	{
		const workspace = _Profile(LocalDevelopmentScenarioKinds.Retry).get<ConversationWorkspaceGateway>(CONVERSATION_WORKSPACE_GATEWAY);
		const command = { conversationId: "conversation-agent", idempotencyKey: "message-local-retry", blocks: [{ id: "block-local-retry", kind: MessageContentBlockKinds.Text, value: "Retry this exact message." }] } as const;

		await expect(workspace.send(command)).rejects.toThrow("Retry to continue");
		await expect(workspace.send(command)).resolves.toBeUndefined();
	});

	it("turns a failed Agent run into a fresh accepted attempt", async function _FailedRunScenario()
	{
		const workspace = _Profile(LocalDevelopmentScenarioKinds.FailedRun).get<ConversationWorkspaceGateway>(CONVERSATION_WORKSPACE_GATEWAY);
		expect((await workspace.run("run-local-1")).state).toBe(ConversationRunStates.Failed);

		const retried = await workspace.retry({ conversationId: "conversation-agent", runId: "run-local-1", expectedAttempt: 1, idempotencyKey: "retry-local-1" });

		expect(retried).toMatchObject({ attempt: 2, state: ConversationRunStates.Accepted });
		expect((await workspace.run("run-local-1")).state).toBe(ConversationRunStates.Accepted);
	});

	it("holds the first stream at reconnecting until its replacement becomes live", async function _ReconnectScenario()
	{
		const stream = _Profile(LocalDevelopmentScenarioKinds.Reconnecting).get<ConversationEventStream>(CONVERSATION_WORKSPACE_EVENT_STREAM);
		const interruptedController = new AbortController();
		const interruptedUpdates: ConversationEventStreamUpdate[] = [];
		const interruptedStream = stream.stream({ conversationId: "conversation-agent", signal: interruptedController.signal, onUpdate: function _InterruptedUpdate(update): void
		{
			interruptedUpdates.push(update);
		} });

		expect(interruptedUpdates.map(update => update.status)).toEqual([
			ConversationEventStreamStatuses.Connecting,
			ConversationEventStreamStatuses.Reconnecting
		]);
		expect(interruptedUpdates.every(update => update.status !== ConversationEventStreamStatuses.Live)).toBe(true);
		interruptedController.abort();
		const interruptedState = await interruptedStream;
		expect(interruptedState.cursor).toBeNull();
		expect(interruptedUpdates.at(-1)?.status).toBe(ConversationEventStreamStatuses.Aborted);

		const replacementController = new AbortController();
		const replacementUpdates: ConversationEventStreamUpdate[] = [];
		const replacementState = await stream.stream({ conversationId: "conversation-agent", signal: replacementController.signal, onUpdate: function _ReplacementUpdate(update): void
		{
			replacementUpdates.push(update);

			if (update.state.cursor === "local-cursor-5")
			{
				replacementController.abort();
			}
		} });

		expect(replacementUpdates.some(update => update.status === ConversationEventStreamStatuses.Reconnecting)).toBe(false);
		expect(replacementState.cursor).toBe("local-cursor-5");
		expect(replacementUpdates.at(-1)?.status).toBe(ConversationEventStreamStatuses.Aborted);
	});

	it("fails an access-changed detail read with the canonical gateway kind", async function _AccessChangedScenario()
	{
		const workspace = _Profile(LocalDevelopmentScenarioKinds.AccessChanged).get<ConversationWorkspaceGateway>(CONVERSATION_WORKSPACE_GATEWAY);

		await expect(workspace.open("conversation-agent")).rejects.toMatchObject({ kind: ConversationWorkspaceGatewayErrorKinds.AccessChanged });
	});

	it("revokes the routed stream when conversation access changes", async function _AccessChangedStreamScenario()
	{
		const stream = _Profile(LocalDevelopmentScenarioKinds.AccessChanged).get<ConversationEventStream>(CONVERSATION_WORKSPACE_EVENT_STREAM);
		const updates: ConversationEventStreamUpdate[] = [];
		const state = await stream.stream({ conversationId: "conversation-agent", signal: new AbortController().signal, onUpdate: function _Update(update): void
		{
			updates.push(update);
		} });

		expect(updates.map(update => update.status)).toEqual([
			ConversationEventStreamStatuses.Connecting,
			ConversationEventStreamStatuses.Failed
		]);
		expect(state.accessRevoked).toBe(true);
		expect(state.cursor).toBeNull();
		expect(Object.keys(state.messages)).toHaveLength(0);
		expect(Object.keys(state.tools)).toHaveLength(0);
		expect(state.surfaces.size).toBe(0);
	});

	it("blocks an accidentally retained Angular HTTP adapter before transport", async function _NetworkTripwire()
	{
		const backend = _Profile().get(HttpBackend);
		await expect(firstValueFrom(backend.handle(new HttpRequest("GET", "/api/v1/unexpected")))).rejects.toThrow("blocked an unexpected GET request");
	});

	it("blocks generated and transitional OpenCrane clients before native fetch", async function _OpenCraneFetchTripwire()
	{
		const browserFetch = vi.spyOn(globalThis, "fetch");
		const api = _Profile().get(ControlPlaneApiService);
		await expect(api.client.GET("/auth/me")).rejects.toThrow("blocked an unexpected OpenCrane API request");
		await expect(api.request("GET", "/unexpected")).rejects.toThrow("blocked an unexpected OpenCrane API request");
		expect(browserFetch).not.toHaveBeenCalled();
		browserFetch.mockRestore();
	});
});
