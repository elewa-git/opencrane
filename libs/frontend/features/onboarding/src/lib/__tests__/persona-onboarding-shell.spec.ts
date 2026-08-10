import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CUSTOM_ELEMENTS_SCHEMA, Component, input, output, signal, ɵresolveComponentResources as resolveComponentResources } from "@angular/core";
import { TestBed, type ComponentFixture } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { By } from "@angular/platform-browser";
import { Router } from "@angular/router";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { PersonaColours, PersonaFirstChatArchetypes, PersonaFirstChatColours, PersonaFirstChatCommandPhases, PersonaFirstChatService, PersonaFirstChatSnapshot, PersonaFirstChatStore, PersonaModifiers, PersonaOnboardingService, PersonaOnboardingSnapshot, PersonaOnboardingStates, PersonaOnboardingStore, PersonaResolutionKinds, UserOnboardingRouteSnapshot, UserOnboardingRouteStates } from "@opencrane/state/onboarding";

import { PersonaFirstChatPageComponent } from "../chat/persona-first-chat-page.component";
import { PersonaOnboardingPageComponent } from "../persona-onboarding-page.component";
import type { PersonaAnswerIntent, PersonaApprovalIntent, PersonaResolutionIntent } from "../persona-onboarding-state.types";

/** Exhaustive template contract for every durable state owned by the shell. */
const _STATE_TEMPLATE_CASES: Readonly<Record<PersonaOnboardingStates, string>> = {
	[PersonaOnboardingStates.Interview]: "wo-persona-interview-state",
	[PersonaOnboardingStates.Resolution]: "wo-persona-resolution-state",
	[PersonaOnboardingStates.Review]: "wo-persona-review-state",
	[PersonaOnboardingStates.Ready]: "wo-persona-ready-state"
};

/** Real routed template compiled by the shallow fixture instead of inspected as source text. */
const _SHELL_TEMPLATE = readFileSync(join(process.cwd(), "src/lib/persona-onboarding-page.component.html"), "utf8");

/** Test-only interview state boundary used to execute the real shell template. */
@Component({ selector: "wo-persona-interview-state", standalone: true, template: "", host: { "data-test-stub": "interview" } })
class _PersonaInterviewStateStubComponent
{
	public readonly snapshot = input.required<PersonaOnboardingSnapshot>();
	public readonly busy = input.required<boolean>();
	public readonly actionError = input.required<string | null>();
	public readonly startRequested = output<void>();
	public readonly answerSubmitted = output<PersonaAnswerIntent>();
}

/** Test-only resolution state boundary used to execute the real shell template. */
@Component({ selector: "wo-persona-resolution-state", standalone: true, template: "", host: { "data-test-stub": "resolution" } })
class _PersonaResolutionStateStubComponent
{
	public readonly snapshot = input.required<PersonaOnboardingSnapshot>();
	public readonly busy = input.required<boolean>();
	public readonly actionError = input.required<string | null>();
	public readonly retryRequested = output<void>();
	public readonly resolutionSubmitted = output<PersonaResolutionIntent>();
}

/** Test-only review state boundary used to execute the real shell template. */
@Component({ selector: "wo-persona-review-state", standalone: true, template: "", host: { "data-test-stub": "review" } })
class _PersonaReviewStateStubComponent
{
	public readonly snapshot = input.required<PersonaOnboardingSnapshot>();
	public readonly busy = input.required<boolean>();
	public readonly actionError = input.required<string | null>();
	public readonly retryRequested = output<void>();
	public readonly draftRequested = output<void>();
	public readonly restartRequested = output<void>();
	public readonly approvalRequested = output<PersonaApprovalIntent>();
}

/** Test-only ready state boundary used to execute the real shell template. */
@Component({ selector: "wo-persona-ready-state", standalone: true, template: "", host: { "data-test-stub": "ready" } })
class _PersonaReadyStateStubComponent
{
	public readonly snapshot = input.required<PersonaOnboardingSnapshot>();
	public readonly actionError = input.required<string | null>();
	public readonly retryRequested = output<void>();
}

