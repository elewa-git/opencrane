import { describe, expect, it } from "vitest";

import { LOCAL_DEVELOPMENT_IDENTITY, LOCAL_DEVELOPMENT_MEMBERSHIP_ASSERTION_ID, LOCAL_DEVELOPMENT_MEMBERSHIP_ISSUER_ID, LOCAL_DEVELOPMENT_MEMBERSHIP_KEY_ID, LocalDevelopmentProfileKinds } from "../index";

describe("local development profile vocabulary", function _Suite()
{
	it("keeps the coordinator profile values stable", function _Profiles(): void
	{
		expect(Object.values(LocalDevelopmentProfileKinds)).toEqual([
			"core",
			"agent-local",
			"agent-remote",
			"agent-simulated"
		]);
	});

	it("keeps the seeded identity and membership identifiers stable", function _Identity(): void
	{
		expect(LOCAL_DEVELOPMENT_IDENTITY).toEqual({
			subjectId: "local-development-user",
			email: "developer@opencrane.local",
			displayName: "Local Developer",
			siloId: "local-development"
		});
		expect(LOCAL_DEVELOPMENT_MEMBERSHIP_ISSUER_ID).toBe("local-development-issuer");
		expect(LOCAL_DEVELOPMENT_MEMBERSHIP_KEY_ID).toBe("local-development-key");
		expect(LOCAL_DEVELOPMENT_MEMBERSHIP_ASSERTION_ID).toBe("local-development-personal-membership");
	});
});
