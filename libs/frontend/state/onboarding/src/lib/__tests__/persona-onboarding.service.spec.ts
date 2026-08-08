import { Injector, runInInjectionContext } from "@angular/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PERSONA_GATEWAY, PersonaGateway, PersonaOnboardingSnapshot, PersonaOnboardingStates } from "../persona-gateway.types";
import { PersonaOnboardingService } from "../persona-onboarding.service";

/** Build one complete server snapshot for orchestration tests. */
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

describe("PersonaOnboardingService", function _PersonaOnboardingServiceSuite()
{
	/** Mocked narrow persona authority port. */
	let gateway: PersonaGateway;

	/** Service under test. */
	let service: PersonaOnboardingService;

	beforeEach(function _Configure()
	{
		gateway = {
			load: vi.fn(),
			startInterview: vi.fn(),
			recordAnswer: vi.fn(),
			completeInterview: vi.fn(),
			resolve: vi.fn(),
			createDraft: vi.fn(),
			approve: vi.fn()
		};
		const injector = Injector.create({ providers: [{ provide: PERSONA_GATEWAY, useValue: gateway }] });
		service = runInInjectionContext(injector, function _CreateService() { return new PersonaOnboardingService(); });
	});

	it("reloads authoritative progress after recording an answer", async function _Answer()
	{
		const saved = _Snapshot({ answeredQuestionCount: 4 });
		vi.mocked(gateway.load).mockResolvedValue(saved);

		await expect(service.answer("interview-1", "q4", "choice-b")).resolves.toBe(saved);
		expect(gateway.recordAnswer).toHaveBeenCalledWith("interview-1", "q4", "choice-b");
	});

	it("creates a draft only after completion reports no unresolved tie", async function _Complete()
	{
		const completed = _Snapshot({ state: PersonaOnboardingStates.Review, answeredQuestionCount: 10 });
		const drafted = _Snapshot({ state: PersonaOnboardingStates.Review, answeredQuestionCount: 10, personaRevisionId: "revision-1" });
		vi.mocked(gateway.load).mockResolvedValueOnce(completed).mockResolvedValueOnce(drafted);

		await expect(service.complete("interview-1")).resolves.toBe(drafted);
		expect(gateway.completeInterview).toHaveBeenCalledWith("interview-1");
		expect(gateway.createDraft).toHaveBeenCalledWith("interview-1");
	});

	it("resumes an interrupted draft transition from the durable review state", async function _ResumeDraft()
	{
		const completed = _Snapshot({ state: PersonaOnboardingStates.Review, answeredQuestionCount: 10 });
		const drafted = _Snapshot({ state: PersonaOnboardingStates.Review, answeredQuestionCount: 10, personaRevisionId: "revision-1" });
		vi.mocked(gateway.load).mockResolvedValueOnce(completed).mockResolvedValueOnce(drafted);

		await expect(service.load()).resolves.toBe(drafted);
		expect(gateway.createDraft).toHaveBeenCalledWith("interview-1");
	});

	it("does not draft while the server requires an explicit tie choice", async function _Tie()
	{
		const unresolved = _Snapshot({ state: PersonaOnboardingStates.Resolution, answeredQuestionCount: 10 });
		vi.mocked(gateway.load).mockResolvedValue(unresolved);

		await expect(service.complete("interview-1")).resolves.toBe(unresolved);
		expect(gateway.createDraft).not.toHaveBeenCalled();
	});
});
