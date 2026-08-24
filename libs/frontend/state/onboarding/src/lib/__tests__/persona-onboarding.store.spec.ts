// @vitest-environment jsdom

import { TestBed } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { UserOnboardingRouteStates } from "@opencrane/models/user-onboarding";

import { PersonaColours, PersonaModifiers, PersonaOnboardingStates, type PersonaOnboardingSnapshot } from "@opencrane/models/user-onboarding";
import { PersonaFirstChatService } from "../persona-first-chat.service";
import type { UserOnboardingRouteSnapshot } from "../persona-first-chat.types";
import { PersonaOnboardingService } from "../persona-onboarding.service";
import { PersonaOnboardingStore } from "../persona-onboarding.store";

/** Build one complete authoritative persona projection for store tests. */
function _Snapshot(overrides: Partial<PersonaOnboardingSnapshot> = {}): PersonaOnboardingSnapshot
{
	return {
		state: PersonaOnboardingStates.Interview,
		interviewId: "interview-1",
		answeredQuestionCount: 0,
		questionCount: 10,
		personaRevisionId: null,
		questions: [],
		resolution: null,
		result: null,
		...overrides
	};
}

/** Build immutable review evidence accepted by the approval fence. */
function _Review(state: PersonaOnboardingStates.Review | PersonaOnboardingStates.Ready = PersonaOnboardingStates.Review, personaRevisionId = "revision-1"): PersonaOnboardingSnapshot
{
	return _Snapshot({
		state,
		personaRevisionId,
		result: {
			displayName: "The Commander",
			primaryColour: PersonaColours.Red,
			secondaryColour: PersonaColours.Blue,
			modifier: PersonaModifiers.Explorer,
			colourScores: { red: 3, yellow: 0, green: 0, blue: 1, total: 4 },
			opennessScores: { explorer: 1, guardian: 0, total: 1 },
			insights: ["You prefer direct recommendations."],
			instructionPreview: "Lead with a direct recommendation."
		}
	});
}

/** Build one complete durable route projection. */
function _Route(state: UserOnboardingRouteStates): UserOnboardingRouteSnapshot
{
	return {
		workflowVersion: 1,
		state,
		personaInterviewId: "interview-1",
		personaRevisionId: state === UserOnboardingRouteStates.SurveyInProgress ? null : "revision-1",
		bootstrapConversationId: null,
		startedAt: "2026-08-08T09:00:00.000Z",
		updatedAt: "2026-08-08T10:00:00.000Z",
		completedAt: null
	};
}

/** Build the narrow persona application-service double owned by the store. */
function _PersonaService(): PersonaOnboardingService
{
	return {
		read: vi.fn(), start: vi.fn(), answer: vi.fn(), complete: vi.fn(), resolve: vi.fn(), ensureDraft: vi.fn(), approve: vi.fn(), restart: vi.fn()
	} as unknown as PersonaOnboardingService;
}

beforeAll(function _InitializeAngularTesting()
{
	TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
});

afterAll(function _ResetAngularTesting()
{
	TestBed.resetTestEnvironment();
});

