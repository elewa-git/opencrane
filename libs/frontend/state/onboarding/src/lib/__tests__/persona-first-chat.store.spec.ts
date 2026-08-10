// @vitest-environment jsdom

import { TestBed } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { PersonaFirstChatService } from "../persona-first-chat.service.js";
import { PersonaFirstChatStore } from "../persona-first-chat.store.js";
import { PersonaFirstChatCommandPhases } from "../persona-first-chat.store.types.js";
import { PersonaFirstChatArchetypes, PersonaFirstChatColours, PersonaFirstChatConflictError, type PersonaFirstChatSnapshot, PersonaFirstChatTranscriptKinds, PersonaFirstChatTranscriptRoles, UserOnboardingRouteStates } from "../persona-first-chat.types.js";

/** Build one valid first-chat projection for component-scoped store tests. */
function _Snapshot(overrides: Partial<PersonaFirstChatSnapshot> = {}): PersonaFirstChatSnapshot
{
	return {
		workflowVersion: 1,
		state: UserOnboardingRouteStates.BootstrapChatInProgress,
		conversationId: "conversation-1",
		persona: { revisionId: "persona-revision-1", displayName: "The Commander", archetype: PersonaFirstChatArchetypes.Commander, primaryColour: PersonaFirstChatColours.Red },
		contentRevision: { id: "commander-v1", digest: `sha256:${"a".repeat(64)}`, sourceLabel: "The Commander bootstrap" },
		transcript: [
			{ ordinal: 1, role: PersonaFirstChatTranscriptRoles.Assistant, kind: PersonaFirstChatTranscriptKinds.Opening, text: "Welcome.", questionOrdinal: null },
			{ ordinal: 2, role: PersonaFirstChatTranscriptRoles.Assistant, kind: PersonaFirstChatTranscriptKinds.Question, text: "What are you working on?", questionOrdinal: 1 }
		],
		currentQuestion: { ordinal: 1, text: "What are you working on?" },
		answerCount: 0,
		questionCount: 3,
		canConclude: false,
		startedAt: "2026-08-08T10:00:00.000Z",
		completedAt: null,
		...overrides
	};
}

/** Create the service double consumed by one route-scoped store. */
function _Service(snapshot: PersonaFirstChatSnapshot): PersonaFirstChatService
{
	return { load: vi.fn().mockResolvedValue(snapshot), start: vi.fn(), answer: vi.fn(), conclude: vi.fn(), loadRouteState: vi.fn() } as unknown as PersonaFirstChatService;
}

/** Construct a route-scoped store and complete its initial read. */
async function _Store(service: PersonaFirstChatService): Promise<PersonaFirstChatStore>
{
	TestBed.configureTestingModule({ providers: [PersonaFirstChatStore, { provide: PersonaFirstChatService, useValue: service }] });
	const store = TestBed.inject(PersonaFirstChatStore);
	const entering = store.enter();
	TestBed.flushEffects();
	await entering;
	return store;
}

beforeAll(function _InitializeAngularTesting()
{
	TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
});

afterAll(function _ResetAngularTesting()
{
	TestBed.resetTestEnvironment();
});

afterEach(function _ResetTestBed()
{
	TestBed.resetTestingModule();
});

