import { afterEach, describe, expect, it, vi } from "vitest";

import { ConversationModes } from "@opencrane/models/conversations";
import { PersonaFirstChatArchetypes, UserOnboardingRouteStates, ___ParsePersonaFirstChatSnapshot } from "@opencrane/models/user-onboarding";
import { ConversationEventStreamStatuses } from "@opencrane/state/conversation/stream";
import { ConversationOnboardingHistoryStatuses, ConversationPersonalAgentStatuses, ConversationWorkspaceGatewayErrorKinds } from "@opencrane/state/conversation/workspace";
import { PersonaColours, PersonaFirstChatConflictError, PersonaOnboardingStates, PersonaResolutionKinds, _ParsePersonaOnboardingSnapshot } from "@opencrane/state/onboarding";

import { _CreateLocalDevelopmentOwner } from "../local-development.owner";
import { _LOCAL_DEVELOPMENT_NAMED_SELECTIONS } from "../local-development.persona-fixtures";
import { LocalDevelopmentScenarios } from "../local-development.types";

afterEach(function _RestoreGlobals()
{
	vi.unstubAllGlobals();
});

/** Advances one plain local owner to an approved persona and returns its pending first chat. */
async function _ReadyOwner(archetype: PersonaFirstChatArchetypes)
{
	const owner = _CreateLocalDevelopmentOwner({ startWithOnboarding: true });
	await owner.persona.startInterview();
	let persona = await owner.persona.load();
	const selections = _LOCAL_DEVELOPMENT_NAMED_SELECTIONS[archetype];
	for (const [index, question] of persona.questions.entries())
	{
		await owner.persona.recordAnswer(persona.interviewId!, question.id, selections[index]!);
	}
	persona = await owner.persona.load();
	await owner.persona.completeInterview(persona.interviewId!);
	persona = await owner.persona.load();
	await owner.persona.createDraft(persona.interviewId!);
	persona = await owner.persona.load();
	await owner.persona.approve(persona.personaRevisionId!);
	return owner;
}