describe("PersonaOnboardingStore", function _PersonaOnboardingStoreSuite()
{
	/** Persona authority service double. */
	let persona: PersonaOnboardingService;

	/** Post-persona route reader. */
	let loadRouteState: ReturnType<typeof vi.fn>;

	beforeEach(function _Configure()
	{
		persona = _PersonaService();
		loadRouteState = vi.fn();
		TestBed.configureTestingModule({ providers: [
			PersonaOnboardingStore,
			{ provide: PersonaOnboardingService, useValue: persona },
			{ provide: PersonaFirstChatService, useValue: { loadRouteState } }
		] });
	});

	afterEach(function _Reset()
	{
		TestBed.resetTestingModule();
	});

	/** Create the store after configuring its initial authoritative read. */
	async function _CreateStore(initial: PersonaOnboardingSnapshot): Promise<PersonaOnboardingStore>
	{
		vi.mocked(persona.read).mockResolvedValueOnce(initial);
		const store = TestBed.inject(PersonaOnboardingStore);
		await vi.waitFor(function _Loaded() { expect(store.onboarding.hasValue()).toBe(true); });
		return store;
	}

	it("admits one persona command while its first authority call remains active", async function _CommandSingleFlight()
	{
		let finish: ((snapshot: PersonaOnboardingSnapshot) => void) | undefined;
		const pending = new Promise<PersonaOnboardingSnapshot>(function _Pending(resolve) { finish = resolve; });
		vi.mocked(persona.start).mockReturnValue(pending);
		const store = await _CreateStore(_Snapshot({ interviewId: null }));

		const first = store.start();
		const duplicate = store.start();

		expect(persona.start).toHaveBeenCalledTimes(1);
		finish?.(_Snapshot());
		await Promise.all([first, duplicate]);
	});

	it("reconciles an uncertain command result from authority instead of replaying the write", async function _FailureReconciliation()
	{
		const reconciled = _Review();
		vi.mocked(persona.answer).mockRejectedValue(new Error("The answer may already be saved."));
		const store = await _CreateStore(_Snapshot());
		vi.mocked(persona.read).mockResolvedValueOnce(reconciled);

		await store.answer("interview-1", "q1", "fast");

		expect(persona.answer).toHaveBeenCalledTimes(1);
		expect(persona.read).toHaveBeenCalledTimes(2);
		expect(store.onboarding.value()).toBe(reconciled);
	});

	it("retries a failed ready-route read while preserving single-flight admission", async function _ReadyRouteRetry()
	{
		loadRouteState.mockRejectedValueOnce(new Error("temporarily unavailable"));
		const store = await _CreateStore(_Review(PersonaOnboardingStates.Ready));
		await store.resolveReadyRoute();
		expect(store.actionError()).toContain("could not resolve");

		let finish: ((snapshot: UserOnboardingRouteSnapshot) => void) | undefined;
		loadRouteState.mockReturnValue(new Promise<UserOnboardingRouteSnapshot>(function _Pending(resolve) { finish = resolve; }));
		const first = store.resolveReadyRoute();
		const duplicate = store.resolveReadyRoute();

		expect(loadRouteState).toHaveBeenCalledTimes(2);
		finish?.(_Route(UserOnboardingRouteStates.BootstrapChatPending));
		await Promise.all([first, duplicate]);
		expect(store.readyRoute()?.state).toBe(UserOnboardingRouteStates.BootstrapChatPending);
	});

	it("replays the exact uncertain approval before resolving a post-survey route", async function _ApprovalRecovery()
	{
		const ready = _Review(PersonaOnboardingStates.Ready);
		vi.mocked(persona.approve).mockRejectedValueOnce(new Error("Workflow unavailable.")).mockResolvedValueOnce(ready);
		const store = await _CreateStore(_Review());
		vi.mocked(persona.read).mockResolvedValueOnce(ready);
		loadRouteState.mockResolvedValueOnce(_Route(UserOnboardingRouteStates.SurveyInProgress)).mockResolvedValueOnce(_Route(UserOnboardingRouteStates.BootstrapChatPending));

		await store.approve("revision-1", "Lead with a direct recommendation.");
		await store.resolveReadyRoute();
		expect(store.readyRoute()).toBeNull();

		await store.retryReadyRoute();

		expect(persona.approve).toHaveBeenNthCalledWith(1, "revision-1");
		expect(persona.approve).toHaveBeenNthCalledWith(2, "revision-1");
		expect(store.readyRoute()?.state).toBe(UserOnboardingRouteStates.BootstrapChatPending);
	});

	it("drops a stale approval retry when reconciliation adopts a different active revision", async function _DifferentWinner()
	{
		const winner = _Review(PersonaOnboardingStates.Ready, "revision-2");
		vi.mocked(persona.approve).mockRejectedValue(new Error("Approval result is uncertain."));
		const store = await _CreateStore(_Review());
		vi.mocked(persona.read).mockResolvedValueOnce(winner);
		loadRouteState.mockRejectedValueOnce(new Error("Route temporarily unavailable.")).mockResolvedValueOnce(_Route(UserOnboardingRouteStates.BootstrapChatPending));

		await store.approve("revision-1", "Lead with a direct recommendation.");
		await store.resolveReadyRoute();
		await store.retryReadyRoute();

		expect(persona.approve).toHaveBeenCalledTimes(1);
		expect(store.onboarding.value()).toBe(winner);
		expect(store.readyRoute()?.state).toBe(UserOnboardingRouteStates.BootstrapChatPending);
	});

	it("drops a stale approval retry after reload adopts a different active revision", async function _ReloadedWinner()
	{
		const reviewWinner = _Review(PersonaOnboardingStates.Review, "revision-2");
		const readyWinner = _Review(PersonaOnboardingStates.Ready, "revision-2");
		vi.mocked(persona.approve).mockRejectedValue(new Error("Approval result is uncertain."));
		const store = await _CreateStore(_Review());
		vi.mocked(persona.read).mockResolvedValueOnce(reviewWinner).mockResolvedValueOnce(readyWinner);
		loadRouteState.mockRejectedValueOnce(new Error("Route temporarily unavailable.")).mockResolvedValueOnce(_Route(UserOnboardingRouteStates.BootstrapChatPending));

		await store.approve("revision-1", "Lead with a direct recommendation.");
		store.retry();
		await vi.waitFor(function _WinnerReady() { expect(store.onboarding.value()).toBe(readyWinner); });
		await store.resolveReadyRoute();
		await store.retryReadyRoute();

		expect(persona.approve).toHaveBeenCalledTimes(1);
		expect(store.readyRoute()?.state).toBe(UserOnboardingRouteStates.BootstrapChatPending);
	});
});