describe("PersonaFirstChatStore", function _PersonaFirstChatStoreSuite()
{
	it("keeps the resource loader read-only and starts through the explicit entry command", async function _ExplicitEntry()
	{
		const pending = _Snapshot({ state: UserOnboardingRouteStates.BootstrapChatPending, conversationId: null, transcript: [], currentQuestion: null, startedAt: null });
		const started = _Snapshot();
		const service = _Service(pending);
		vi.mocked(service.start).mockResolvedValue(started);

		const store = await _Store(service);

		expect(service.load).toHaveBeenCalledTimes(1);
		expect(service.start).toHaveBeenCalledWith(pending);
		expect(store.chat.value()).toBe(started);
	});

	it("exposes route entry as a typed phase until pending start evidence is resolved", async function _EntryPhase()
	{
		const pending = _Snapshot({ state: UserOnboardingRouteStates.BootstrapChatPending, conversationId: null, transcript: [], currentQuestion: null, startedAt: null });
		const started = _Snapshot();
		let finishStart: ((snapshot: PersonaFirstChatSnapshot) => void) | null = null;
		const heldStart = new Promise<PersonaFirstChatSnapshot>(function _HoldStart(resolve) { finishStart = resolve; });
		const service = _Service(pending);
		vi.mocked(service.start).mockReturnValue(heldStart);
		TestBed.configureTestingModule({ providers: [PersonaFirstChatStore, { provide: PersonaFirstChatService, useValue: service }] });
		const store = TestBed.inject(PersonaFirstChatStore);

		const entering = store.enter();
		TestBed.flushEffects();
		await vi.waitFor(function _StartAdmitted() { expect(service.start).toHaveBeenCalledWith(pending); });
		expect(store.phase()).toBe(PersonaFirstChatCommandPhases.Entering);
		if (finishStart === null) throw new Error("start completion was not captured");
		finishStart(started);
		await entering;

		expect(store.phase()).toBe(PersonaFirstChatCommandPhases.Idle);
		expect(store.chat.value()).toBe(started);
	});

	it("reuses a failed answer key and resets its draft only after the authoritative question advances", async function _RetryStableAnswer()
	{
		const started = _Snapshot();
		const advanced = _Snapshot({ answerCount: 1, currentQuestion: { ordinal: 2, text: "What wastes time?" } });
		const service = _Service(started);
		vi.mocked(service.answer).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(advanced);
		const store = await _Store(service);
		store.updateDraft("  Keep this answer  ");

		await store.answer(1, "  Keep this answer  ");
		const firstCommand = vi.mocked(service.answer).mock.calls[0][0];
		expect(store.draftAnswer()).toBe("  Keep this answer  ");

		await store.retry();
		const retriedCommand = vi.mocked(service.answer).mock.calls[1][0];
		expect(retriedCommand).toEqual(firstCommand);
		expect(store.chat.value()).toBe(advanced);
		expect(store.draftAnswer()).toBe("");
	});

	it("admits only one answer command and adopts an authoritative conflict without stale draft state", async function _SingleFlightConflict()
	{
		const started = _Snapshot();
		const advanced = _Snapshot({ answerCount: 1, currentQuestion: { ordinal: 2, text: "What wastes time?" } });
		let rejectAnswer: ((reason: unknown) => void) | null = null;
		const heldAnswer = new Promise<PersonaFirstChatSnapshot>(function _Hold(_resolve, reject) { rejectAnswer = reject; });
		const service = _Service(started);
		vi.mocked(service.answer).mockReturnValue(heldAnswer);
		const store = await _Store(service);
		store.updateDraft("Stale answer");

		const first = store.answer(1, "Stale answer");
		const duplicate = store.answer(1, "Stale answer");
		expect(service.answer).toHaveBeenCalledTimes(1);
		expect(store.phase()).toBe(PersonaFirstChatCommandPhases.Answering);
		if (rejectAnswer === null) throw new Error("answer rejection was not captured");
		rejectAnswer(new PersonaFirstChatConflictError(advanced));
		await Promise.all([first, duplicate]);

		expect(store.chat.value()).toBe(advanced);
		expect(store.draftAnswer()).toBe("");
		expect(store.actionError()).toContain("advanced elsewhere");
		expect(store.phase()).toBe(PersonaFirstChatCommandPhases.Idle);
	});

	it("retains concludable evidence after failure and adopts completion only from an explicit retry", async function _ConclusionRetry()
	{
		const ready = _Snapshot({ answerCount: 3, currentQuestion: null, canConclude: true });
		const completed = _Snapshot({ state: UserOnboardingRouteStates.Completed, answerCount: 3, currentQuestion: null, canConclude: false, completedAt: "2026-08-08T11:00:00.000Z" });
		const service = _Service(ready);
		vi.mocked(service.conclude).mockRejectedValueOnce(new Error("runtime unavailable")).mockResolvedValueOnce(completed);

		const store = await _Store(service);
		expect(store.chat.value()).toBe(ready);
		expect(store.actionError()).toBe("runtime unavailable");

		await store.retry();
		expect(service.conclude).toHaveBeenCalledTimes(2);
		expect(store.chat.value()).toBe(completed);
	});

	it("mints a new key when the owner replaces a failed answer intent", async function _NewAnswerKey()
	{
		const started = _Snapshot();
		const service = _Service(started);
		vi.mocked(service.answer).mockRejectedValue(new Error("offline"));
		const store = await _Store(service);

		await store.answer(1, "First answer");
		await store.answer(1, "Replacement answer");

		const first = vi.mocked(service.answer).mock.calls[0][0];
		const replacement = vi.mocked(service.answer).mock.calls[1][0];
		expect(replacement.idempotencyKey).not.toBe(first.idempotencyKey);
		expect(replacement.text).toBe("Replacement answer");
	});
});
