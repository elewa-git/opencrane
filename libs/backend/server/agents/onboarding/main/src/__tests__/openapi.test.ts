import { describe, expect, it } from "vitest";

import { _UserOnboardingOpenapiPaths } from "../openapi";
import { UserOnboardingStates } from "../user-onboarding.enums";

describe("user onboarding OpenAPI", function _UserOnboardingOpenapiSuite()
{
	it("derives durable route states from the owning workflow enum", function _DerivesWorkflowStates()
	{
		const schema = _UserOnboardingOpenapiPaths["/me/onboarding"].get.responses[200].content["application/json"].schema;
		expect(schema.properties.state.enum).toEqual(Object.values(UserOnboardingStates));
	});
});
