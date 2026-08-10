import { Injector, runInInjectionContext } from "@angular/core";
import { describe, expect, it, vi } from "vitest";

import { ControlPlaneApiService } from "@opencrane/core";
import { PersonaColours, PersonaModifiers, PersonaOnboardingStates, PersonaResolutionKinds } from "@opencrane/state/onboarding";

import { OpenCranePersonaGateway } from "../opencrane-persona-gateway";

/** Create the live adapter around one mocked generated client. */
function _Gateway(get: ReturnType<typeof vi.fn>, post: ReturnType<typeof vi.fn>): OpenCranePersonaGateway
{
	const api = { client: { GET: get, POST: post } } as unknown as ControlPlaneApiService;
	const injector = Injector.create({ providers: [{ provide: ControlPlaneApiService, useValue: api }] });
	return runInInjectionContext(injector, function _CreateGateway() { return new OpenCranePersonaGateway(); });
}

describe("OpenCranePersonaGateway", function _OpenCranePersonaGatewaySuite()
{
	it("maps the complete generated owner projection into finite frontend vocabularies", async function _Load()
	{
		const get = vi.fn().mockResolvedValue({
			data: {
				state: "review",
				interviewId: "interview-1",
				answeredQuestionCount: 1,
				questionCount: 1,
				personaRevisionId: "revision-1",
				questions: [{ id: "q1", category: "pace", prompt: "Choose", ordinal: 1, choices: [{ id: "a", label: "Fast", ordinal: 1 }, { id: "b", label: "Deliberately", ordinal: 2 }], selectedChoiceId: "a" }],
				resolution: null,
				result: {
					displayName: "The Commander",
					primaryColour: "red",
					secondaryColour: "blue",
					modifier: "explorer",
					colourScores: { red: 23, yellow: 3, green: 0, blue: 7, total: 33 },
					opennessScores: { explorer: 6, guardian: 0, total: 6 },
					insights: ["You prefer direct recommendations."],
					instructionPreview: "Lead with a direct recommendation."
				}
			}
		});
		const gateway = _Gateway(get, vi.fn());

		const snapshot = await gateway.load();
		expect(snapshot.state).toBe(PersonaOnboardingStates.Review);
		expect(snapshot.result?.primaryColour).toBe(PersonaColours.Red);
		expect(snapshot.result?.modifier).toBe(PersonaModifiers.Explorer);
		expect(snapshot.result?.instructionPreview).toBe("Lead with a direct recommendation.");
		expect(snapshot.questions[0]?.selectedChoiceId).toBe("a");
	});

	it("rejects a response whose durable counters do not match its frozen answers", async function _InvalidProjection()
	{
		const get = vi.fn().mockResolvedValue({
			data: {
				state: "interview",
				interviewId: "interview-1",
				answeredQuestionCount: 1,
				questionCount: 2,
				personaRevisionId: null,
				questions: [{ id: "q1", category: "pace", prompt: "Choose", ordinal: 1, choices: [{ id: "a", label: "Fast", ordinal: 1 }, { id: "b", label: "Deliberately", ordinal: 2 }], selectedChoiceId: "a" }],
				resolution: null,
				result: null
			}
		});

		await expect(_Gateway(get, vi.fn()).load()).rejects.toThrow("invalid onboarding projection");
	});

	it("uses only generated POST paths for answer persistence", async function _Answer()
	{
		const post = vi.fn().mockResolvedValue({ data: { answerId: "answer-1" } });
		const gateway = _Gateway(vi.fn(), post);

		await gateway.recordAnswer("interview-1", "q1", "choice-a");
		expect(post).toHaveBeenCalledWith("/me/persona/interviews/{interviewId}/answers/{questionId}", {
			params: { path: { interviewId: "interview-1", questionId: "q1" } },
			body: { choiceId: "choice-a" }
		});
	});

	it("sends a tie choice through the generated resolution contract", async function _Resolve()
	{
		const post = vi.fn().mockResolvedValue({ data: { interviewId: "interview-1", state: "completed", resolution: null, result: null } });
		const gateway = _Gateway(vi.fn(), post);

		await gateway.resolve("interview-1", PersonaResolutionKinds.Primary, PersonaColours.Red);
		expect(post).toHaveBeenCalledWith("/me/persona/interviews/{interviewId}/resolutions/{kind}", {
			params: { path: { interviewId: "interview-1", kind: PersonaResolutionKinds.Primary } },
			body: { selectedValue: PersonaColours.Red }
		});
	});
});