describe("Tier 1 local-development owner", function _DescribeOwner()
{
	it("keeps onboarding, first chat, and workspace projections coherent without network access", async function _CompleteJourney()
	{
		const fetch = vi.fn();
		vi.stubGlobal("fetch", fetch);
		const owner = _CreateLocalDevelopmentOwner({ archetype: PersonaFirstChatArchetypes.Commander, startWithOnboarding: true });
		expect((await owner.persona.load()).state).toBe(PersonaOnboardingStates.Interview);
		expect(await owner.workspace.directory()).toMatchObject({ personalAgentStatus: ConversationPersonalAgentStatuses.Unavailable, personalAgent: null });
		expect((await owner.workspace.list()).map(item => item.mode)).toEqual([ConversationModes.Direct, ConversationModes.Group]);
		await expect(owner.workspace.open("conversation-agent")).rejects.toMatchObject({ kind: ConversationWorkspaceGatewayErrorKinds.AccessChanged });
		expect(await owner.personalRuns.listPersonalRuns(new AbortController().signal)).toEqual([]);
		await owner.persona.startInterview();
		expect(await owner.firstChat.loadRouteState()).toMatchObject({ state: UserOnboardingRouteStates.SurveyInProgress, personaInterviewId: "local-interview" });
		expect((await owner.firstChat.load()).state).toBe(UserOnboardingRouteStates.SurveyInProgress);
		let persona = await owner.persona.load();
		const catalystSelections = _LOCAL_DEVELOPMENT_NAMED_SELECTIONS[PersonaFirstChatArchetypes.Catalyst];
		for (const [index, question] of persona.questions.entries())
		{
			const choice = catalystSelections[index]!;
			await owner.persona.recordAnswer(persona.interviewId!, question.id, choice);
		}
		persona = await owner.persona.load();
		await owner.persona.completeInterview(persona.interviewId!);
		await owner.persona.createDraft(persona.interviewId!);
		persona = await owner.persona.load();
		await owner.persona.approve(persona.personaRevisionId!);
		expect((await owner.persona.load()).result?.displayName).toBe("The Catalyst");
		expect((await owner.firstChat.loadRouteState()).state).toBe(UserOnboardingRouteStates.BootstrapChatPending);
		expect((await owner.workspace.directory()).personalAgent?.displayName).toBe("The Catalyst");
		expect((await owner.workspace.list()).map(item => item.mode)).toEqual([ConversationModes.AgentSession, ConversationModes.Direct, ConversationModes.Group]);
		expect(await owner.workspace.open("conversation-agent")).toMatchObject({ agentServiceId: "local-agent-catalyst" });

		let chat = await owner.firstChat.start();
		for (let ordinal = 1; ordinal <= 3; ordinal += 1)
		{
			chat = await owner.firstChat.answer({ expectedConversationId: chat.conversationId!, expectedQuestionOrdinal: ordinal, text: "Answer " + ordinal, idempotencyKey: "answer-" + ordinal });
		}
		expect(chat.canConclude).toBe(true);
		chat = await owner.firstChat.conclude();
		expect(chat.state).toBe(UserOnboardingRouteStates.Completed);
		const history = await owner.workspace.onboardingHistory();
		expect(history.status).toBe(ConversationOnboardingHistoryStatuses.Ready);
		expect(history.history?.personaDisplayName).toBe("The Catalyst");
		expect((await owner.workspace.directory()).personalAgent?.displayName).toBe("The Catalyst");
		expect((await owner.workspace.list()).map(item => item.mode)).toEqual([ConversationModes.AgentSession, ConversationModes.Direct, ConversationModes.Group]);
		expect(await owner.workspace.open("conversation-agent")).toMatchObject({ agentServiceId: "local-agent-catalyst" });

		const updates = vi.fn();
		const projection = await owner.stream.stream({ conversationId: "conversation-agent", signal: new AbortController().signal, onUpdate: updates });
		expect(projection.computer).toBeNull();
		expect(projection.entries[0]?.author).toMatchObject({ agentServiceId: "local-agent-catalyst", name: "The Catalyst" });
		expect(Object.values(projection.payloads)).toContain("This is the disposable The Catalyst workspace.");
		expect(updates).toHaveBeenCalledWith(expect.objectContaining({ status: ConversationEventStreamStatuses.Live }));
		expect(fetch).not.toHaveBeenCalled();
	});

	it("uses the current reviewed onboarding question set", async function _BaselineQuestions()
	{
		const owner = _CreateLocalDevelopmentOwner({ startWithOnboarding: true });
		await owner.persona.startInterview();
		const questions = (await owner.persona.load()).questions;
		expect(questions).toHaveLength(10);
		expect(questions[0]).toMatchObject({
			id: "q1-decision-speed",
			category: "Pace",
			prompt: "When you need to make a decision at work, which feels most natural?"
		});
		expect(questions.at(-1)).toMatchObject({
			id: "q10-tone-preference",
			category: "Tone",
			prompt: "Pick the tone that would make you most comfortable working with an AI assistant every day."
		});
	});

	it("surfaces and applies the current ordered tie resolution", async function _TieResolution()
	{
		const owner = _CreateLocalDevelopmentOwner({ startWithOnboarding: true });
		await owner.persona.startInterview();
		let persona = await owner.persona.load();
		const selections = ["a", "a", "a", "a", "a", "a", "b", "c", "c", "d"];
		for (const [index, question] of persona.questions.entries())
		{
			await owner.persona.recordAnswer(persona.interviewId!, question.id, selections[index]!);
		}
		persona = await owner.persona.load();
		await owner.persona.completeInterview(persona.interviewId!);
		persona = await owner.persona.load();
		expect(persona).toMatchObject({ state: PersonaOnboardingStates.Resolution, resolution: { kind: PersonaResolutionKinds.Primary, candidates: [PersonaColours.Red, PersonaColours.Blue] } });
		await owner.persona.resolve(persona.interviewId!, PersonaResolutionKinds.Primary, PersonaColours.Blue);
		expect(await owner.persona.load()).toMatchObject({ state: PersonaOnboardingStates.Review, result: { primaryColour: PersonaColours.Blue, secondaryColour: PersonaColours.Red } });
	});

	it("emits only persona and first-chat lifecycle projections accepted by current validators", async function _ValidLifecycle()
	{
		const owner = _CreateLocalDevelopmentOwner({ startWithOnboarding: true });
		expect(_ParsePersonaOnboardingSnapshot(await owner.persona.load())).toBeDefined();
		expect(___ParsePersonaFirstChatSnapshot(await owner.firstChat.load())).toBeDefined();
		await owner.persona.startInterview();
		expect(_ParsePersonaOnboardingSnapshot(await owner.persona.load())).toBeDefined();

		const ready = await _ReadyOwner(PersonaFirstChatArchetypes.Analyst);
		expect(_ParsePersonaOnboardingSnapshot(await ready.persona.load()).state).toBe(PersonaOnboardingStates.Ready);
		expect(___ParsePersonaFirstChatSnapshot(await ready.firstChat.load()).state).toBe(UserOnboardingRouteStates.BootstrapChatPending);
		let chat = ___ParsePersonaFirstChatSnapshot(await ready.firstChat.start());
		for (let ordinal = 1; ordinal <= chat.questionCount; ordinal += 1)
		{
			chat = ___ParsePersonaFirstChatSnapshot(await ready.firstChat.answer({ expectedConversationId: chat.conversationId!, expectedQuestionOrdinal: ordinal, text: `Validated answer ${ordinal}`, idempotencyKey: `validated-answer-${ordinal}` }));
		}
		expect(___ParsePersonaFirstChatSnapshot(await ready.firstChat.conclude()).canConclude).toBe(false);
	});

	it("replays exact first-chat retries and rejects stale or mismatched coordinates", async function _FirstChatConcurrency()
	{
		const owner = await _ReadyOwner(PersonaFirstChatArchetypes.Commander);
		const started = await owner.firstChat.start();
		const command = { expectedConversationId: started.conversationId!, expectedQuestionOrdinal: 1, text: "Keep the accepted text exact", idempotencyKey: "accepted-answer" };
		const accepted = await owner.firstChat.answer(command);
		expect(await owner.firstChat.answer(command)).toEqual(accepted);

		await expect(owner.firstChat.answer({ ...command, text: "Changed payload" })).rejects.toBeInstanceOf(PersonaFirstChatConflictError);
		await expect(owner.firstChat.answer({ ...command, idempotencyKey: "wrong-conversation", expectedConversationId: "another-conversation", expectedQuestionOrdinal: 2 })).rejects.toBeInstanceOf(PersonaFirstChatConflictError);
		await expect(owner.firstChat.answer({ ...command, idempotencyKey: "stale-ordinal" })).rejects.toBeInstanceOf(PersonaFirstChatConflictError);
	});

	it.each(Object.values(PersonaFirstChatArchetypes))("opens the reviewed %s profile directly", async function _NamedArchetype(archetype)
	{
		const owner = _CreateLocalDevelopmentOwner({ archetype, startWithOnboarding: false });
		expect((await owner.firstChat.loadRouteState()).state).toBe(UserOnboardingRouteStates.Completed);
		expect((await owner.firstChat.load()).persona?.archetype).toBe(archetype);
		expect((await owner.workspace.directory()).personalAgent?.displayName).toMatch(/^The /u);
	});

	it("fails exactly one retry command and exposes finite recovery scenarios", async function _Scenarios()
	{
		const retry = _CreateLocalDevelopmentOwner({ archetype: PersonaFirstChatArchetypes.Analyst, scenario: LocalDevelopmentScenarios.Retry });
		const command = { conversationId: "conversation-agent", idempotencyKey: "retry-command", text: "Try once", activation: "start" as const };
		await expect(retry.workspace.send(command)).rejects.toThrow("failed once");
		await expect(retry.workspace.send(command)).resolves.toBeUndefined();

		const reconnecting = _CreateLocalDevelopmentOwner({ archetype: PersonaFirstChatArchetypes.Anchor, scenario: LocalDevelopmentScenarios.Reconnecting });
		const reconnectUpdate = vi.fn();
		await reconnecting.stream.stream({ conversationId: "conversation-agent", signal: new AbortController().signal, onUpdate: reconnectUpdate });
		expect(reconnectUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: ConversationEventStreamStatuses.Reconnecting, reconnectAttempt: 1 }));

		const accessChanged = _CreateLocalDevelopmentOwner({ archetype: PersonaFirstChatArchetypes.Commander, scenario: LocalDevelopmentScenarios.AccessChanged });
		const accessUpdate = vi.fn();
		expect((await accessChanged.stream.stream({ conversationId: "conversation-agent", signal: new AbortController().signal, onUpdate: accessUpdate })).entries).toEqual([]);
		expect(accessUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: ConversationEventStreamStatuses.AccessChanged }));

		const failedRun = _CreateLocalDevelopmentOwner({ archetype: PersonaFirstChatArchetypes.Commander, scenario: LocalDevelopmentScenarios.FailedRun });
		expect((await failedRun.personalRuns.listPersonalRuns(new AbortController().signal))[0]?.state).toBe("failed");
		const failedHistory = await failedRun.stream.stream({ conversationId: "conversation-agent", signal: new AbortController().signal });
		expect(failedHistory.entries).toEqual([]);
		expect(failedHistory.payloads).toEqual({});
		await expect(failedRun.computerReview.readComputerFile("conversation-agent", "README.md")).rejects.toThrow("Tier 3");
	});
});