/** Controlled route-state loader shared by routed shell fixtures. */
let _loadRouteState: ReturnType<typeof vi.fn>;

/** Controlled router transition shared by routed shell fixtures. */
let _navigateByUrl: ReturnType<typeof vi.fn>;

/** Build one complete authority projection for state-component orchestration tests. */
function _Snapshot(overrides: Partial<PersonaOnboardingSnapshot> = {}): PersonaOnboardingSnapshot
{
	return {
		state: PersonaOnboardingStates.Interview,
		interviewId: "interview-1",
		answeredQuestionCount: 0,
		questionCount: 1,
		personaRevisionId: null,
		questions: [{ id: "q1", category: "pace", prompt: "Choose a pace", ordinal: 1, choices: [{ id: "fast", label: "Move directly", ordinal: 1 }], selectedChoiceId: null }],
		resolution: null,
		result: null,
		...overrides
	};
}

/** Build the immutable reviewed result shown before and after explicit activation. */
function _ReviewSnapshot(personaRevisionId: string, state: PersonaOnboardingStates = PersonaOnboardingStates.Review): PersonaOnboardingSnapshot
{
	return _Snapshot({
		state,
		answeredQuestionCount: 1,
		personaRevisionId,
		questions: [{ id: "q1", category: "pace", prompt: "Choose a pace", ordinal: 1, choices: [{ id: "fast", label: "Move directly", ordinal: 1 }], selectedChoiceId: "fast" }],
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

/** Build one complete public onboarding route projection. */
function _RouteSnapshot(state: UserOnboardingRouteStates): UserOnboardingRouteSnapshot
{
	return {
		workflowVersion: 1,
		state,
		personaInterviewId: "interview-1",
		personaRevisionId: state === UserOnboardingRouteStates.SurveyPending || state === UserOnboardingRouteStates.SurveyInProgress ? null : "revision-1",
		bootstrapConversationId: state === UserOnboardingRouteStates.BootstrapChatInProgress || state === UserOnboardingRouteStates.Completed ? "conversation-1" : null,
		startedAt: "2026-08-08T09:00:00.000Z",
		updatedAt: "2026-08-08T10:00:00.000Z",
		completedAt: state === UserOnboardingRouteStates.Completed ? "2026-08-08T11:00:00.000Z" : null
	};
}

/** Build one complete first-chat projection for canonical route tests. */
function _ChatSnapshot(state: UserOnboardingRouteStates): PersonaFirstChatSnapshot
{
	return {
		workflowVersion: 1,
		state,
		conversationId: null,
		persona: null,
		contentRevision: null,
		transcript: [],
		currentQuestion: null,
		answerCount: 0,
		questionCount: 0,
		canConclude: false,
		startedAt: null,
		completedAt: null
	};
}

/** Build the minimal component-scoped first-chat store used by canonical route tests. */
function _FirstChatStore(snapshot: PersonaFirstChatSnapshot): PersonaFirstChatStore
{
	return {
		chat: { hasValue: function _HasValue() { return true; }, isLoading: function _IsLoading() { return false; }, value: function _Value() { return snapshot; } },
		draftAnswer: signal(""),
		actionError: signal<string | null>(null),
		phase: signal(PersonaFirstChatCommandPhases.Idle).asReadonly(),
		enter: vi.fn().mockResolvedValue(undefined),
		answer: vi.fn().mockResolvedValue(undefined),
		updateDraft: vi.fn(),
		retry: vi.fn().mockResolvedValue(undefined)
	} as unknown as PersonaFirstChatStore;
}

/** Build valid state evidence for every durable shell case. */
function _StateSnapshot(state: PersonaOnboardingStates): PersonaOnboardingSnapshot
{
	switch (state)
	{
		case PersonaOnboardingStates.Interview: return _Snapshot();
		case PersonaOnboardingStates.Resolution:
			return _Snapshot({
				state,
				answeredQuestionCount: 1,
				questions: [{ ..._Snapshot().questions[0], selectedChoiceId: "fast" }],
				resolution: { kind: PersonaResolutionKinds.Primary, candidates: [PersonaColours.Red, PersonaColours.Blue] }
			});
		case PersonaOnboardingStates.Review: return _ReviewSnapshot("revision-1");
		case PersonaOnboardingStates.Ready: return _ReviewSnapshot("revision-1", PersonaOnboardingStates.Ready);
	}
}

/** Build the minimal service double consumed by the routed shell. */
function _Service(snapshot: PersonaOnboardingSnapshot): PersonaOnboardingService
{
	return {
		read: vi.fn().mockResolvedValue(snapshot),
		start: vi.fn(),
		answer: vi.fn(),
		complete: vi.fn(),
		resolve: vi.fn(),
		ensureDraft: vi.fn(),
		approve: vi.fn(),
		restart: vi.fn()
	} as unknown as PersonaOnboardingService;
}

/** Create the real shell template against test-only state boundaries and a controlled service. */
function _CreateShellFixture(service: PersonaOnboardingService): ComponentFixture<PersonaOnboardingPageComponent>
{
	TestBed.overrideComponent(PersonaOnboardingPageComponent,
	{
		set:
		{
			templateUrl: undefined,
			template: _SHELL_TEMPLATE,
			styleUrl: undefined,
			styleUrls: [],
			styles: [],
			imports: [_PersonaInterviewStateStubComponent, _PersonaReadyStateStubComponent, _PersonaResolutionStateStubComponent, _PersonaReviewStateStubComponent],
			schemas: [CUSTOM_ELEMENTS_SCHEMA]
		}
	});
	TestBed.configureTestingModule({ imports: [PersonaOnboardingPageComponent], providers: [{ provide: PersonaOnboardingService, useValue: service }] });
	return TestBed.createComponent(PersonaOnboardingPageComponent);
}

/** Render the real shell template after its authoritative initial projection resolves. */
async function _RenderShell(snapshot: PersonaOnboardingSnapshot, service: PersonaOnboardingService = _Service(snapshot)): Promise<ComponentFixture<PersonaOnboardingPageComponent>>
{
	const fixture = _CreateShellFixture(service);
	await vi.waitFor(function _Loaded() { expect(fixture.componentInstance.onboarding.hasValue()).toBe(true); });
	fixture.detectChanges();
	return fixture;
}

beforeAll(async function _InitializeAngularTesting()
{
	TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
	await resolveComponentResources(async function _ResolveComponentResource(url)
	{
		return url.endsWith("persona-onboarding-page.component.html") ? _SHELL_TEMPLATE : "";
	});
});

afterAll(function _ResetAngularTesting()
{
	TestBed.resetTestEnvironment();
});

beforeEach(function _ConfigureRouteAuthorities()
{
	_loadRouteState = vi.fn().mockResolvedValue(_RouteSnapshot(UserOnboardingRouteStates.SurveyInProgress));
	_navigateByUrl = vi.fn().mockResolvedValue(true);
	TestBed.configureTestingModule({ providers: [
		{ provide: PersonaFirstChatService, useValue: { loadRouteState: _loadRouteState } },
		{ provide: Router, useValue: { navigateByUrl: _navigateByUrl } }
	] });
});

afterEach(function _ResetTestBed()
{
	TestBed.resetTestingModule();
});

describe("persona onboarding shell orchestration", function _PersonaOnboardingShellSuite()
{
	it("renders the routed loading envelope while the authoritative read is pending", function _LoadingEnvelope()
	{
		const service = _Service(_Snapshot());
		vi.mocked(service.read).mockReturnValue(new Promise<PersonaOnboardingSnapshot>(function _Pending() {}));
		const fixture = _CreateShellFixture(service);

		fixture.detectChanges();

		expect(fixture.nativeElement.textContent).toContain("Checking your onboarding position");
		expect(fixture.nativeElement.querySelector("[role='status']")).not.toBeNull();
	});

	it("renders a blocking load error and retries the authoritative read", async function _LoadErrorRetry()
	{
		const snapshot = _Snapshot();
		const service = _Service(snapshot);
		vi.mocked(service.read).mockRejectedValueOnce(new Error("temporarily unavailable")).mockResolvedValueOnce(snapshot);
		const fixture = _CreateShellFixture(service);
		await vi.waitFor(function _Failed() { expect(fixture.componentInstance.onboarding.error()).not.toBeUndefined(); });
		fixture.detectChanges();

		expect(fixture.nativeElement.textContent).toContain("The persona authority is unavailable");
		expect(fixture.nativeElement.textContent).toContain("Retry");

		fixture.componentInstance.retry();

		await vi.waitFor(function _Loaded() { expect(fixture.componentInstance.onboarding.hasValue()).toBe(true); });
		expect(service.read).toHaveBeenCalledTimes(2);
	});

	it.each(Object.values(PersonaOnboardingStates))("routes %s through exactly one rendered state component", async function _RoutesState(state)
	{
		const fixture = await _RenderShell(_StateSnapshot(state));
		for (const [candidate, selector] of Object.entries(_STATE_TEMPLATE_CASES))
		{
			const expectedCount = candidate === state ? 1 : 0;
			expect(fixture.nativeElement.querySelectorAll(selector)).toHaveLength(expectedCount);
		}
	});

	it("routes a rendered resolution intent to the confirmed review state", async function _ResolutionToReview()
	{
		const initial = _StateSnapshot(PersonaOnboardingStates.Resolution);
		const review = _ReviewSnapshot("revision-1");
		const service = _Service(initial);
		vi.mocked(service.resolve).mockResolvedValue(review);
		const fixture = await _RenderShell(initial, service);
		const state = fixture.debugElement.query(By.directive(_PersonaResolutionStateStubComponent));

		state.triggerEventHandler("resolutionSubmitted", { interviewId: "interview-1", kind: PersonaResolutionKinds.Primary, selectedValue: PersonaColours.Red });

		await vi.waitFor(function _Resolved() { expect(fixture.componentInstance.onboarding.value()).toBe(review); });
		fixture.detectChanges();
		expect(service.resolve).toHaveBeenCalledWith("interview-1", PersonaResolutionKinds.Primary, PersonaColours.Red);
		expect(fixture.nativeElement.querySelectorAll("wo-persona-review-state")).toHaveLength(1);
	});

	it("routes a rendered approval intent to the confirmed ready state", async function _ReviewToReady()
	{
		const review = _ReviewSnapshot("revision-1");
		const ready = _ReviewSnapshot("revision-1", PersonaOnboardingStates.Ready);
		const service = _Service(review);
		vi.mocked(service.approve).mockResolvedValue(ready);
		_loadRouteState.mockResolvedValue(_RouteSnapshot(UserOnboardingRouteStates.BootstrapChatPending));
		const fixture = await _RenderShell(review, service);
		const state = fixture.debugElement.query(By.directive(_PersonaReviewStateStubComponent));

		state.triggerEventHandler("approvalRequested", { personaRevisionId: "revision-1", instructionPreview: "Lead with a direct recommendation." });

		await vi.waitFor(function _Approved() { expect(fixture.componentInstance.onboarding.value()).toBe(ready); });
		fixture.detectChanges();
		expect(service.approve).toHaveBeenCalledWith("revision-1");
		expect(fixture.nativeElement.querySelectorAll("wo-persona-ready-state")).toHaveLength(1);
		await vi.waitFor(function _Routed() { expect(_navigateByUrl).toHaveBeenCalledWith("/onboarding/chat"); });
	});

	it("retries ready-route resolution through the component-scoped store", async function _RetryReadyRoute()
	{
		const ready = _ReviewSnapshot("revision-1", PersonaOnboardingStates.Ready);
		_loadRouteState
			.mockRejectedValueOnce(new Error("temporary route failure"))
			.mockResolvedValueOnce(_RouteSnapshot(UserOnboardingRouteStates.BootstrapChatPending));
		const fixture = await _RenderShell(ready);

		await vi.waitFor(function _Failed() { expect(fixture.componentInstance.actionError()).toContain("could not resolve"); });
		expect(_loadRouteState).toHaveBeenCalledTimes(1);

		fixture.componentInstance.retry();

		await vi.waitFor(function _Routed() { expect(_navigateByUrl).toHaveBeenCalledWith("/onboarding/chat"); });
		expect(_loadRouteState).toHaveBeenCalledTimes(2);
	});

	it("replays the exact approval once when persona activation outlives its workflow transition", async function _RecoverApprovalTransition()
	{
		const review = _ReviewSnapshot("revision-1");
		const ready = _ReviewSnapshot("revision-1", PersonaOnboardingStates.Ready);
		const service = _Service(review);
		vi.mocked(service.read).mockResolvedValueOnce(review).mockResolvedValueOnce(ready);
		vi.mocked(service.approve).mockRejectedValueOnce(new Error("Onboarding workflow is temporarily unavailable.")).mockResolvedValueOnce(ready);
		_loadRouteState
			.mockResolvedValueOnce(_RouteSnapshot(UserOnboardingRouteStates.SurveyInProgress))
			.mockResolvedValueOnce(_RouteSnapshot(UserOnboardingRouteStates.BootstrapChatPending));
		const fixture = await _RenderShell(review, service);

		await fixture.componentInstance.approve({ personaRevisionId: "revision-1", instructionPreview: "Lead with a direct recommendation." });

		expect(fixture.componentInstance.onboarding.value()).toBe(ready);
		await vi.waitFor(function _UnresolvedSurveyRoute() { expect(_loadRouteState).toHaveBeenCalledTimes(1); });
		expect(_navigateByUrl).not.toHaveBeenCalled();

		fixture.componentInstance.retry();

		await vi.waitFor(function _RecoveredRoute() { expect(_navigateByUrl).toHaveBeenCalledWith("/onboarding/chat"); });
		expect(service.approve).toHaveBeenCalledTimes(2);
		expect(service.approve).toHaveBeenNthCalledWith(1, "revision-1");
		expect(service.approve).toHaveBeenNthCalledWith(2, "revision-1");
		expect(_loadRouteState).toHaveBeenCalledTimes(2);
	});

	it("admits only one ready-route read while the component-scoped store has one in flight", async function _SingleReadyRouteRead()
	{
		let finish: ((snapshot: UserOnboardingRouteSnapshot) => void) | undefined;
		const pending = new Promise<UserOnboardingRouteSnapshot>(function _Pending(resolve) { finish = resolve; });
		const ready = _ReviewSnapshot("revision-1", PersonaOnboardingStates.Ready);
		_loadRouteState.mockReturnValue(pending);
		const fixture = await _RenderShell(ready);
		await vi.waitFor(function _Reading() { expect(_loadRouteState).toHaveBeenCalledTimes(1); });

		fixture.componentInstance.retry();
		expect(_loadRouteState).toHaveBeenCalledTimes(1);

		finish?.(_RouteSnapshot(UserOnboardingRouteStates.BootstrapChatPending));
		await vi.waitFor(function _Routed() { expect(_navigateByUrl).toHaveBeenCalledWith("/onboarding/chat"); });
	});

	it("saves the final answer and adopts the confirmed review state", async function _SurveyCompletion()
	{
		const initial = _Snapshot();
		const answered = _Snapshot({ answeredQuestionCount: 1, questions: [{ ...initial.questions[0], selectedChoiceId: "fast" }] });
		const review = _ReviewSnapshot("revision-1");
		const service = _Service(initial);
		vi.mocked(service.answer).mockResolvedValue(answered);
		vi.mocked(service.complete).mockResolvedValue(review);
		TestBed.configureTestingModule({ providers: [PersonaOnboardingStore, { provide: PersonaOnboardingService, useValue: service }] });
		const component = TestBed.runInInjectionContext(function _CreateShell() { return new PersonaOnboardingPageComponent(); });
		await vi.waitFor(function _Loaded() { expect(component.onboarding.hasValue()).toBe(true); });

		await component.answer({ interviewId: "interview-1", questionId: "q1", choiceId: "fast" });

		expect(service.answer).toHaveBeenCalledWith("interview-1", "q1", "fast");
		expect(service.complete).toHaveBeenCalledWith("interview-1");
		expect(component.onboarding.value()).toBe(review);
	});

	it("guards duplicate command admission before the first authority await", async function _SingleFlight()
	{
		let finish: ((snapshot: PersonaOnboardingSnapshot) => void) | undefined;
		const pending = new Promise<PersonaOnboardingSnapshot>(function _Pending(resolve) { finish = resolve; });
		const initial = _Snapshot({ interviewId: null });
		const service = _Service(initial);
		vi.mocked(service.start).mockReturnValue(pending);
		TestBed.configureTestingModule({ providers: [PersonaOnboardingStore, { provide: PersonaOnboardingService, useValue: service }] });
		const component = TestBed.runInInjectionContext(function _CreateShell() { return new PersonaOnboardingPageComponent(); });
		await vi.waitFor(function _Loaded() { expect(component.onboarding.hasValue()).toBe(true); });

		const first = component.start();
		const duplicate = component.start();
		expect(service.start).toHaveBeenCalledTimes(1);
		finish?.(_Snapshot());
		await Promise.all([first, duplicate]);
	});

	it("reconciles authority state instead of replaying an uncertain command", async function _CommandReconciliation()
	{
		const initial = _Snapshot();
		const reconciled = _ReviewSnapshot("revision-1");
		const service = _Service(initial);
		vi.mocked(service.read).mockResolvedValueOnce(initial).mockResolvedValueOnce(reconciled);
		vi.mocked(service.answer).mockRejectedValue(new Error("The answer may already be saved."));
		TestBed.configureTestingModule({ providers: [PersonaOnboardingStore, { provide: PersonaOnboardingService, useValue: service }] });
		const component = TestBed.runInInjectionContext(function _CreateShell() { return new PersonaOnboardingPageComponent(); });
		await vi.waitFor(function _Loaded() { expect(component.onboarding.hasValue()).toBe(true); });

		await component.answer({ interviewId: "interview-1", questionId: "q1", choiceId: "fast" });

		expect(service.answer).toHaveBeenCalledTimes(1);
		expect(service.read).toHaveBeenCalledTimes(2);
		expect(component.onboarding.value()).toBe(reconciled);
	});

	it("revalidates immutable review material before calling the approval authority", async function _ApprovalFence()
	{
		const review = _ReviewSnapshot("revision-1");
		const service = _Service(review);
		TestBed.configureTestingModule({ providers: [PersonaOnboardingStore, { provide: PersonaOnboardingService, useValue: service }] });
		const component = TestBed.runInInjectionContext(function _CreateShell() { return new PersonaOnboardingPageComponent(); });
		await vi.waitFor(function _Loaded() { expect(component.onboarding.hasValue()).toBe(true); });

		await component.approve({ personaRevisionId: "revision-2", instructionPreview: "Lead with a direct recommendation." });

		expect(service.approve).not.toHaveBeenCalled();
		expect(component.actionError()).toContain("changed before approval");
	});

	it.each([UserOnboardingRouteStates.SurveyPending, UserOnboardingRouteStates.SurveyInProgress])("routes first-chat state %s to the canonical onboarding shell", async function _CanonicalOnboardingRoute(state)
	{
		TestBed.configureTestingModule({ providers: [{ provide: PersonaFirstChatStore, useValue: _FirstChatStore(_ChatSnapshot(state)) }] });
		const component = TestBed.runInInjectionContext(function _CreateFirstChat() { return new PersonaFirstChatPageComponent(); });
		TestBed.flushEffects();

		expect(_navigateByUrl).toHaveBeenCalledWith("/onboarding");
	});

});
