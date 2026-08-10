import { type WritableSignal, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { Router } from "@angular/router";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { PersonaFirstChatArchetypes, PersonaFirstChatColours, PersonaFirstChatCommandPhases, PersonaFirstChatStore, type PersonaFirstChatSnapshot, PersonaFirstChatTranscriptKinds, PersonaFirstChatTranscriptRoles, UserOnboardingRouteStates } from "@opencrane/state/onboarding";

import { PersonaFirstChatPageComponent } from "../persona-first-chat-page.component.js";
import { PersonaFirstChatStates } from "../persona-first-chat.types.js";

/** Controlled authoritative projection shared by the route-shell store double. */
let _snapshot: WritableSignal<PersonaFirstChatSnapshot>;

/** Controlled resource loading state used to prove retained-value reconnection presentation. */
let _loading: WritableSignal<boolean>;

/** Whether the store double currently exposes an authoritative projection. */
let _hasValue: WritableSignal<boolean>;

/** Controlled command phase used to prove accurate entry and mutation presentation. */
let _phase: WritableSignal<PersonaFirstChatCommandPhases>;

/** Controlled router transition proving that the page effect has no product-state authority. */
let _navigateByUrl: ReturnType<typeof vi.fn>;

/** Explicit command spies exposed by the component-scoped store double. */
let _enter: ReturnType<typeof vi.fn>;
let _answer: ReturnType<typeof vi.fn>;

/** Build one complete first-chat authority projection for route-shell tests. */
function _Snapshot(state: UserOnboardingRouteStates = UserOnboardingRouteStates.BootstrapChatInProgress): PersonaFirstChatSnapshot
{
	return {
		workflowVersion: 1,
		state,
		conversationId: "conversation-1",
		persona: { revisionId: "persona-revision-1", displayName: "The Commander", archetype: PersonaFirstChatArchetypes.Commander, primaryColour: PersonaFirstChatColours.Red },
		contentRevision: { id: "commander-v1", digest: `sha256:${"a".repeat(64)}`, sourceLabel: "The Commander bootstrap" },
		transcript: [{ ordinal: 1, role: PersonaFirstChatTranscriptRoles.Assistant, kind: PersonaFirstChatTranscriptKinds.Opening, text: "Welcome.", questionOrdinal: null }],
		currentQuestion: { ordinal: 1, text: "What should I protect?" },
		answerCount: 0,
		questionCount: 3,
		canConclude: false,
		startedAt: "2026-08-08T10:00:00.000Z",
		completedAt: state === UserOnboardingRouteStates.Completed ? "2026-08-08T11:00:00.000Z" : null
	};
}

/** Build valid pending evidence with pinned persona and source but no conversation yet. */
function _PendingSnapshot(): PersonaFirstChatSnapshot
{
	return {
		..._Snapshot(UserOnboardingRouteStates.BootstrapChatPending),
		conversationId: null,
		transcript: [],
		currentQuestion: null,
		startedAt: null
	};
}

/** Build a minimal signal-backed store double without duplicating page-owned state. */
function _Store(): PersonaFirstChatStore
{
	const chat = {
		hasValue: function _HasValue() { return _hasValue(); },
		isLoading: function _IsLoading() { return _loading(); },
		value: function _Value() { return _snapshot(); }
	};
	return {
		chat,
		draftAnswer: signal(""),
		actionError: signal<string | null>(null),
		phase: _phase.asReadonly(),
		enter: _enter,
		answer: _answer,
		updateDraft: vi.fn(),
		retry: vi.fn()
	} as unknown as PersonaFirstChatStore;
}

beforeAll(function _InitializeAngularTesting()
{
	TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
});

afterAll(function _ResetAngularTesting()
{
	TestBed.resetTestEnvironment();
});

beforeEach(function _ConfigureRouteShell()
{
	_snapshot = signal(_Snapshot());
	_loading = signal(false);
	_hasValue = signal(true);
	_phase = signal(PersonaFirstChatCommandPhases.Idle);
	_navigateByUrl = vi.fn().mockResolvedValue(true);
	_enter = vi.fn().mockResolvedValue(undefined);
	_answer = vi.fn().mockResolvedValue(undefined);
	TestBed.configureTestingModule({ providers: [
		{ provide: PersonaFirstChatStore, useFactory: _Store },
		{ provide: Router, useValue: { navigateByUrl: _navigateByUrl } }
	] });
});

afterEach(function _ResetTestBed()
{
	TestBed.resetTestingModule();
});

describe("persona first-chat route shell", function _PersonaFirstChatPageSuite()
{
	it("enters explicitly and navigates only when authoritative state changes", async function _RoutesFromAuthority()
	{
		const component = TestBed.runInInjectionContext(function _CreatePage() { return new PersonaFirstChatPageComponent(); });
		TestBed.flushEffects();

		expect(_enter).toHaveBeenCalledTimes(1);
		expect(_navigateByUrl).not.toHaveBeenCalled();

		_snapshot.set(_Snapshot(UserOnboardingRouteStates.SurveyInProgress));
		TestBed.flushEffects();
		expect(_navigateByUrl).toHaveBeenLastCalledWith("/onboarding");

		_snapshot.set(_Snapshot(UserOnboardingRouteStates.Completed));
		TestBed.flushEffects();
		expect(_navigateByUrl).toHaveBeenLastCalledWith("/admin");
	});

	it("delegates only an intent matching the currently rendered question", async function _DelegatesCurrentIntent()
	{
		const component = TestBed.runInInjectionContext(function _CreatePage() { return new PersonaFirstChatPageComponent(); });

		await component.submitAnswer({ questionId: "question-2", answer: "stale" });
		await component.submitAnswer({ questionId: "question-1", answer: "Protect the delivery date." });

		expect(_answer).toHaveBeenCalledTimes(1);
		expect(_answer).toHaveBeenCalledWith(1, "Protect the delivery date.");
	});

	it("distinguishes initial preparation, retained pending entry, and retained-value reload", function _MapsLifecyclePresentation()
	{
		_hasValue.set(false);
		_snapshot.set(_PendingSnapshot());
		_phase.set(PersonaFirstChatCommandPhases.Entering);
		const component = TestBed.runInInjectionContext(function _CreatePage() { return new PersonaFirstChatPageComponent(); });

		expect(component.preparing()).toBe(true);

		_hasValue.set(true);
		expect(component.preparing()).toBe(false);
		expect(component.presentationState()).toBe(PersonaFirstChatStates.Reconnecting);

		_snapshot.set(_Snapshot());
		_phase.set(PersonaFirstChatCommandPhases.Idle);
		_loading.set(true);
		expect(component.preparing()).toBe(false);
		expect(component.presentationState()).toBe(PersonaFirstChatStates.Reconnecting);

		_loading.set(false);
		_phase.set(PersonaFirstChatCommandPhases.Answering);
		expect(component.presentationState()).toBe(PersonaFirstChatStates.Submitting);

		_phase.set(PersonaFirstChatCommandPhases.Concluding);
		expect(component.presentationState()).toBe(PersonaFirstChatStates.Finishing);
	});
});
