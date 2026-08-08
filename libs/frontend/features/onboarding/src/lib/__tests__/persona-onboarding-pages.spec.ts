import { TestBed } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { Router } from "@angular/router";
import { ConfirmationService } from "primeng/api";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { PERSONA_GATEWAY, PersonaColours, PersonaGateway, PersonaModifiers, PersonaOnboardingService, PersonaOnboardingSnapshot, PersonaOnboardingStates, PersonaResolutionKinds } from "@opencrane/state/onboarding";

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
		TestBed.configureTestingModule({ providers: [
			{ provide: PersonaOnboardingService, useValue: service },
			{ provide: Router, useValue: { navigateByUrl: vi.fn() } },
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
	});
});
