import { describe, expect, it } from "vitest";

import { PersonaOnboardingApiStates } from "../../profile/persona-lifecycle.types";
import { PersonaColourValues, PersonaModifierValues, PersonaTieKinds } from "../../scoring/persona-scorer.types";
import { _PersonaOnboardingOpenapiPaths } from "../openapi";

describe("persona onboarding OpenAPI", function _PersonaOnboardingOpenapiSuite()
{
	it("documents every owner-hidden not-found response emitted by persona routes", function _DocumentsNotFoundResponses()
	{
		const operations = [
			_PersonaOnboardingOpenapiPaths["/me/persona/interview"].post,
			_PersonaOnboardingOpenapiPaths["/me/persona/interviews/{interviewId}/answers/{questionId}"].post,
			_PersonaOnboardingOpenapiPaths["/me/persona/interviews/{interviewId}/complete"].post,
			_PersonaOnboardingOpenapiPaths["/me/persona/interviews/{interviewId}/resolutions/{kind}"].post,
			_PersonaOnboardingOpenapiPaths["/me/persona/interviews/{interviewId}/draft"].post,
			_PersonaOnboardingOpenapiPaths["/me/persona/drafts/{personaRevisionId}/approve"].post,
		];

		for (const operation of operations) expect(operation.responses[404]).toBeDefined();
	});

	it("documents the empty-body rejection emitted by initial interview start", function _DocumentsInitialBodyRejection()
	{
		expect(_PersonaOnboardingOpenapiPaths["/me/persona/interview"].post.responses[400]).toBeDefined();
	});

	it("derives public categorical schemas from their owning persona enums", function _DerivesCategoricalSchemas()
	{
		const status = _PersonaOnboardingOpenapiPaths["/me/persona"].get.responses[200].content["application/json"].schema;
		const resolution = status.properties.resolution;
		const result = status.properties.result;

		expect(status.properties.state.enum).toEqual([PersonaOnboardingApiStates.Interview, PersonaOnboardingApiStates.Resolution, PersonaOnboardingApiStates.Review, PersonaOnboardingApiStates.Ready]);
		expect(resolution.properties.kind.enum).toEqual(Object.values(PersonaTieKinds));
		expect(result.properties.primaryColour.enum).toEqual(Object.values(PersonaColourValues));
		expect(result.properties.modifier.enum).toEqual(Object.values(PersonaModifierValues));
	});
});
