import { TestBed } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { Router } from "@angular/router";
import { ConfirmationService } from "primeng/api";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { PERSONA_GATEWAY, PersonaColours, PersonaFirstChatArchetypes, PersonaFirstChatColours, PersonaFirstChatConflictError, PersonaFirstChatService, PersonaFirstChatSnapshot, PersonaFirstChatTranscriptKinds, PersonaFirstChatTranscriptRoles, PersonaGateway, PersonaModifiers, PersonaOnboardingService, PersonaOnboardingSnapshot, PersonaOnboardingStates, PersonaResolutionKinds, UserOnboardingRouteStates } from "@opencrane/state/onboarding";

import { ONBOARDING_ROUTES } from "../onboarding.routes";
import { PersonaFirstChatPageComponent } from "../chat/persona-first-chat-page.component";
import { PersonaReviewPageComponent } from "../review/persona-review-page.component";
import { PersonaSurveyPageComponent } from "../survey/persona-survey-page.component";

/** Build one complete authority projection for routed component orchestration tests. */
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

/** Build the immutable reviewed result shown before explicit activation. */
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

/** Build one resumable first-chat projection for routed page tests. */
function _ChatSnapshot(overrides: Partial<PersonaFirstChatSnapshot> = {}): PersonaFirstChatSnapshot
{
	return {
		workflowVersion: 1,
		state: UserOnboardingRouteStates.BootstrapChatInProgress,
		conversationId: "conversation-1",
		persona: { revisionId: "revision-1", displayName: "The Commander", archetype: PersonaFirstChatArchetypes.Commander, primaryColour: PersonaFirstChatColours.Red },
		contentRevision: { id: "commander-v1", digest: `sha256:${"a".repeat(64)}`, sourceLabel: "Commander bootstrap" },
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

describe("persona onboarding routed components", function _PersonaOnboardingPagesSuite()
{
	it("saves the final answer, completes the interview, and routes from confirmed review state", async function _SurveyCompletion()
	{
		const initial = _Snapshot();
		const answered = _Snapshot({ answeredQuestionCount: 1, questions: [{ ...initial.questions[0], selectedChoiceId: "fast" }] });
		const review = _ReviewSnapshot("revision-1");
		const service = {
			load: vi.fn().mockResolvedValue(initial),
			answer: vi.fn().mockResolvedValue(answered),
			complete: vi.fn().mockResolvedValue(review)
		} as unknown as PersonaOnboardingService;
		const navigateByUrl = vi.fn().mockResolvedValue(true);
		TestBed.configureTestingModule({ providers: [{ provide: PersonaOnboardingService, useValue: service }, { provide: Router, useValue: { navigateByUrl } }] });
		const component = TestBed.runInInjectionContext(function _CreateSurvey() { return new PersonaSurveyPageComponent(); });
		await vi.waitFor(function _Loaded() { expect(component.onboarding.hasValue()).toBe(true); });

		component.select("fast");
		await component.saveAnswer();

		expect(service.answer).toHaveBeenCalledWith("interview-1", "q1", "fast");
		expect(service.complete).toHaveBeenCalledWith("interview-1");
		expect(navigateByUrl).toHaveBeenCalledWith("/onboarding/review");
	});

	it("resolves a tie through page, service, and gateway before navigating to review", async function _TieResolution()
	{
		const unresolved = _Snapshot({
			state: PersonaOnboardingStates.Resolution,
			answeredQuestionCount: 1,
			questions: [{ ..._Snapshot().questions[0], selectedChoiceId: "fast" }],
			resolution: { kind: PersonaResolutionKinds.Primary, candidates: [PersonaColours.Red, PersonaColours.Yellow] }
		});
		const resolved = { ..._ReviewSnapshot("pending"), personaRevisionId: null };
		const review = _ReviewSnapshot("revision-1");
		const gateway = {
			load: vi.fn().mockResolvedValueOnce(unresolved).mockResolvedValueOnce(resolved).mockResolvedValueOnce(review),
			startInterview: vi.fn(),
			recordAnswer: vi.fn(),
			completeInterview: vi.fn(),
			resolve: vi.fn(),
			createDraft: vi.fn(),
			approve: vi.fn()
		} satisfies PersonaGateway;
		const navigateByUrl = vi.fn().mockResolvedValue(true);
		TestBed.configureTestingModule({ providers: [
			PersonaOnboardingService,
			{ provide: PERSONA_GATEWAY, useValue: gateway },
			{ provide: Router, useValue: { navigateByUrl } }
		] });
		const component = TestBed.runInInjectionContext(function _CreateSurvey() { return new PersonaSurveyPageComponent(); });
		await vi.waitFor(function _Loaded() { expect(component.onboarding.hasValue()).toBe(true); });

		component.select(PersonaColours.Red);
		await component.saveResolution();

		expect(gateway.resolve).toHaveBeenCalledWith("interview-1", PersonaResolutionKinds.Primary, PersonaColours.Red);
		expect(gateway.createDraft).toHaveBeenCalledWith("interview-1");
		expect(component.onboarding.value()).toBe(review);
		expect(navigateByUrl).toHaveBeenCalledWith("/onboarding/review");
	});

	it("approves only the exact revision and instruction preview the owner confirmed", async function _ReviewApproval()
	{
		const review = _ReviewSnapshot("revision-1");
		const ready = _ReviewSnapshot("revision-1", PersonaOnboardingStates.Ready);
		const service = { load: vi.fn().mockResolvedValue(review), approve: vi.fn().mockResolvedValue(ready) } as unknown as PersonaOnboardingService;
		const confirm = vi.fn();
		const loadRouteState = vi.fn().mockResolvedValue({ workflowVersion: 1, state: UserOnboardingRouteStates.BootstrapChatPending, personaInterviewId: "interview-1", personaRevisionId: "revision-1", bootstrapConversationId: null, startedAt: "2026-08-08T09:00:00.000Z", updatedAt: "2026-08-08T10:00:00.000Z", completedAt: null });
		const navigateByUrl = vi.fn().mockResolvedValue(true);
		TestBed.configureTestingModule({ providers: [
			{ provide: PersonaOnboardingService, useValue: service },
			{ provide: PersonaFirstChatService, useValue: { loadRouteState } },
			{ provide: Router, useValue: { navigateByUrl } },
			{ provide: ConfirmationService, useValue: { confirm } }
		] });
		const component = TestBed.runInInjectionContext(function _CreateReview() { return new PersonaReviewPageComponent(); });
		await vi.waitFor(function _Loaded() { expect(component.onboarding.hasValue()).toBe(true); });

		component.requestApproval();
		const staleConfirmation = confirm.mock.calls[0]?.[0] as { readonly accept: () => Promise<void> };
		component.onboarding.set(_ReviewSnapshot("revision-2"));
		await staleConfirmation.accept();
		expect(service.approve).not.toHaveBeenCalled();
		expect(component.actionError()).toContain("changed before approval");

		component.onboarding.set(review);
		component.requestApproval();
		const currentConfirmation = confirm.mock.calls[1]?.[0] as { readonly accept: () => Promise<void> };
		await currentConfirmation.accept();
		expect(service.approve).toHaveBeenCalledWith("revision-1");
		expect(component.onboarding.value().state).toBe(PersonaOnboardingStates.Ready);
		expect(loadRouteState).toHaveBeenCalledTimes(1);
		expect(navigateByUrl).toHaveBeenCalledWith("/onboarding/chat");
	});

	it("resumes an already-approved owner from authoritative route state", async function _ReviewResume()
	{
		const ready = _ReviewSnapshot("revision-1", PersonaOnboardingStates.Ready);
		const service = { load: vi.fn().mockResolvedValue(ready), approve: vi.fn() } as unknown as PersonaOnboardingService;
		const loadRouteState = vi.fn().mockResolvedValue({ workflowVersion: 1, state: UserOnboardingRouteStates.BootstrapChatInProgress, personaInterviewId: "interview-1", personaRevisionId: "revision-1", bootstrapConversationId: "conversation-1", startedAt: "2026-08-08T09:00:00.000Z", updatedAt: "2026-08-08T10:00:00.000Z", completedAt: null });
		const navigateByUrl = vi.fn().mockResolvedValue(true);
		TestBed.configureTestingModule({ providers: [
			{ provide: PersonaOnboardingService, useValue: service },
			{ provide: PersonaFirstChatService, useValue: { loadRouteState } },
			{ provide: Router, useValue: { navigateByUrl } },
			{ provide: ConfirmationService, useValue: { confirm: vi.fn() } }
		] });
		const component = TestBed.runInInjectionContext(function _CreateReview() { return new PersonaReviewPageComponent(); });

		await vi.waitFor(function _Routed() { expect(navigateByUrl).toHaveBeenCalledWith("/onboarding/chat"); });
		expect(component.onboarding.value()).toBe(ready);
		expect(loadRouteState).toHaveBeenCalledTimes(1);
	});

	it("retains the exact answer and idempotency key across retry before accepting server progress", async function _FirstChatRetry()
	{
		const initial = _ChatSnapshot();
		const next = _ChatSnapshot({
			transcript: [...initial.transcript, { ordinal: 3, role: PersonaFirstChatTranscriptRoles.User, kind: PersonaFirstChatTranscriptKinds.Answer, text: "Launch planning", questionOrdinal: 1 }, { ordinal: 4, role: PersonaFirstChatTranscriptRoles.Assistant, kind: PersonaFirstChatTranscriptKinds.Question, text: "What wastes time?", questionOrdinal: 2 }],
			currentQuestion: { ordinal: 2, text: "What wastes time?" },
			answerCount: 1
		});
		const answer = vi.fn().mockRejectedValueOnce(new Error("Temporary failure")).mockResolvedValueOnce(next);
		const service = { loadOrStart: vi.fn().mockResolvedValue(initial), answer, conclude: vi.fn(), load: vi.fn() } as unknown as PersonaFirstChatService;
		TestBed.configureTestingModule({ providers: [{ provide: PersonaFirstChatService, useValue: service }, { provide: Router, useValue: { navigateByUrl: vi.fn() } }] });
		const component = TestBed.runInInjectionContext(function _CreateChat() { return new PersonaFirstChatPageComponent(); });
		await vi.waitFor(function _Loaded() { expect(component.chat.hasValue()).toBe(true); });

		component.updateDraft("Launch planning");
		await component.submitAnswer({ questionId: "question-1", answer: "Launch planning" });
		expect(component.draftAnswer()).toBe("Launch planning");
		expect(component.actionError()).toContain("Temporary failure");
		const firstCommand = answer.mock.calls[0]?.[0];

		await component.retry();
		expect(answer.mock.calls[1]?.[0]).toEqual(firstCommand);
		expect(component.draftAnswer()).toBe("");
		expect(component.currentQuestion()?.ordinal).toBe(2);
	});

	it("adopts the authoritative position after a stale-device answer conflict", async function _FirstChatStaleCoordinate()
	{
		const initial = _ChatSnapshot();
		const advanced = _ChatSnapshot({
			transcript: [...initial.transcript, { ordinal: 3, role: PersonaFirstChatTranscriptRoles.User, kind: PersonaFirstChatTranscriptKinds.Answer, text: "Saved elsewhere", questionOrdinal: 1 }, { ordinal: 4, role: PersonaFirstChatTranscriptRoles.Assistant, kind: PersonaFirstChatTranscriptKinds.Question, text: "What wastes time?", questionOrdinal: 2 }],
			currentQuestion: { ordinal: 2, text: "What wastes time?" },
			answerCount: 1
		});
		const answer = vi.fn().mockRejectedValue(new PersonaFirstChatConflictError(advanced));
		const service = { loadOrStart: vi.fn().mockResolvedValue(initial), answer, conclude: vi.fn(), load: vi.fn() } as unknown as PersonaFirstChatService;
		TestBed.configureTestingModule({ providers: [{ provide: PersonaFirstChatService, useValue: service }, { provide: Router, useValue: { navigateByUrl: vi.fn() } }] });
		const component = TestBed.runInInjectionContext(function _CreateChat() { return new PersonaFirstChatPageComponent(); });
		await vi.waitFor(function _Loaded() { expect(component.chat.hasValue()).toBe(true); });

		component.updateDraft("Answer for the old question");
		await component.submitAnswer({ questionId: "question-1", answer: "Answer for the old question" });

		expect(answer).toHaveBeenCalledWith(expect.objectContaining({ expectedConversationId: "conversation-1", expectedQuestionOrdinal: 1 }));
		expect(component.currentQuestion()?.ordinal).toBe(2);
		expect(component.draftAnswer()).toBe("Answer for the old question");
		expect(component.actionError()).toContain("advanced elsewhere");
	});

	it("requests server conclusion only after the third admitted answer and safely enters the main surface", async function _FirstChatConclusion()
	{
		const initial = _ChatSnapshot({ answerCount: 2, currentQuestion: { ordinal: 3, text: "How hard should I push?" } });
		const ready = _ChatSnapshot({ answerCount: 3, currentQuestion: null, canConclude: true });
		const completed = _ChatSnapshot({ state: UserOnboardingRouteStates.Completed, answerCount: 3, currentQuestion: null, canConclude: false, completedAt: "2026-08-08T11:00:00.000Z" });
		const conclude = vi.fn().mockResolvedValue(completed);
		const service = { loadOrStart: vi.fn().mockResolvedValue(initial), answer: vi.fn().mockResolvedValue(ready), conclude, load: vi.fn() } as unknown as PersonaFirstChatService;
		const navigateByUrl = vi.fn().mockResolvedValue(true);
		TestBed.configureTestingModule({ providers: [{ provide: PersonaFirstChatService, useValue: service }, { provide: Router, useValue: { navigateByUrl } }] });
		const component = TestBed.runInInjectionContext(function _CreateChat() { return new PersonaFirstChatPageComponent(); });
		await vi.waitFor(function _Loaded() { expect(component.chat.hasValue()).toBe(true); });

		await component.submitAnswer({ questionId: "question-3", answer: "Push directly" });
		expect(conclude).toHaveBeenCalledWith(ready);
		expect(navigateByUrl).toHaveBeenCalledWith("/admin");
	});

	it("retries only conclusion after the third answer was durably admitted", async function _FirstChatConclusionRetry()
	{
		const initial = _ChatSnapshot({ answerCount: 2, currentQuestion: { ordinal: 3, text: "How hard should I push?" } });
		const ready = _ChatSnapshot({ answerCount: 3, currentQuestion: null, canConclude: true });
		const completed = _ChatSnapshot({ state: UserOnboardingRouteStates.Completed, answerCount: 3, currentQuestion: null, canConclude: false, completedAt: "2026-08-08T11:00:00.000Z" });
		const answer = vi.fn().mockResolvedValue(ready);
		const conclude = vi.fn().mockRejectedValueOnce(new Error("Temporary conclusion failure")).mockResolvedValueOnce(completed);
		const navigateByUrl = vi.fn().mockResolvedValue(true);
		const service = { loadOrStart: vi.fn().mockResolvedValue(initial), answer, conclude, load: vi.fn() } as unknown as PersonaFirstChatService;
		TestBed.configureTestingModule({ providers: [{ provide: PersonaFirstChatService, useValue: service }, { provide: Router, useValue: { navigateByUrl } }] });
		const component = TestBed.runInInjectionContext(function _CreateChat() { return new PersonaFirstChatPageComponent(); });
		await vi.waitFor(function _Loaded() { expect(component.chat.hasValue()).toBe(true); });

		await component.submitAnswer({ questionId: "question-3", answer: "Push directly" });
		expect(component.chat.value()).toBe(ready);
		expect(component.actionError()).toContain("Temporary conclusion failure");

		await component.retry();
		expect(answer).toHaveBeenCalledTimes(1);
		expect(conclude).toHaveBeenNthCalledWith(2, ready);
		expect(navigateByUrl).toHaveBeenCalledWith("/admin");
	});

	it("resumes conclusion from a durable three-answer projection after refresh", async function _FirstChatConclusionResume()
	{
		const ready = _ChatSnapshot({ answerCount: 3, currentQuestion: null, canConclude: true });
		const completed = _ChatSnapshot({ state: UserOnboardingRouteStates.Completed, answerCount: 3, currentQuestion: null, canConclude: false, completedAt: "2026-08-08T11:00:00.000Z" });
		const conclude = vi.fn().mockResolvedValue(completed);
		const navigateByUrl = vi.fn().mockResolvedValue(true);
		const service = { loadOrStart: vi.fn().mockResolvedValue(ready), answer: vi.fn(), conclude, load: vi.fn() } as unknown as PersonaFirstChatService;
		TestBed.configureTestingModule({ providers: [{ provide: PersonaFirstChatService, useValue: service }, { provide: Router, useValue: { navigateByUrl } }] });
		TestBed.runInInjectionContext(function _CreateChat() { return new PersonaFirstChatPageComponent(); });

		await vi.waitFor(function _Completed() { expect(navigateByUrl).toHaveBeenCalledWith("/admin"); });
		expect(conclude).toHaveBeenCalledWith(ready);
	});

	it("safely routes an already-completed empty chat projection without inventing client evidence", async function _CompletedResume()
	{
		const completed = _ChatSnapshot({
			state: UserOnboardingRouteStates.Completed,
			conversationId: null,
			persona: null,
			contentRevision: null,
			transcript: [],
			currentQuestion: null,
			answerCount: 0,
			questionCount: 0,
			canConclude: false,
			startedAt: null,
			completedAt: "2026-08-08T11:00:00.000Z"
		});
		const service = { loadOrStart: vi.fn().mockResolvedValue(completed), answer: vi.fn(), conclude: vi.fn(), load: vi.fn() } as unknown as PersonaFirstChatService;
		const navigateByUrl = vi.fn().mockResolvedValue(true);
		TestBed.configureTestingModule({ providers: [{ provide: PersonaFirstChatService, useValue: service }, { provide: Router, useValue: { navigateByUrl } }] });
		const component = TestBed.runInInjectionContext(function _CreateChat() { return new PersonaFirstChatPageComponent(); });

		await vi.waitFor(function _Routed() { expect(navigateByUrl).toHaveBeenCalledWith("/admin"); });
		expect(component.identity()).toBeNull();
		expect(service.answer).not.toHaveBeenCalled();
		expect(service.conclude).not.toHaveBeenCalled();
	});

	it("registers the bounded chat child without changing survey and review route ownership", function _ChatRoute()
	{
		expect(ONBOARDING_ROUTES.map(function _Path(route) { return route.path; })).toEqual(["survey", "review", "chat", "", "**"]);
	});
});
